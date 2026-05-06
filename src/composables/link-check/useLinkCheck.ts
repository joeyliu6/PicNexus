// 链接检测 Composable（单例模式）
// 负责批量检测历史链接有效性，管理检测状态和进度

/* eslint-disable max-lines -- singleton state machine kept together for link monitor behavior */
import { ref, shallowRef, computed, getCurrentScope, onScopeDispose, type Ref, type ComputedRef } from 'vue';
import { createRafScheduler } from '../../utils/rafScheduler';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { HistoryItem } from '../../config/types';
import { useConfigManager } from '../useConfig';
import { historyDB } from '../../services/HistoryDatabase';
import { useToast } from '../useToast';
import { createLogger } from '../../utils/logger';
import {
  SEVERITY,
  type StatusFilter,
  type BatchCheckProgress,
  type BatchCheckResult,
  type BatchCheckItemResult,
  type BatchCheckRequestItem,
  type LinkCheckRow,
  type CheckLinkResult,
  type ServiceStat,
} from '../../types/linkCheck';
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
import { onCacheEvent } from '../../events/cacheEvents';

const log = createLogger('LinkCheck');

// ============================================
// 单例共享状态
// ============================================

const isChecking = ref(false);
const isPaused = ref(false);
const isLoading = ref(false);
const loadError = ref<string | null>(null);
/** Phase 2 后台加载中标志：Phase 1 结束后为 true，Phase 2 全部到达后为 false */
const isPhase2Loading = ref(false);
/** Phase 2 耗时（ms）：用于 UI 侧判断是否跳过动画（<300ms 则跳过） */
const phase2Duration = ref(0);
const progress: Ref<BatchCheckProgress | null> = ref(null);
/** 进度来源标识：区分是链接检测还是文档修复在跑，防止 UI 串扰 */
const progressSource: Ref<'monitor' | 'rescue' | null> = ref(null);
const lastBatchResult: Ref<BatchCheckResult | null> = shallowRef(null);
const checkRows: Ref<LinkCheckRow[]> = shallowRef([]);

let progressUnlisten: UnlistenFn | null = null;
let checkSessionId = 0; // 防竞态：每次检测分配唯一 session，旧 finally 不会杀新检测
// 仅在批量检测「启动」时递增（取消不改），用于判定旧批次结果是否已被新批次替代
// checkSessionId 会被 cancel 递增，无法区分「只是取消」与「取消后又开新批次」两种场景
let latestStartedBatchSession = 0;
let activeRecheckCount = 0; // 防 onViewDeactivated 在单条复检动画期间误触发空闲释放
let loadHistoryRowsPromise: Promise<void> | null = null;
let nextClientBatchSeq = 0;

class LinkCheckPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkCheckPersistenceError';
  }
}

