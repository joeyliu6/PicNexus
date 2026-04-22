// 链接检测 Composable（单例模式）
// 负责批量检测历史链接有效性，管理检测状态和进度

/* eslint-disable max-lines -- singleton state machine kept together for link monitor behavior */
import { ref, shallowRef, computed, type Ref, type ComputedRef } from 'vue';
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
  type BatchCheckRequestItem,
  type LinkCheckRow,
  type CheckLinkResult,
  type ServiceStat,
} from '../../types/linkCheck';
import {
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
const isLoading = ref(false);
/** Phase 2 后台加载中标志：Phase 1 结束后为 true，Phase 2 全部到达后为 false */
const isPhase2Loading = ref(false);
/** Phase 2 耗时（ms）：用于 UI 侧判断是否跳过动画（<300ms 则跳过） */
const phase2Duration = ref(0);
const progress: Ref<BatchCheckProgress | null> = ref(null);
/** 进度来源标识：区分是链接监控还是文档修复在跑，防止 UI 串扰 */
const progressSource: Ref<'monitor' | 'rescue' | null> = ref(null);
const lastBatchResult: Ref<BatchCheckResult | null> = shallowRef(null);
const checkRows: Ref<LinkCheckRow[]> = shallowRef([]);

let progressUnlisten: UnlistenFn | null = null;
let checkSessionId = 0; // 防竞态：每次检测分配唯一 session，旧 finally 不会杀新检测
let activeRecheckCount = 0; // 防 onViewDeactivated 在单条复检动画期间误触发空闲释放

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

// 空闲释放：离开检测页面 5 分钟后自动清空数据，释放内存
const IDLE_RELEASE_MS = 5 * 60 * 1000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

// TTL 缓存：避免反复切换页面时重复加载
const CACHE_TTL_MS = 5 * 60 * 1000;
let lastLoadTime = 0;

/** recheckSingle 各阶段动画时长（ms）：转圈最短/结果展示/行淡出/徽章淡出 */
const RECHECK_MS = { SPIN_MIN: 400, RESULT_SHOW: 1000, ROW_FADE: 350, BADGE_FADE: 300 } as const;

// 与历史事件同步——不响应会导致检测视图持有"幽灵行"（历史已清空/更新但检测页仍显示旧状态）
onCacheEvent((p) => { if (p.type === 'history-cleared') { checkRows.value = []; lastBatchResult.value = null; lastLoadTime = 0; } else if (p.type === 'history-updated') lastLoadTime = 0; }).catch(e => log.warn('[LinkCheck] 缓存事件监听失败:', e));

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

  /** 检测结束时的清理（带 session 守卫，防止旧 finally 杀死新检测） */
  function finalizeCheck(session: number): void {
    if (checkSessionId === session) {
      isChecking.value = false;
      progressSource.value = null;
      clearProgressListener();
    }
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
  async function loadHistoryRows(): Promise<void> {
    if (isChecking.value) return;

    // TTL 缓存：5 分钟内重复进入直接跳过
    if (checkRows.value.length > 0 && Date.now() - lastLoadTime < CACHE_TTL_MS) {
      return;
    }

    isLoading.value = true;

    try {
      await historyDB.open();
      const config = await loadConfig();

      // Phase 1：快速加载有问题的记录（失效 + 未检测）
      const invalidLiteRows = await historyDB.getLinkCheckInvalid();
      const invalidItems = invalidLiteRows.map(liteRowToItem);
      const { rows: invalidRows } = buildCheckItemsSync(invalidItems, config);
      restoreCheckStatus(invalidRows, invalidItems);
      checkRows.value = invalidRows;
      rebuildRowIndex();
      isLoading.value = false; // 提前结束 loading，用户已看到失效数据

      // Phase 2：后台静默加载剩余记录
      // 先收集所有批次到临时数组，避免每批都 [...checkRows, ...batch] 导致 O(n²) 复制
      isPhase2Loading.value = true;
      const phase2Start = Date.now();
      const loadedIds = new Set(invalidLiteRows.map((r) => r.id));
      const pendingRows: LinkCheckRow[] = [];
      for await (const batch of historyDB.getLinkCheckRestStream(loadedIds, 2000, { includeSkipped: true })) {
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
    isChecking.value = true;
    resetCheckState();
    progressSource.value = 'monitor';

    try {
      // 确保数据已加载（复用已加载的 checkRows，避免重复全表扫描）
      if (checkRows.value.length === 0) {
        await loadHistoryRows();
      }

      const rows = checkRows.value.filter((row) => !row.linkCheckSkip);
      if (rows.length === 0) {
        toast.info('无链接可检测', '历史记录为空');
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
        toast.info('无链接可检测', '没有成功上传的链接');
        return null;
      }

      toast.info('开始检测');

      // 监听进度事件（带 session 校验，防止旧会话数据污染新会话）
      clearProgressListener();
      progressUnlisten = await listen<BatchCheckProgress>(
        'link-check://progress',
        (event) => {
          if (checkSessionId !== mySession) return;
          progress.value = event.payload;
        },
      );

      // 调用 Rust 批量检测
      const result = await invoke<BatchCheckResult>('batch_check_links', {
        request: {
          links: requestItems,
          ...DEFAULT_CHECK_PARAMS,
        },
      });

      // 即使被取消，也要处理已完成的结果并入库
      lastBatchResult.value = result;
      applyResultsToRows(rows, result.results);
      checkRows.value = [...rows];
      rebuildRowIndex();

      // 写回 DB
      await updateHistoryCheckStatus(result);
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
      toast.error('检测失败', String(err));
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

    isChecking.value = true;
    progressSource.value = source;
    progress.value = null;

    // 监听进度（先清理旧监听器，防止累积泄漏）
    clearProgressListener();
    progressUnlisten = await listen<BatchCheckProgress>(
      'link-check://progress',
      (event) => {
        progress.value = event.payload;
        onProgress?.(event.payload);
      },
    );

    try {
      const result = await invoke<BatchCheckResult>('batch_check_links', {
        request: {
          links: items,
          ...DEFAULT_CHECK_PARAMS,
        },
      });

      return result;
    } finally {
      isChecking.value = false;
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
      progressSource.value = null;
      clearProgressListener();
      // toast 移至检测函数中，入库后再提示（含已入库数量）
      log.info('已发送取消请求');
    } catch (err) {
      log.error('取消失败', err);
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
      if (row.linkCheckSkip) continue;
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
    historyIds?: string[];
  }): Promise<BatchCheckResult | null> {
    if (isChecking.value) {
      toast.warn('检测进行中', '请等待当前检测完成');
      return null;
    }

    const rows = checkRows.value;
    const idSet = filter.historyIds ? new Set(filter.historyIds) : null;
    const filtered = rows.filter((row) => {
      if (row.linkCheckSkip) return false;
      if (idSet) return idSet.has(row.historyId);
      if (filter.serviceId && row.serviceId !== filter.serviceId) return false;
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
      toast.info('无链接可检测', '筛选结果为空');
      return null;
    }

    const mySession = ++checkSessionId;
    isChecking.value = true;
    progressSource.value = 'monitor';
    progress.value = null;

    try {
      const requestItems: BatchCheckRequestItem[] = filtered.map((row) => ({
        url: row.url,
        history_id: row.historyId,
        service_id: row.serviceId,
        fallback_url: row.fallbackUrl,
      }));

      toast.info('开始检测');

      clearProgressListener();
      progressUnlisten = await listen<BatchCheckProgress>(
        'link-check://progress',
        (event) => {
          if (checkSessionId !== mySession) return;
          progress.value = event.payload;
        },
      );

      const result = await invoke<BatchCheckResult>('batch_check_links', {
        request: {
          links: requestItems,
          ...DEFAULT_CHECK_PARAMS,
        },
      });

      // 即使被取消，也要处理已完成的结果并入库
      const allRows = [...checkRows.value];
      applyResultsToRows(allRows, result.results);
      // 子集复检需清除排序锁定
      const rowMap = new Map(allRows.map((r) => [`${r.url}::${r.historyId}`, r]));
      for (const itemResult of result.results) {
        const row = rowMap.get(`${itemResult.link}::${itemResult.history_id}`);
        if (row) row.pinnedSortWeight = undefined;
      }
      checkRows.value = allRows;

      // 更新 DB
      await updateHistoryCheckStatus(result);
      lastLoadTime = 0; // 检测完成后清除缓存

      // session 守卫移到结果入库之后：只控制 toast 显示和返回值
      if (checkSessionId !== mySession) {
        if (result.cancelled) {
          toast.warn('已停止检测', `已完成 ${result.results.length} 条，结果已保存。可通过「仅未检测」继续剩余部分`);
        }
        return null;
      }

      if (!result.cancelled) {
        toast.success('检测完成', `共 ${result.total} 条：有效 ${result.valid} / 失效 ${result.invalid}`);
      }

      return result;
    } catch (err) {
      log.error('子集检测失败', err);
      toast.error('检测失败', String(err));
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
      checkRows.value.map((r, i) => [`${r.url}::${r.historyId}`, i])
    );
  }

  /** 复制 checkRows、通过 Map O(1) 找到目标行、执行变更、触发响应式更新 */
  function updateRow(row: LinkCheckRow, updater: (target: LinkCheckRow) => void): boolean {
    const key = `${row.url}::${row.historyId}`;
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
    if (filter === null) return result.is_valid;
    switch (filter) {
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
    await historyDB.open();
    const item = await historyDB.getById(row.historyId);
    if (!item) return;
    const linkCheckStatus = item.linkCheckStatus || {};
    linkCheckStatus[row.serviceId] = {
      isValid: result.is_valid,
      lastCheckTime: Date.now(),
      statusCode: result.status_code,
      errorType: result.error_type as 'success' | 'http_4xx' | 'http_5xx' | 'timeout' | 'network' | 'pending',
      responseTime: result.response_time,
      error: result.error || undefined,
    };
    await historyDB.update(row.historyId, { linkCheckStatus });
  }

  async function recheckSingle(row: LinkCheckRow, currentFilter?: StatusFilter): Promise<void> {
    const key = `${row.url}::${row.historyId}`;
    const existingIdx = rowIndexMap.get(key);
    const existing = existingIdx !== undefined ? checkRows.value[existingIdx] : undefined;
    if (existing?.recheckLoading || existing?.recheckResult) return;

    activeRecheckCount++;
    try {
      if (!updateRow(row, (t) => { t.recheckLoading = true; })) return;
      const result = await performRecheckRequest(row);
      await animateRecheckResult(row, result, currentFilter);
      await persistRecheckResult(row, result);
    } catch (err) {
      updateRow(row, (t) => {
        t.recheckLoading = false; t.recheckResult = undefined; t.recheckBadgeFading = false;
        t.fadingOut = false; t.pinnedSortWeight = undefined;
      });
      log.error('单条检测失败', err);
      toast.error('检测失败', String(err));
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

  function setLinkCheckSkipState(historyIds: string[], skip: boolean): void {
    const idSet = new Set(historyIds);
    const rows = [...checkRows.value];

    for (const row of rows) {
      if (idSet.has(row.historyId)) {
        row.linkCheckSkip = skip;
      }
    }

    checkRows.value = rows;
  }

  /**
   * 设置指定行的 fadingOut 状态（用于删除前的淡出动画）
   */
  function setFadingOut(historyIds: string[], value: boolean): void {
    const idSet = new Set(historyIds);
    const rows = [...checkRows.value];
    for (const row of rows) {
      if (idSet.has(row.historyId)) row.fadingOut = value;
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
    checkAllHistoryLinks,
    checkSubset,
    recheckSingle,
    checkUrls,
    cancelCheck,
    exportCsv,
    buildCheckItems,
    removeRowsByHistoryIds,
    setLinkCheckSkipState,
    setFadingOut,
    onViewActivated,
    onViewDeactivated,
  };
}
