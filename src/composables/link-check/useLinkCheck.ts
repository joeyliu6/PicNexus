// 链接检测 Composable（单例模式）
// 负责批量检测历史链接有效性，管理检测状态和进度

/* eslint-disable max-lines -- singleton state machine kept together for link monitor behavior */
import { ref, shallowRef, type Ref } from 'vue';
import { createRafScheduler } from '@/utils/rafScheduler';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { HistoryItem } from '@/config/types';
import { useConfigManager } from '@/composables/useConfig';
import { historyDB } from '@/services/database';
import { useToast } from '@/composables/useToast';
import { createLogger } from '@/utils/logger';
import type {
  BatchCheckProgress,
  BatchCheckResult,
  BatchCheckItemResult,
  BatchCheckRequestItem,
  LinkCheckRow,
  CheckLinkResult,
} from '@/types/linkCheck';
import {
  linkCheckRowKey,
  liteRowToItem,
  buildCheckItemsSync,
  restoreCheckStatus,
  applyResultsToRows,
} from './linkCheckDataBuilder';
import {
  updateHistoryCheckStatus,
  exportCsv,
} from './linkCheckPersistence';
import { onCacheEvent, type HistoryEventData } from '@/events/cacheEvents';
import { getConfirmedHttpHosts } from '@/security/networkPolicy';

const log = createLogger('LinkCheck');

// ============================================
// 单例共享状态
// ============================================

const isChecking = ref(false);
const isPaused = ref(false);
const isLoading = ref(false);
const loadError = ref<string | null>(null);
/** 旧链接检测页的两段式加载标志；读取已改成一次读完，恒为 false（旧页面删除时一起删） */
const isPhase2Loading = ref(false);
/** 至少完整读过一次（之后的重读期间仍保留上一次的行） */
const loaded = ref(false);
const progress: Ref<BatchCheckProgress | null> = ref(null);
/** 进度来源标识：区分是链接检测还是文档修复在跑，防止 UI 串扰 */
const progressSource: Ref<'monitor' | 'rescue' | null> = ref(null);
const checkRows: Ref<LinkCheckRow[]> = shallowRef([]);
/**
 * 正在跑的这一轮：覆盖哪些行、什么时候开始。链接健康据此把本轮还没查到的旧结果先当作待查
 * （「边查边出现」）；检测结束（含取消）清空
 */
const activeRun = shallowRef<{ keys: ReadonlySet<string>; startedAt: number } | null>(null);

let progressUnlisten: UnlistenFn | null = null;
let checkSessionId = 0; // 防竞态：每次检测分配唯一 session，旧 finally 不会杀新检测
// 仅在批量检测「启动」时递增（取消不改），用于判定旧批次结果是否已被新批次替代
// checkSessionId 会被 cancel 递增，无法区分「只是取消」与「取消后又开新批次」两种场景
let latestStartedBatchSession = 0;
/**
 * 最新启动批次覆盖的行键集合。
 * 旧批次结果迟到落库时据此避让：属于新批次的行由新批次自己写，旧结果不去盖。
 */
let latestStartedBatchKeys = new Set<string>();
/**
 * 历史被清空的代数。与「被新批次替代」是两码事：清空后旧结果指向的记录已经不存在，
 * 必须**整体作废**（写库会写到已删 historyId，回填 UI 会造出幽灵行）；
 * 而「被新批次替代」的旧结果仍是真实数据，只是不该再动 UI。
 */
let historyClearedGeneration = 0;
let activeRecheckCount = 0; // 防 onViewDeactivated 在单条复检动画期间误触发空闲释放
let loadHistoryRowsPromise: Promise<void> | null = null;
let nextClientBatchSeq = 0;

/**
 * 行索引 Map：key = `${historyId}::${serviceId}` → 数组下标，O(1) 查找。
 *
 * 挂在模块级而不是 composable 内：`checkRows` 本身是模块级单例，索引必须是同一份。
 * 否则模块级的事件监听摘掉行之后，composable 实例里的索引还是旧的，
 * `applyRecentResults` / `updateRow` 会按错位下标 patch 到别人的行上。
 */
let rowIndexMap = new Map<string, number>();

/** 重建行索引（checkRows 被重新赋值时调用） */
function rebuildRowIndex(): void {
  rowIndexMap = new Map(
    checkRows.value.map((r, i) => [linkCheckRowKey(r), i])
  );
}