interface RowStateSnapshot {
  checkResult?: CheckLinkResult;
  recheckResult?: CheckLinkResult;
  recheckLoading?: boolean;
  recheckBadgeFading?: boolean;
  fadingOut?: boolean;
  pinnedSortWeight?: number;
  recentlyCompletedAt?: number;
  uncheckedLeavingAt?: number;
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
/** 首次加载骨架屏最小可见时长，防止加载太快一闪而过 */
const MIN_SKELETON_MS = 400;

/** recheckSingle 各阶段动画时长（ms）：转圈最短/结果展示/行淡出/徽章淡出 */
const RECHECK_MS = { SPIN_MIN: 400, RESULT_SHOW: 1000, ROW_FADE: 350, BADGE_FADE: 300 } as const;

// 与历史事件同步——不响应会导致检测视图持有"幽灵行"（历史已清空/更新但检测页仍显示旧状态）
onCacheEvent((p) => {
  if (p.type === 'history-cleared') {
    checkRows.value = [];
    loadError.value = null;
    lastBatchResult.value = null;
    lastLoadTime = 0;
    // 历史被清空时，必须丢弃正在跑的批量结果——否则 finally 里的 applyResultsToRows
    // 会把这一批 result 重新塞回空的 checkRows，造成「幽灵行」与对已删 historyId 的写库
    if (progressUnlisten) {
      ++latestStartedBatchSession; // 触发 useLinkCheckManager 内部「被新批次替代」守卫
      void invoke('cancel_batch_check').catch(() => undefined);
    }
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
    lastBatchResult.value = null;
  }

  function cloneResult(result: CheckLinkResult | undefined): CheckLinkResult | undefined {
    return result ? { ...result } : undefined;
  }

  function createRowsSnapshot(rows: LinkCheckRow[]): Map<string, RowStateSnapshot> {
    return new Map(rows.map((row) => [
      linkCheckRowKey(row),
      {
        checkResult: cloneResult(row.checkResult),
        recheckResult: cloneResult(row.recheckResult),
        recheckLoading: row.recheckLoading,
        recheckBadgeFading: row.recheckBadgeFading,
        fadingOut: row.fadingOut,
        pinnedSortWeight: row.pinnedSortWeight,
        recentlyCompletedAt: row.recentlyCompletedAt,
        uncheckedLeavingAt: row.uncheckedLeavingAt,
      },
    ]));
  }

  function restoreRowsSnapshot(snapshot: Map<string, RowStateSnapshot>): void {
    if (snapshot.size === 0) return;
    clearAllHolds();
    checkRows.value = checkRows.value.map((row) => {
      const saved = snapshot.get(linkCheckRowKey(row));
      if (!saved) return row;

      row.checkResult = cloneResult(saved.checkResult);
      row.recheckResult = cloneResult(saved.recheckResult);
      row.recheckLoading = saved.recheckLoading;
      row.recheckBadgeFading = saved.recheckBadgeFading;
      row.fadingOut = saved.fadingOut;
      row.pinnedSortWeight = saved.pinnedSortWeight;
      row.recentlyCompletedAt = saved.recentlyCompletedAt;
      row.uncheckedLeavingAt = saved.uncheckedLeavingAt;
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

  /** 检测结束时的清理（带 session 守卫，防止旧 finally 杀死新检测） */
  function finalizeCheck(session: number): void {
    if (checkSessionId === session) {
      isChecking.value = false;
      isPaused.value = false;
      progressSource.value = null;
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
   * 两阶段加载历史链接，实现"时间差"策略：
   * Phase 1：优先加载失效/未检测链接（默认标签页内容），用户秒看到数据
   * Phase 2：后台静默加载剩余记录，切换标签时数据已就绪
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

    // TTL 缓存：5 分钟内重复进入直接跳过
    if (checkRows.value.length > 0 && Date.now() - lastLoadTime < CACHE_TTL_MS && !isPhase2Loading.value) {
      return;
    }

    const isFirstLoad = checkRows.value.length === 0;
    const skeletonStart = isFirstLoad ? Date.now() : 0;
    isLoading.value = true;
    loadError.value = null;

    try {
      await historyDB.open();
      const config = await loadConfig();

      // Phase 1：快速加载有问题的记录（失效 + 未检测）
      const invalidLiteRows = await historyDB.getLinkCheckInvalid();
      const invalidItems = invalidLiteRows.map(liteRowToItem);
      const { rows: invalidRows } = buildCheckItemsSync(invalidItems, config);
      restoreCheckStatus(invalidRows, invalidItems);

      // 先等骨架屏显示满 MIN_SKELETON_MS，再赋值 checkRows 触发 stats 刷新
      // （骨架屏依赖 stats.total === 0，一旦赋值即失效）
      if (isFirstLoad) {
        const remaining = MIN_SKELETON_MS - (Date.now() - skeletonStart);
        if (remaining > 0) await new Promise<void>(r => setTimeout(r, remaining));
      }

      checkRows.value = invalidRows;
      rebuildRowIndex();
      isLoading.value = false; // 提前结束 loading，用户已看到失效数据

      // Phase 2：后台静默加载剩余记录
      // 先收集所有批次到临时数组，避免每批都 [...checkRows, ...batch] 导致 O(n²) 复制
      isPhase2Loading.value = true;
      const phase2Start = Date.now();
      const loadedIds = new Set(invalidLiteRows.map((r) => r.id));
      const pendingRows: LinkCheckRow[] = [];
      for await (const batch of historyDB.getLinkCheckRestStream(loadedIds, 2000)) {
        const batchItems = batch.map(liteRowToItem);
        const { rows } = buildCheckItemsSync(batchItems, config);
        restoreCheckStatus(rows, batchItems);
        pendingRows.push(...rows);
        await yieldToMain();
      }
      if (pendingRows.length > 0) {
        checkRows.value = [...checkRows.value, ...pendingRows];
        rebuildRowIndex();
      }
      phase2Duration.value = Date.now() - phase2Start;
      isPhase2Loading.value = false;

      lastLoadTime = Date.now();
    } catch (err) {
      log.error('加载历史检测数据失败', err);
      loadError.value = errorMessage(err);
      toast.error('加载历史检测数据失败', loadError.value);
    } finally {
      isLoading.value = false;
      isPhase2Loading.value = false;
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
    const myBatchId = createClientBatchId('monitor');
    isChecking.value = true;
    isPaused.value = false;
    resetCheckState();
    progressSource.value = 'monitor';

    try {
      // 确保 Phase 2 已完成，避免只检测到首批问题链接。
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
          ...DEFAULT_CHECK_PARAMS,
        },
      });

      // 被新批次替代：老批次返回的结果不再写入 UI/DB，避免与正在运行的新批次竞争
      if (latestStartedBatchSession !== myBatchSession || !isResultForBatch(result, myBatchId)) {
        log.info('[LinkCheck] 全量批量结果被新批次替代，已丢弃');
        return null;
      }

      // 即使被取消，也要处理已完成的结果并入库
      lastBatchResult.value = result;
      applyResultsToRows(rows, result.results);
      // 全量批量后清除单条重检遗留的排序锁定（否则旧 pinnedSortWeight 会锁死位置）
      for (const row of rows) row.pinnedSortWeight = undefined;
      checkRows.value = [...rows];
      rebuildRowIndex();

      // 写回 DB
      await persistResultOrRollback(result, rowSnapshot);
      lastLoadTime = 0; // 检测完成后清除缓存，下次进入重新加载最新状态

      // session 守卫移到结果入库之后：只控制 toast 显示和返回值
      if (checkSessionId !== mySession) {
        if (result.cancelled) {
          toast.warn('已停止检测', `已完成 ${result.results.length} 条，结果已保存。可通过「仅未检测」继续剩余部分`);
        }
        return null;
      }

      if (!result.cancelled) {
        toast.success(
          '检测完成',
          `共 ${result.total} 条：有效 ${result.valid} / 失效 ${result.invalid} / 超时 ${result.timeout} / 可疑 ${result.suspicious}`,
        );
      }

      return result;
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
      clearProgressListener();
      // 取消时立即清空 hold，让残留过渡态行尽快归位，不再拖 2s
      clearAllHolds();
      checkRowsRefreshScheduler.schedule(refreshCheckRowsRef);
      // toast 移至检测函数中，入库后再提示（含已入库数量）
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

  // ============================================
  // 按图床分组的统计数据
  // ============================================

  const serviceStats: ComputedRef<ServiceStat[]> = computed(() => {
    const rows = checkRows.value;
    if (rows.length === 0) return [];

    const map = new Map<string, { total: number; valid: number; invalid: number; unchecked: number }>();

    for (const row of rows) {
      const sid = row.serviceId;
      const entry = map.get(sid) || { total: 0, valid: 0, invalid: 0, unchecked: 0 };
      entry.total++;
      if (!row.checkResult) {
        entry.unchecked++;
      } else if (row.checkResult.is_valid) {
        entry.valid++;
      } else {
        entry.invalid++;
      }
      map.set(sid, entry);
    }

    return Array.from(map.entries())
      .map(([serviceId, s]) => {
        const checked = s.total - s.unchecked;
        return {
          serviceId,
          ...s,
          checked,
          healthRate: checked > 0 ? Math.round((s.valid / checked) * 100) : 0,
        };
      })
      .sort((a, b) => a.healthRate - b.healthRate);
  });

  /**
   * 检测子集链接（按图床/状态筛选）
   */
  async function checkSubset(filter: {
    serviceId?: string;
    statusFilter?: 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'valid' | 'problems';
    searchQuery?: string;
    historyIds?: string[];
    targets?: Array<{ historyId: string; serviceId: string }>;
  }): Promise<BatchCheckResult | null> {
    if (isChecking.value) {
      toast.warn('检测进行中', '请等待当前检测完成');
      return null;
    }

    const requiresFullLoad = !filter.targets && !filter.historyIds;
    if (requiresFullLoad) {
      await loadHistoryRows();
      if (isChecking.value) {
        toast.warn('检测进行中', '请等待当前检测完成');
        return null;
      }
    }

    const rows = checkRows.value;
    const idSet = filter.historyIds ? new Set(filter.historyIds) : null;
    const targetSet = filter.targets ? new Set(filter.targets.map((target) => `${target.historyId}::${target.serviceId}`)) : null;
    const searchQuery = filter.searchQuery?.trim().toLowerCase() ?? '';
    const filtered = rows.filter((row) => {
      if (targetSet) return targetSet.has(linkCheckRowKey(row));
      if (idSet) return idSet.has(row.historyId);
      if (filter.serviceId && row.serviceId !== filter.serviceId) return false;
      if (
        searchQuery
        && !row.url.toLowerCase().includes(searchQuery)
        && !row.fileName.toLowerCase().includes(searchQuery)
        && !row.serviceId.toLowerCase().includes(searchQuery)
      ) {
        return false;
      }
      const cr = row.checkResult;
      switch (filter.statusFilter) {
        case 'unchecked': return !cr;
        case 'invalid': return cr != null && !cr.is_valid && cr.error_type !== 'timeout' && cr.error_type !== 'suspicious' && !cr.browser_might_work;
        case 'timeout': return cr?.error_type === 'timeout';
        case 'suspicious': return cr?.error_type === 'suspicious' || cr?.browser_might_work === true;
        case 'valid': return cr?.is_valid === true;
        case 'problems': return cr != null && !cr.is_valid;
        default: return true;
      }
    });

    if (filtered.length === 0) {
      toast.info('无可检测的链接', '筛选结果为空');
      return null;
    }
    const rowSnapshot = createRowsSnapshot(filtered);

    const mySession = ++checkSessionId;
    const myBatchSession = ++latestStartedBatchSession;
    const myBatchId = createClientBatchId('monitor');
    isChecking.value = true;
    isPaused.value = false;
    progressSource.value = 'monitor';
    progress.value = null;

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
          ...DEFAULT_CHECK_PARAMS,
        },
      });

      // 被新批次替代：老批次结果不再写入，避免污染新批次状态
      if (latestStartedBatchSession !== myBatchSession || !isResultForBatch(result, myBatchId)) {
        log.info('[LinkCheck] 子集批量结果被新批次替代，已丢弃');
        return null;
      }

      // 即使被取消，也要处理已完成的结果并入库
      const allRows = [...checkRows.value];
      applyResultsToRows(allRows, result.results);
      // 子集复检需清除排序锁定
      const rowMap = new Map(allRows.map((r) => [linkCheckRowKey(r), r]));
      for (const itemResult of result.results) {
        if (!itemResult.history_id || !itemResult.service_id) continue;
        const row = rowMap.get(`${itemResult.history_id}::${itemResult.service_id}`);
        if (row) row.pinnedSortWeight = undefined;
      }
      checkRows.value = allRows;

      // 更新 DB
      await persistResultOrRollback(result, rowSnapshot);
      lastLoadTime = 0; // 检测完成后清除缓存

      // session 守卫移到结果入库之后：只控制 toast 显示和返回值
      if (checkSessionId !== mySession) {
        if (result.cancelled) {
          toast.warn('已停止检测', `已完成 ${result.results.length} 条，结果已保存。可通过「仅未检测」继续剩余部分`);
        }
        return null;
      }

      if (!result.cancelled) {
        toast.success('已检测', `共 ${result.total} 条：有效 ${result.valid} / 失效 ${result.invalid}`);
      }

      return result;
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

  /** 行索引 Map：key = `${url}::${historyId}` → 数组下标，O(1) 查找 */
  let rowIndexMap = new Map<string, number>();

  /** 重建行索引（checkRows 被重新赋值时调用） */
  function rebuildRowIndex(): void {
    rowIndexMap = new Map(
      checkRows.value.map((r, i) => [linkCheckRowKey(r), i])
    );
  }

  /** rAF 节流刷新（同帧内多次 mutate 合并为一次数组引用替换，对齐批量迁移的实现） */
  const checkRowsRefreshScheduler = createRafScheduler();
  function refreshCheckRowsRef(): void {
    // 必须替换数组引用而非 triggerRef：HistoryCheckPanel 通过 prop 接收 checkRows，
    // Vue 的 prop 更新走引用比对——同一个数组引用 = prop 没变 = 子组件 computed 不重算。
    // .slice() 仅复制指针表（34k 条 ≈ 272KB），rAF 合并后每帧最多一次。
    checkRows.value = checkRows.value.slice();
  }

  // ============================================
  // 检测完成过渡态：行在原 tab 停留 HOLD_MS 后淡出
  // ============================================
  // 设计意图：批量检测时新结果到达不立刻把行从「未检测」tab 抽走（突兀），而是
  // 在原位停留约 2s 让用户看清新状态（dot 变色 + 徽章），再进入「未检测」离场动画。
  // 对应 tab（如「正常」）那边没有 hold 概念，新结果立即出现。

  /** 完成态停留时长（ms）：用户能看清结果的最小阅读时长 */
  const HOLD_MS = 2000;
  /** 「未检测」tab 离场动画窗口，需与 CheckLinkList.vue 的 leaving-unchecked 过渡保持一致 */
  const UNCHECKED_LEAVE_MS = 520;
  /** 扫描 hold/leave 过期的轮询间隔；250ms 既不过密也不过疏，高速场景自然分批 */
  const HOLD_SWEEP_MS = 250;
  /** 当前处于 hold 态的行集合——避免每次扫全量 checkRows */
  const rowsInHold = new Set<LinkCheckRow>();
  let holdSweepInterval: ReturnType<typeof setInterval> | null = null;

  function ensureHoldSweep(): void {
    if (holdSweepInterval !== null) return;
    holdSweepInterval = setInterval(() => {
      const now = Date.now();
      let mutated = false;
      for (const row of rowsInHold) {
        if (row.recentlyCompletedAt === undefined) {
          row.uncheckedLeavingAt = undefined;
          rowsInHold.delete(row);
          mutated = true;
          continue;
        }

        if (row.uncheckedLeavingAt !== undefined) {
          if (now - row.uncheckedLeavingAt >= UNCHECKED_LEAVE_MS) {
            row.recentlyCompletedAt = undefined;
            row.uncheckedLeavingAt = undefined;
            rowsInHold.delete(row);
            mutated = true;
          }
          continue;
        }

        if (now - row.recentlyCompletedAt >= HOLD_MS) {
          row.uncheckedLeavingAt = now;
          mutated = true;
        }
      }
      if (mutated) checkRowsRefreshScheduler.schedule(refreshCheckRowsRef);
      if (rowsInHold.size === 0) stopHoldSweep();
    }, HOLD_SWEEP_MS);
  }

  function stopHoldSweep(): void {
    if (holdSweepInterval !== null) {
      clearInterval(holdSweepInterval);
      holdSweepInterval = null;
    }
  }

  /** 检测取消/重置/视图切换时清空 hold——防止下次进入看到残影 */
  function clearAllHolds(): void {
    for (const row of rowsInHold) {
      row.recentlyCompletedAt = undefined;
      row.uncheckedLeavingAt = undefined;
    }
    rowsInHold.clear();
    stopHoldSweep();
  }

  // composable scope 释放（视图卸载/热更新/路由切换）时必须停掉 sweep interval；
  // 否则 timer 会继续按 HOLD_SWEEP_MS 调用 schedule(refreshCheckRowsRef)，对已无消费者的 checkRows 做无用更新，
  // 直到最后一行 hold 过期才自然熄火，期间形成短时间的内存与计算泄漏。
  if (getCurrentScope()) {
    onScopeDispose(() => { clearAllHolds(); });
  }

  /**
   * 把进度事件里的逐条结果实时 patch 到对应行——同时打 recentlyCompletedAt 时间戳
   * 让 useCheckFilter 在 hold 窗口内继续把它们留在原 tab；窗口到期由 sweep 清零。
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
      target.recentlyCompletedAt = now;
      target.uncheckedLeavingAt = undefined;
      rowsInHold.add(target);
      mutated = true;
    }
    if (mutated) {
      ensureHoldSweep();
      checkRowsRefreshScheduler.schedule(refreshCheckRowsRef);
    }
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

  /** 判断检测结果是否会导致行离开当前筛选（Case B） */
  function wouldLeaveFilter(result: CheckLinkResult, filter: StatusFilter | undefined): boolean {
    if (filter === 'all') return false;
    if (filter == null) return false;
    switch (filter) {
      case 'problems': return result.is_valid;
      case 'unchecked': return true;
      case 'valid': return !result.is_valid;
      case 'invalid': return result.is_valid || result.error_type === 'timeout' || result.error_type === 'suspicious' || result.browser_might_work;
      case 'timeout': return result.error_type !== 'timeout';
      case 'suspicious': return result.error_type !== 'suspicious' && !result.browser_might_work;
      default: return false;
    }
  }

  /** 执行单条检测请求（含最短转圈等待，避免按钮过快闪烁） */
  async function performRecheckRequest(row: LinkCheckRow): Promise<CheckLinkResult> {
    const [result] = await Promise.all([
      invoke<CheckLinkResult>('check_image_link', {
        link: row.url,
        fallbackUrl: row.fallbackUrl ?? null,
      }),
      new Promise<void>((resolve) => setTimeout(resolve, RECHECK_MS.SPIN_MIN)),
    ]);
    return result;
  }

  /** 复检结果动画：展示徽章 → Case A/B 淡出 */
  async function animateRecheckResult(row: LinkCheckRow, result: CheckLinkResult, currentFilter: StatusFilter | undefined): Promise<void> {
    if (!updateRow(row, (t) => { t.recheckLoading = false; t.recheckResult = result; })) return;
    await new Promise((resolve) => setTimeout(resolve, RECHECK_MS.RESULT_SHOW));

    if (wouldLeaveFilter(result, currentFilter)) {
      // Case B：整行淡出 → 提交最终状态 → filteredRows 重算，行消失
      if (!updateRow(row, (t) => { t.fadingOut = true; })) return;
      await new Promise((resolve) => setTimeout(resolve, RECHECK_MS.ROW_FADE));
      updateRow(row, (t) => { t.checkResult = result; t.recheckResult = undefined; t.fadingOut = false; });
    } else {
      // Case A：徽章淡出 → 左侧状态更新，行留在列表
      if (!updateRow(row, (t) => { t.recheckBadgeFading = true; })) return;
      await new Promise((resolve) => setTimeout(resolve, RECHECK_MS.BADGE_FADE));
      updateRow(row, (t) => {
        t.pinnedSortWeight = SEVERITY[t.checkResult?.error_type ?? 'success'] ?? 5; // 锁定排序位置
        t.checkResult = result;
        t.recheckResult = undefined;
        t.recheckBadgeFading = false;
      });
    }
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

  async function recheckSingle(row: LinkCheckRow, currentFilter?: StatusFilter): Promise<void> {
    const key = linkCheckRowKey(row);
    const existingIdx = rowIndexMap.get(key);
    const existing = existingIdx !== undefined ? checkRows.value[existingIdx] : undefined;
    if (existing?.recheckLoading || existing?.recheckResult) return;

    activeRecheckCount++;
    try {
      if (!updateRow(row, (t) => { t.recheckLoading = true; })) return;
      const result = await performRecheckRequest(row);
      await persistRecheckResult(row, result);
      await animateRecheckResult(row, result, currentFilter);
    } catch (err) {
      updateRow(row, (t) => {
        t.recheckLoading = false; t.recheckResult = undefined; t.recheckBadgeFading = false;
        t.fadingOut = false; t.pinnedSortWeight = undefined;
      });
      log.error('单条检测失败', err);
      toast.error('检测失败', errorMessage(err));
    } finally {
      activeRecheckCount--;
    }
  }

  /**
   * 按 historyId 移除 checkRows 中的行（删除历史记录后调用）
   */
  function removeRowsByHistoryIds(ids: string[]): void {
    const idSet = new Set(ids);
    checkRows.value = checkRows.value.filter((r) => !idSet.has(r.historyId));
    rebuildRowIndex();
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
    if (isChecking.value || isPhase2Loading.value || progressUnlisten || activeRecheckCount > 0) return; // 检测/Phase2加载/复检动画进行中，不清理
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!isChecking.value) {
        checkRows.value = [];
        lastBatchResult.value = null;
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
    phase2Duration,
    progress,
    progressSource,
    lastBatchResult,
    checkRows,
    serviceStats,
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
    onViewActivated,
    onViewDeactivated,
  };
}