/**
 * 按 historyId 移除 checkRows 中的行（整条历史记录被删后调用）
 *
 * 正在播放删除动画（`fadingOut`）的行会被保留：那是本视图自己发起的删除，
 * 380ms 淡出结束后由 `removeRowsByKeys` 收尾。这里抢先摘掉会让过渡直接跳帧。
 */
function removeRowsByHistoryIds(ids: string[]): void {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const next = checkRows.value.filter((r) => !idSet.has(r.historyId) || r.fadingOut === true);
  if (next.length === checkRows.value.length) return;
  checkRows.value = next;
  rebuildRowIndex();
}

class LinkCheckPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkCheckPersistenceError';
  }
}

interface RowStateSnapshot {
  checkResult?: CheckLinkResult;
  checkedAt?: number;
  recheckResult?: CheckLinkResult;
  recheckLoading?: boolean;
  fadingOut?: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 清理进度监听器，防止累积泄漏 */
function clearProgressListener(): void {
  if (progressUnlisten) {
    progressUnlisten();
    progressUnlisten = null;
  }
}

/** 检测参数默认值 */
const DEFAULT_CHECK_PARAMS = {
  concurrency: 10,
  per_host_limit: 3,
  timeout_secs: 10,
} as const;

function createClientBatchId(source: 'monitor' | 'rescue'): string {
  nextClientBatchSeq += 1;
  return `${source}-${Date.now()}-${nextClientBatchSeq}`;
}

function isProgressForBatch(payload: BatchCheckProgress, batchId: string): boolean {
  return payload.batch_id === undefined || payload.batch_id === batchId;
}

function isResultForBatch(result: BatchCheckResult, batchId: string): boolean {
  return result.batch_id === undefined || result.batch_id === batchId;
}

// 空闲释放：离开检测页面 3 分钟后自动清空数据，释放内存
const IDLE_RELEASE_MS = 3 * 60 * 1000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

// TTL 缓存：避免反复切换页面时重复加载
const CACHE_TTL_MS = 5 * 60 * 1000;
let lastLoadTime = 0;

/**
 * recheckSingle 的节奏（ms）：转圈至少 SPIN_MIN，免得一闪而过；结果先在原位停 RESULT_SHOW，
 * 让用户看清它变成了什么，然后才落定——落定后列表才按新结果把这张图挪走
 */
const RECHECK_MS = { SPIN_MIN: 400, RESULT_SHOW: 1200 } as const;

// 与历史事件同步——不响应会导致检测视图持有"幽灵行"（历史已清空/删除/更新但检测页仍显示旧状态）
onCacheEvent((p) => {
  if (p.type === 'history-cleared') {
    checkRows.value = [];
    rebuildRowIndex();
    loadError.value = null;
    lastLoadTime = 0;
    // 历史被清空时，必须丢弃正在跑的批量结果——否则 finally 里的 applyResultsToRows
    // 会把这一批 result 重新塞回空的 checkRows，造成「幽灵行」与对已删 historyId 的写库
    ++historyClearedGeneration; // 在途的批量结果与正在进行的读取一律作废
    if (progressUnlisten) void invoke('cancel_batch_check').catch(() => undefined);
  } else if (p.type === 'history-deleted') {
    // 载荷形状：{ type, timestamp, data: { ids, source } }——ids 在 data 里，不在顶层。
    // 不按 source 过滤本窗口自发事件：历史页与检测页同处一个窗口，
    // 过滤掉就等于收不到「在历史页删图」这个最主要的场景。
    const ids = (p.data as HistoryEventData | undefined)?.ids;
    if (ids && ids.length > 0) removeRowsByHistoryIds(ids);
    lastLoadTime = 0;
  } else if (p.type === 'history-updated') {
    lastLoadTime = 0;
  }
}).catch(e => log.warn('[LinkCheck] 缓存事件监听失败:', e));

/**
 * 链接检测管理器
 */
export function useLinkCheckManager() {
  const toast = useToast();
  const { loadConfig } = useConfigManager();

  /** 重置检测状态 */
  function resetCheckState(): void {
    progress.value = null;
    progressSource.value = null;
  }

  /**
   * 已确认明文 HTTP 主机名名单，随检测请求传给 Rust
   *
   * Rust 的探测校验（validate_probe_url）是同步函数、查不了 DNS，认不出
   * http://nas.local 这类主机名是不是局域网——放行只能靠这份用户在设置页
   * fake-ip 逃生舱里显式确认过的名单。与 safeImageUrl 的 confirmedHttpHosts
   * 同源；漏传的后果是这批图床在检测里被误判「策略拦截」。
   */
  async function loadConfirmedHttpHosts(): Promise<string[]> {
    return [...getConfirmedHttpHosts(await loadConfig())];
  }

  function cloneResult(result: CheckLinkResult | undefined): CheckLinkResult | undefined {
    return result ? { ...result } : undefined;
  }

  function createRowsSnapshot(rows: LinkCheckRow[]): Map<string, RowStateSnapshot> {
    return new Map(rows.map((row) => [
      linkCheckRowKey(row),
      {
        checkResult: cloneResult(row.checkResult),
        checkedAt: row.checkedAt,
        recheckResult: cloneResult(row.recheckResult),
        recheckLoading: row.recheckLoading,
        fadingOut: row.fadingOut,
      },
    ]));
  }

  function restoreRowsSnapshot(snapshot: Map<string, RowStateSnapshot>): void {
    if (snapshot.size === 0) return;
    checkRows.value = checkRows.value.map((row) => {
      const saved = snapshot.get(linkCheckRowKey(row));
      if (!saved) return row;

      row.checkResult = cloneResult(saved.checkResult);
      row.checkedAt = saved.checkedAt;
      row.recheckResult = cloneResult(saved.recheckResult);
      row.recheckLoading = saved.recheckLoading;
      row.fadingOut = saved.fadingOut;
      return row;
    });
    rebuildRowIndex();
  }

  async function persistResultOrRollback(
    result: BatchCheckResult,
    snapshot: Map<string, RowStateSnapshot>,
  ): Promise<void> {
    try {
      await updateHistoryCheckStatus(result);
    } catch (err) {
      restoreRowsSnapshot(snapshot);
      throw new LinkCheckPersistenceError(errorMessage(err));
    }
  }

  /**
   * 旧批次（已被新批次替代）的收尾：结果照常落库，但不回填 UI。
   *
   * 为什么不能像以前那样整批丢弃：用户在大批量检测中途点「取消」，Rust 侧的在途请求
   * 几十秒后才陆续返回；此时用户已按 toast 的引导点了「仅未检测」续检、会话号已经变了。
   * 旧批次里**已经完成的那几千条**是真实检测结果，丢掉等于重启后全部回退成「未检测」。
   *
   * 为什么仍然不碰 UI：新批次正在跑，行状态归它管。而这些结果早就由 applyRecentResults
   * 就地 patch 进 UI 了——所以这里写库反而是把 UI 与 DB 拉回一致，不是制造分叉。
   *
   * 属于新批次的行会被跳过：那些行由新批次自己写，旧结果更陈旧，不该盖上去。
   */
  async function persistSupersededResult(result: BatchCheckResult): Promise<void> {
    const staleResults = result.results.filter(
      (r) => !latestStartedBatchKeys.has(`${r.history_id}::${r.service_id}`),
    );
    if (staleResults.length === 0) return;
    try {
      await updateHistoryCheckStatus({ ...result, results: staleResults });
      log.info(`[LinkCheck] 旧批次 ${staleResults.length} 条结果已补写入库`);
    } catch (err) {
      // 用户此刻正在看新批次的进度，旧批次落库失败不该弹 toast 打断他
      log.error('旧批次结果落库失败', err);
    }
  }

  /** 检测结束时的清理（带 session 守卫，防止旧 finally 杀死新检测） */
  function finalizeCheck(session: number): void {
    if (checkSessionId === session) {
      isChecking.value = false;
      isPaused.value = false;
      progressSource.value = null;
      activeRun.value = null;
      clearProgressListener();
    }
    // 同帧合并的 mutation 强制落地：避免最后一批结果还在 rAF 队列里就被
    // 后续 checkRows 重赋值（applyResultsToRows）覆盖
    checkRowsRefreshScheduler.flush();
  }

  /** async 包装，兼容原有调用 */
  async function buildCheckItems(items: HistoryItem[]): Promise<{
    requestItems: BatchCheckRequestItem[];
    rows: LinkCheckRow[];
  }> {
    const config = await loadConfig();
    return buildCheckItemsSync(items, config);
  }

  /** 让出主线程，防止长任务阻塞 UI 渲染 */
  function yieldToMain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  /**
   * 读全部历史链接（一次读完再交出去）
   *
   * Why 不再「先读有问题的、后台再读其余」：链接健康页的总数、日历、「仅 1 份」都要全量才对，
   * 半截数据会让状态栏先闪一下「全部正常」或错的张数。几万条一次读完也只要一两秒。
   */
  async function loadHistoryRows(options: { allowDuringCheck?: boolean } = {}): Promise<void> {
    if (loadHistoryRowsPromise) return loadHistoryRowsPromise;

    loadHistoryRowsPromise = doLoadHistoryRows(options).finally(() => {
      loadHistoryRowsPromise = null;
    });
    return loadHistoryRowsPromise;
  }

  async function doLoadHistoryRows(options: { allowDuringCheck?: boolean } = {}): Promise<void> {
    if (isChecking.value && !options.allowDuringCheck) return;

    // TTL 缓存：5 分钟内重复进入直接跳过（history 事件会把 lastLoadTime 清零）
    if (checkRows.value.length > 0 && Date.now() - lastLoadTime < CACHE_TTL_MS) return;

    isLoading.value = true;
    loadError.value = null;
    const myClearedGeneration = historyClearedGeneration;

    try {
      await historyDB.open();
      const config = await loadConfig();
      const rows: LinkCheckRow[] = [];
      for await (const batch of historyDB.getLinkCheckStream(2000)) {
        const batchItems = batch.map(liteRowToItem);
        const built = buildCheckItemsSync(batchItems, config).rows;
        restoreCheckStatus(built, batchItems);
        rows.push(...built);
        await yieldToMain();
      }
      // 读的途中历史被清空：读到的都是已删的记录，交出去就是幽灵行
      if (historyClearedGeneration !== myClearedGeneration) return;
      checkRows.value = rows;
      rebuildRowIndex();
      lastLoadTime = Date.now();
      loaded.value = true;
    } catch (err) {
      log.error('加载历史检测数据失败', err);
      loadError.value = errorMessage(err);
      toast.error('加载历史检测数据失败', loadError.value);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 检测所有历史链接
   */
  async function checkAllHistoryLinks(): Promise<BatchCheckResult | null> {
    if (isChecking.value) {
      toast.warn('检测进行中', '请等待当前检测完成');
      return null;
    }

    const mySession = ++checkSessionId;
    const myBatchSession = ++latestStartedBatchSession;
    const myClearedGeneration = historyClearedGeneration;
    const myBatchId = createClientBatchId('monitor');
    isChecking.value = true;
    isPaused.value = false;
    resetCheckState();
    progressSource.value = 'monitor';

    try {
      // 先确保读到了全部记录
      await loadHistoryRows({ allowDuringCheck: true });

      const rows = checkRows.value;
      const rowSnapshot = createRowsSnapshot(rows);
      if (rows.length === 0) {
        toast.info('无可检测的链接', '历史记录为空');
        return null;
      }

      // 从已加载的 rows 构建检测列表
      const requestItems: BatchCheckRequestItem[] = rows.map((row) => ({
        url: row.url,
        history_id: row.historyId,
        service_id: row.serviceId,
        fallback_url: row.fallbackUrl,
      }));

      if (requestItems.length === 0) {
        toast.info('无可检测的链接', '没有成功上传的链接');
        return null;
      }

      latestStartedBatchKeys = new Set(rows.map(linkCheckRowKey));
      activeRun.value = { keys: latestStartedBatchKeys, startedAt: Date.now() };

      // 监听进度事件（带 session 校验，防止旧会话数据污染新会话）
      clearProgressListener();
      progressUnlisten = await listen<BatchCheckProgress>(
        'link-check://progress',
        (event) => {
          if (checkSessionId !== mySession) return;
          if (!isProgressForBatch(event.payload, myBatchId)) return;
          progress.value = event.payload;
          applyRecentResults(event.payload.recent_results ?? []);
        },
      );

      // 调用 Rust 批量检测
      const result = await invoke<BatchCheckResult>('batch_check_links', {
        request: {
          links: requestItems,
          batch_id: myBatchId,
          confirmed_http_hosts: await loadConfirmedHttpHosts(),
          ...DEFAULT_CHECK_PARAMS,
        },
      });

      // 不是本批次的结果：数据归别的调用方处理，这里既不落库也不回填
      if (!isResultForBatch(result, myBatchId)) {
        log.info('[LinkCheck] 收到非本批次的全量结果，已丢弃');
        return null;
      }

      // 历史已被清空：结果指向的记录都不存在了，整批作废
      if (historyClearedGeneration !== myClearedGeneration) {
        log.info('[LinkCheck] 历史已清空，全量批量结果整批作废');
        return null;
      }

      // 被新批次替代：结果仍是真实检测数据，补写入库但不回填 UI（详见 persistSupersededResult）
      if (latestStartedBatchSession !== myBatchSession) {
        log.info('[LinkCheck] 全量批量结果被新批次替代，仅落库不回填 UI');
        await persistSupersededResult(result);
        return null;
      }

      // 即使被取消，也要处理已完成的结果并入库。
      // 必须重新读 checkRows：检测期间 history-deleted 可能摘掉过行，
      // 拿启动时的 rows 快照重新赋值会把已删的行「复活」
      const currentRows = [...checkRows.value];
      applyResultsToRows(currentRows, result.results);
      checkRows.value = currentRows;
      rebuildRowIndex();

      // 写回 DB
      await persistResultOrRollback(result, rowSnapshot);
      lastLoadTime = 0; // 检测完成后清除缓存，下次进入重新加载最新状态

      // 不弹「检测完成」：结论卡已经换成新结论，再弹一次是重复反馈
      return checkSessionId === mySession ? result : null;
    } catch (err) {
      log.error('批量检测失败', err);
      toast.error(
        err instanceof LinkCheckPersistenceError ? '保存检测结果失败' : '检测失败',
        errorMessage(err),
      );
      return null;
    } finally {
      finalizeCheck(mySession);
    }
  }

  /**
   * 检测指定的 URL 列表（用于 MD 救援等）
   */
  async function checkUrls(
    items: BatchCheckRequestItem[],
    onProgress?: (prog: BatchCheckProgress) => void,
    source: 'monitor' | 'rescue' = 'rescue',
  ): Promise<BatchCheckResult | null> {
    if (items.length === 0) return null;

    // 阻断并发：Rust 侧 cancel_flag + 前端 progressUnlisten 均为全局单例，
    // 同时跑多个批次会相互取消/覆盖监听器
    if (isChecking.value) {
      toast.warn('检测进行中', '请等待当前检测完成后再试');
      return null;
    }

    isChecking.value = true;
    isPaused.value = false;
    progressSource.value = source;
    progress.value = null;
    const myBatchId = createClientBatchId(source);

    // 监听进度（先清理旧监听器，防止累积泄漏）
    clearProgressListener();
    progressUnlisten = await listen<BatchCheckProgress>(
      'link-check://progress',
      (event) => {
        if (!isProgressForBatch(event.payload, myBatchId)) return;
        progress.value = event.payload;
        onProgress?.(event.payload);
      },
    );

    try {
      const result = await invoke<BatchCheckResult>('batch_check_links', {
        request: {
          links: items,
          batch_id: myBatchId,
          confirmed_http_hosts: await loadConfirmedHttpHosts(),
          ...DEFAULT_CHECK_PARAMS,
        },
      });

      return isResultForBatch(result, myBatchId) ? result : null;
    } finally {
      isChecking.value = false;
      isPaused.value = false;
      progressSource.value = null;
      clearProgressListener();
    }
  }

  /**
   * 取消正在进行的检测
   */
  async function cancelCheck(): Promise<void> {
    if (!isChecking.value) return;
    try {
      await invoke('cancel_batch_check');
      ++checkSessionId; // 使旧 finally 失效
      isChecking.value = false;
      isPaused.value = false;
      progressSource.value = null;
      activeRun.value = null;
      clearProgressListener();
      checkRowsRefreshScheduler.schedule(refreshCheckRowsRef);
      log.info('已发送取消请求');
    } catch (err) {
      log.error('取消失败', err);
      toast.error('取消失败', errorMessage(err));
    }
  }

  /** 暂停正在进行的批量检测（Rust 侧 pause_flag 轮询，cancel 优先 pause） */
  async function pauseCheck(): Promise<void> {
    if (!isChecking.value || isPaused.value) return;
    try {
      await invoke('pause_batch_check');
      isPaused.value = true;
      log.info('已发送暂停请求');
    } catch (err) {
      log.error('暂停失败', err);
      toast.error('暂停失败', errorMessage(err));
    }
  }

  /** 恢复被暂停的批量检测 */
  async function resumeCheck(): Promise<void> {
    if (!isChecking.value || !isPaused.value) return;
    try {
      await invoke('resume_batch_check');
      isPaused.value = false;
      log.info('已发送恢复请求');
    } catch (err) {
      log.error('恢复失败', err);
      toast.error('恢复失败', errorMessage(err));
    }
  }

  /**
   * 检测一部分链接：还没检查过的（statusFilter: 'unchecked'），或指定几张图的全部链接（historyIds）
   */
  async function checkSubset(filter: {
    statusFilter?: 'unchecked';
    historyIds?: string[];
  }): Promise<BatchCheckResult | null> {
    if (isChecking.value) {
      toast.warn('检测进行中', '请等待当前检测完成');
      return null;
    }

    const requiresFullLoad = !filter.historyIds;
    if (requiresFullLoad) {
      await loadHistoryRows();
      if (isChecking.value) {
        toast.warn('检测进行中', '请等待当前检测完成');
        return null;
      }
    }

    const idSet = filter.historyIds ? new Set(filter.historyIds) : null;
    const filtered = checkRows.value.filter((row) => {
      if (idSet) return idSet.has(row.historyId);
      if (filter.statusFilter === 'unchecked') return !row.checkResult;
      return true;
    });

    if (filtered.length === 0) {
      toast.info('无可检测的链接', '筛选结果为空');
      return null;
    }
    const rowSnapshot = createRowsSnapshot(filtered);

    const mySession = ++checkSessionId;
    const myBatchSession = ++latestStartedBatchSession;
    const myClearedGeneration = historyClearedGeneration;
    const myBatchId = createClientBatchId('monitor');
    isChecking.value = true;
    isPaused.value = false;
    progressSource.value = 'monitor';
    progress.value = null;
    latestStartedBatchKeys = new Set(filtered.map(linkCheckRowKey));
    activeRun.value = { keys: latestStartedBatchKeys, startedAt: Date.now() };

    try {
      const requestItems: BatchCheckRequestItem[] = filtered.map((row) => ({
        url: row.url,
        history_id: row.historyId,
        service_id: row.serviceId,
        fallback_url: row.fallbackUrl,
      }));

      clearProgressListener();
      progressUnlisten = await listen<BatchCheckProgress>(
        'link-check://progress',
        (event) => {
          if (checkSessionId !== mySession) return;
          if (!isProgressForBatch(event.payload, myBatchId)) return;
          progress.value = event.payload;
          applyRecentResults(event.payload.recent_results ?? []);
        },
      );

      const result = await invoke<BatchCheckResult>('batch_check_links', {
        request: {
          links: requestItems,
          batch_id: myBatchId,
          confirmed_http_hosts: await loadConfirmedHttpHosts(),
          ...DEFAULT_CHECK_PARAMS,
        },
      });

      // 不是本批次的结果：数据归别的调用方处理，这里既不落库也不回填
      if (!isResultForBatch(result, myBatchId)) {
        log.info('[LinkCheck] 收到非本批次的子集结果，已丢弃');
        return null;
      }

      // 历史已被清空：结果指向的记录都不存在了，整批作废
      if (historyClearedGeneration !== myClearedGeneration) {
        log.info('[LinkCheck] 历史已清空，子集批量结果整批作废');
        return null;
      }

      // 被新批次替代：结果仍是真实检测数据，补写入库但不回填 UI（详见 persistSupersededResult）
      if (latestStartedBatchSession !== myBatchSession) {
        log.info('[LinkCheck] 子集批量结果被新批次替代，仅落库不回填 UI');
        await persistSupersededResult(result);
        return null;
      }

      // 即使被取消，也要处理已完成的结果并入库
      const allRows = [...checkRows.value];
      applyResultsToRows(allRows, result.results);
      checkRows.value = allRows;

      // 更新 DB
      await persistResultOrRollback(result, rowSnapshot);
      lastLoadTime = 0; // 检测完成后清除缓存

      // 不弹「已检测」：结论卡已经换成新结论，再弹一次是重复反馈
      return checkSessionId === mySession ? result : null;
    } catch (err) {
      log.error('子集检测失败', err);
      toast.error(
        err instanceof LinkCheckPersistenceError ? '保存检测结果失败' : '检测失败',
        errorMessage(err),
      );
      return null;
    } finally {
      finalizeCheck(mySession);
    }
  }

  /**
   * 重新检测单条链接（入口 + 三个辅助函数）
   */

  /** rAF 节流刷新（同帧内多次 mutate 合并为一次数组引用替换，对齐批量迁移的实现） */
  const checkRowsRefreshScheduler = createRafScheduler();
  function refreshCheckRowsRef(): void {
    // 必须替换数组引用而非 triggerRef：HistoryCheckPanel 通过 prop 接收 checkRows，
    // Vue 的 prop 更新走引用比对——同一个数组引用 = prop 没变 = 子组件 computed 不重算。
    // .slice() 仅复制指针表（34k 条 ≈ 272KB），rAF 合并后每帧最多一次。
    checkRows.value = checkRows.value.slice();
  }

  /**
   * 把进度事件里的逐条结果实时 patch 到对应行
   *
   * 行对象 mutate-in-place + rAF 节流换数组引用：跨越 prop 边界唤醒子组件、
   * 同帧多条结果合并为一次重渲染，避免轰炸 UI。
   */
  function applyRecentResults(recent: BatchCheckItemResult[]): void {
    if (recent.length === 0) return;
    const now = Date.now();
    let mutated = false;
    for (const itemResult of recent) {
      if (!itemResult.history_id || !itemResult.service_id) continue;
      const key = `${itemResult.history_id}::${itemResult.service_id}`;
      const idx = rowIndexMap.get(key);
      if (idx === undefined || idx >= checkRows.value.length) continue;
      const target = checkRows.value[idx];
      // 让位给手动重检：用户已点击 recheck 时不被批量结果覆盖
      if (target.recheckLoading || target.recheckResult) continue;
      const { history_id: _hid, service_id: _sid, ...result } = itemResult;
      target.checkResult = result;
      target.checkedAt = now;
      mutated = true;
    }
    if (mutated) checkRowsRefreshScheduler.schedule(refreshCheckRowsRef);
  }

  /** 复制 checkRows、通过 Map O(1) 找到目标行、执行变更、触发响应式更新 */
  function updateRow(row: LinkCheckRow, updater: (target: LinkCheckRow) => void): boolean {
    const key = linkCheckRowKey(row);
    const idx = rowIndexMap.get(key);
    if (idx === undefined || idx >= checkRows.value.length) return false;
    const rows = [...checkRows.value];
    updater(rows[idx]);
    checkRows.value = rows;
    return true;
  }

  /** 执行单条检测请求（含最短转圈等待，避免按钮过快闪烁） */
  async function performRecheckRequest(row: LinkCheckRow): Promise<CheckLinkResult> {
    const [result] = await Promise.all([
      invoke<CheckLinkResult>('check_image_link', {
        link: row.url,
        fallbackUrl: row.fallbackUrl ?? null,
        confirmedHttpHosts: await loadConfirmedHttpHosts(),
      }),
      new Promise<void>((resolve) => setTimeout(resolve, RECHECK_MS.SPIN_MIN)),
    ]);
    return result;
  }

  /** 复检结果先在原位停留，让用户看清它变成了什么，再落定（落定后列表才按新结果归类） */
  async function showRecheckResult(row: LinkCheckRow, result: CheckLinkResult): Promise<void> {
    if (!updateRow(row, (t) => { t.recheckLoading = false; t.recheckResult = result; })) return;
    await new Promise((resolve) => setTimeout(resolve, RECHECK_MS.RESULT_SHOW));
    updateRow(row, (t) => {
      t.checkResult = result;
      t.checkedAt = Date.now();
      t.recheckResult = undefined;
    });
  }

  /** 将复检结果持久化到数据库 */
  async function persistRecheckResult(row: LinkCheckRow, result: CheckLinkResult): Promise<void> {
    await updateHistoryCheckStatus({
      results: [{
        ...result,
        history_id: row.historyId,
        service_id: row.serviceId,
      }],
      total: 1,
      valid: result.is_valid ? 1 : 0,
      invalid: !result.is_valid && result.error_type !== 'timeout' && result.error_type !== 'suspicious' ? 1 : 0,
      timeout: result.error_type === 'timeout' ? 1 : 0,
      suspicious: result.error_type === 'suspicious' ? 1 : 0,
      elapsed_ms: result.response_time ?? 0,
      cancelled: false,
    });
  }

  async function recheckSingle(row: LinkCheckRow): Promise<void> {
    const key = linkCheckRowKey(row);
    const existingIdx = rowIndexMap.get(key);
    const existing = existingIdx !== undefined ? checkRows.value[existingIdx] : undefined;
    if (existing?.recheckLoading || existing?.recheckResult) return;

    activeRecheckCount++;
    try {
      if (!updateRow(row, (t) => { t.recheckLoading = true; })) return;
      const result = await performRecheckRequest(row);
      await persistRecheckResult(row, result);
      await showRecheckResult(row, result);
    } catch (err) {
      updateRow(row, (t) => {
        t.recheckLoading = false;
        t.recheckResult = undefined;
      });
      log.error('单条检测失败', err);
      toast.error('检测失败', errorMessage(err));
    } finally {
      activeRecheckCount--;
    }
  }

  /**
   * 按 (historyId, serviceId) 键精准移除 checkRows 中的行
   * 用于链接检测"仅删除单条图床链接"的场景：同一 historyId 下其他图床的行应保留
   */
  function removeRowsByKeys(keys: Array<{ historyId: string; serviceId: string }>): void {
    if (keys.length === 0) return;
    const keySet = new Set(keys.map((k) => `${k.historyId}::${k.serviceId}`));
    checkRows.value = checkRows.value.filter((r) => !keySet.has(`${r.historyId}::${r.serviceId}`));
    rebuildRowIndex();
  }

  /**
   * 按 (historyId, serviceId) 键设置指定行的 fadingOut 状态
   */
  function setFadingOutRows(
    keys: Array<{ historyId: string; serviceId: string }>,
    value: boolean,
  ): void {
    if (keys.length === 0) return;
    const keySet = new Set(keys.map((k) => `${k.historyId}::${k.serviceId}`));
    const rows = [...checkRows.value];
    for (const row of rows) {
      if (keySet.has(`${row.historyId}::${row.serviceId}`)) {
        row.fadingOut = value;
      }
    }
    checkRows.value = rows;
  }

  /**
   * 主图床已在库里切换后，同步行上的「主链接」标记（不重新加载整表）
   *
   * 一次收一批（historyId → 新主图床）：「把 N 张改用备份」只遍历整表一遍。
   * 动到的行换新对象，好让按行渲染的组件刷新；行序不变，行索引不用重建。
   */
  function setPrimaryServices(changes: ReadonlyMap<string, string>): void {
    if (changes.size === 0) return;
    let changed = false;
    const rows = checkRows.value.map((row) => {
      const serviceId = changes.get(row.historyId);
      if (serviceId === undefined) return row;
      const isPrimary = row.serviceId === serviceId;
      if (row.isPrimary === isPrimary) return row;
      changed = true;
      return { ...row, isPrimary };
    });
    if (changed) checkRows.value = rows;
  }

  /** 页面激活时：取消空闲计时，利用 TTL 缓存判断是否需要重新加载 */
  function onViewActivated(): void {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (!isLoading.value) {
      loadHistoryRows(); // 内部有 TTL 缓存检查，不会重复加载
    }
  }

  /** 页面离开时：启动空闲计时，到期释放数据 */
  function onViewDeactivated(): void {
    if (isChecking.value || isLoading.value || progressUnlisten || activeRecheckCount > 0) return; // 检测 / 读取 / 复检动画进行中，不清理
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!isChecking.value) {
        checkRows.value = [];
        rebuildRowIndex();
        loaded.value = false;
        lastLoadTime = 0; // 清除缓存，下次进入重新加载
        log.info('空闲超时，已释放检测数据');
      }
      idleTimer = null;
    }, IDLE_RELEASE_MS);
  }

  return {
    // 状态
    isChecking,
    isPaused,
    isLoading,
    isPhase2Loading,
    loaded,
    progress,
    progressSource,
    checkRows,
    activeRun,
    // 方法
    loadHistoryRows,
    loadError,
    checkAllHistoryLinks,
    checkSubset,
    recheckSingle,
    checkUrls,
    cancelCheck,
    pauseCheck,
    resumeCheck,
    exportCsv,
    buildCheckItems,
    removeRowsByHistoryIds,
    removeRowsByKeys,
    setFadingOutRows,
    setPrimaryServices,
    onViewActivated,
    onViewDeactivated,
  };
}
