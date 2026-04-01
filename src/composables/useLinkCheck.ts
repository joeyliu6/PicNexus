// 链接检测 Composable（单例模式）
// 负责批量检测历史链接有效性，管理检测状态和进度

import { ref, shallowRef, computed, type Ref, type ComputedRef } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { HistoryItem } from '../config/types';
import { useConfigManager } from './useConfig';
import { applyLinkPrefix } from './useCopyLink';
import { historyDB } from '../services/HistoryDatabase';
import { useToast } from './useToast';
import { createLogger } from '../utils/logger';
import {
  SEVERITY,
  type StatusFilter,
  type BatchCheckProgress,
  type BatchCheckResult,
  type BatchCheckRequestItem,
  type LinkCheckRow,
  type CheckLinkResult,
} from '../types/linkCheck';

const log = createLogger('LinkCheck');

// ============================================
// 单例共享状态
// ============================================

const isChecking = ref(false);
const isLoading = ref(false);
const progress: Ref<BatchCheckProgress | null> = ref(null);
const lastBatchResult: Ref<BatchCheckResult | null> = shallowRef(null);
const checkRows: Ref<LinkCheckRow[]> = shallowRef([]);

let progressUnlisten: UnlistenFn | null = null;
let checkSessionId = 0; // 防竞态：每次检测分配唯一 session，旧 finally 不会杀新检测

// 空闲释放：离开检测页面 5 分钟后自动清空数据，释放内存
const IDLE_RELEASE_MS = 5 * 60 * 1000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 链接检测管理器
 */
export function useLinkCheckManager() {
  const toast = useToast();
  const { loadConfig } = useConfigManager();

  /**
   * 从 HistoryItem 列表构建待检测 URL（同步版，需提前加载 config）
   * 对微博链接自动拼接当前前缀配置
   */
  function buildCheckItemsSync(items: HistoryItem[], config: import('../config/types').UserConfig): {
    requestItems: BatchCheckRequestItem[];
    rows: LinkCheckRow[];
  } {
    const requestItems: BatchCheckRequestItem[] = [];
    const rows: LinkCheckRow[] = [];

    for (const item of items) {
      if (!item.results) continue;
      for (const r of item.results) {
        if (r.status !== 'success' || !r.result?.url) continue;

        const rawUrl = r.result.url;
        const finalUrl = applyLinkPrefix(rawUrl, r.serviceId, config);
        // GitHub CDN 启用时：metadata.rawUrl 是原始 raw.githubusercontent.com URL
        // finalUrl 经模板转换后与 rawUrl 不同，用 rawUrl 作为 fallback
        const ghRaw = r.serviceId === 'github'
          ? ((r.result.metadata as Record<string, unknown>)?.rawUrl as string | undefined)
          : undefined;
        const fallbackUrl = (ghRaw && ghRaw !== finalUrl) ? ghRaw : undefined;

        requestItems.push({
          url: finalUrl,
          history_id: item.id,
          service_id: r.serviceId,
          fallback_url: fallbackUrl,
        });

        rows.push({
          historyId: item.id,
          serviceId: r.serviceId,
          url: finalUrl,
          rawUrl,
          fileName: item.localFileName,
          fallbackUrl,
        });
      }
    }

    return { requestItems, rows };
  }

  /** async 包装，兼容原有调用 */
  async function buildCheckItems(items: HistoryItem[]): Promise<{
    requestItems: BatchCheckRequestItem[];
    rows: LinkCheckRow[];
  }> {
    const config = await loadConfig();
    return buildCheckItemsSync(items, config);
  }

  /**
   * 从数据库加载所有历史链接，恢复已有的检测状态
   * 分块处理 + yield 主线程，避免长任务阻塞 UI
   */
  async function loadHistoryRows(): Promise<void> {
    if (isChecking.value) return;
    isLoading.value = true;

    try {
      await historyDB.open();
      const config = await loadConfig();
      const allRows: LinkCheckRow[] = [];

      for await (const batch of historyDB.getAllStream(500)) {
        // 每批立即处理：构建 rows + 恢复检测状态
        const { rows } = buildCheckItemsSync(batch, config);
        restoreCheckStatus(rows, batch);
        allRows.push(...rows);

        // 让出主线程，避免长时间阻塞 UI
        await yieldToMain();
      }

      checkRows.value = allRows;
    } catch (err) {
      log.error('加载历史检测数据失败', err);
    } finally {
      isLoading.value = false;
    }
  }

  /** 恢复已有的检测状态（用 Map O(1) 查找） */
  function restoreCheckStatus(rows: LinkCheckRow[], items: HistoryItem[]): void {
    const itemMap = new Map(items.map((i) => [i.id, i]));
    for (const row of rows) {
      const item = itemMap.get(row.historyId);
      if (item?.linkCheckStatus?.[row.serviceId]) {
        const saved = item.linkCheckStatus[row.serviceId];
        row.checkResult = {
          link: row.url,
          is_valid: saved.isValid,
          status_code: saved.statusCode,
          error_type: saved.errorType === 'pending' ? 'network' : saved.errorType,
          response_time: saved.responseTime,
          error: saved.error,
          browser_might_work: false,
        };
      }
    }
  }

  /** 让出主线程，防止长任务阻塞 UI 渲染 */
  function yieldToMain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
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
    progress.value = null;
    lastBatchResult.value = null;

    try {
      // 加载所有历史记录
      await historyDB.open();
      const allItems: HistoryItem[] = [];
      for await (const batch of historyDB.getAllStream(1000)) {
        allItems.push(...batch);
      }

      if (allItems.length === 0) {
        toast.info('无链接可检测', '历史记录为空');
        return null;
      }

      // 构建检测列表
      const { requestItems, rows } = await buildCheckItems(allItems);
      checkRows.value = rows;

      if (requestItems.length === 0) {
        toast.info('无链接可检测', '没有成功上传的链接');
        return null;
      }

      toast.info('开始检测');

      // 监听进度事件（带 session 校验，防止旧会话数据污染新会话）
      if (progressUnlisten) { progressUnlisten(); progressUnlisten = null; }
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
          concurrency: 10,
          per_host_limit: 3,
          timeout_secs: 10,
        },
      });

      if (checkSessionId !== mySession) return null;
      lastBatchResult.value = result;

      // 将检测结果关联到 rows（用 Map O(1) 查找替代 .find() O(n)）
      const rowMap = new Map(rows.map((r) => [`${r.url}::${r.historyId}`, r]));
      for (const itemResult of result.results) {
        const row = rowMap.get(`${itemResult.link}::${itemResult.history_id}`);
        if (row) {
          row.checkResult = itemResult as CheckLinkResult;
        }
      }
      checkRows.value = [...rows];

      // 写回 DB
      await updateHistoryCheckStatus(allItems, result);

      if (!result.cancelled) {
        toast.success(
          '检测完成',
          `有效 ${result.valid} / 失效 ${result.invalid} / 超时 ${result.timeout} / 疑似 ${result.suspicious}`,
        );
      }

      return result;
    } catch (err) {
      log.error('批量检测失败', err);
      toast.error('检测失败', String(err));
      return null;
    } finally {
      // 只有当前 session 才执行清理，防止旧 finally 杀死新检测
      if (checkSessionId === mySession) {
        isChecking.value = false;
        if (progressUnlisten) { progressUnlisten(); progressUnlisten = null; }
      }
    }
  }

  /**
   * 检测指定的 URL 列表（用于 MD 救援等）
   */
  async function checkUrls(items: BatchCheckRequestItem[]): Promise<BatchCheckResult | null> {
    if (items.length === 0) return null;

    // 监听进度（先清理旧监听器，防止累积泄漏）
    if (progressUnlisten) { progressUnlisten(); progressUnlisten = null; }
    progressUnlisten = await listen<BatchCheckProgress>(
      'link-check://progress',
      (event) => {
        progress.value = event.payload;
      },
    );

    try {
      const result = await invoke<BatchCheckResult>('batch_check_links', {
        request: {
          links: items,
          concurrency: 10,
          per_host_limit: 3,
          timeout_secs: 10,
        },
      });

      return result;
    } finally {
      if (progressUnlisten) {
        progressUnlisten();
        progressUnlisten = null;
      }
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
      if (progressUnlisten) { progressUnlisten(); progressUnlisten = null; }
      const checkedThisRound = progress.value?.checked ?? 0;
      toast.warn('检测已取消', `本次已检测 ${checkedThisRound} 条`);
      log.info('已发送取消请求');
    } catch (err) {
      log.error('取消失败', err);
    }
  }

  /**
   * 批量检测完成后，更新 DB 中的 linkCheckStatus/linkCheckSummary
   */
  async function updateHistoryCheckStatus(
    _items: HistoryItem[],
    result: BatchCheckResult,
  ): Promise<void> {
    // 按 historyId 分组检测结果
    const grouped = new Map<string, typeof result.results>();
    for (const r of result.results) {
      if (!r.history_id) continue;
      const list = grouped.get(r.history_id) || [];
      list.push(r);
      grouped.set(r.history_id, list);
    }

    // 逐条更新
    for (const [historyId, checkResults] of grouped) {
      const linkCheckStatus: NonNullable<HistoryItem['linkCheckStatus']> = {};
      for (const cr of checkResults) {
        const sid = cr.service_id || 'unknown';
        linkCheckStatus[sid] = {
          isValid: cr.is_valid,
          lastCheckTime: Date.now(),
          statusCode: cr.status_code,
          errorType: cr.error_type as 'success' | 'http_4xx' | 'http_5xx' | 'timeout' | 'network' | 'pending',
          responseTime: cr.response_time,
          error: cr.error || undefined,
        };
      }

      const totalLinks = checkResults.length;
      const validCount = checkResults.filter((r) => r.is_valid).length;

      const linkCheckSummary: NonNullable<HistoryItem['linkCheckSummary']> = {
        totalLinks,
        validLinks: validCount,
        invalidLinks: totalLinks - validCount,
        uncheckedLinks: 0,
        lastCheckTime: Date.now(),
      };

      try {
        await historyDB.update(historyId, { linkCheckStatus, linkCheckSummary });
      } catch (err) {
        log.error(`更新 ${historyId} 检测状态失败`, err);
      }
    }

    log.info(`已更新 ${grouped.size} 条历史记录的检测状态`);
  }

  /**
   * 导出检测结果为 CSV
   */
  function exportCsv(rows: LinkCheckRow[]): string {
    const header = '序号,文���名,图床,URL,状态,HTTP状态码,响应时间(ms),检测时间';
    const csvRows = rows.map((row, i) => {
      const r = row.checkResult;
      const status = r
        ? r.is_valid ? '有效' : r.error_type === 'timeout' ? '超时' : r.error_type === 'suspicious' ? '疑似异常' : '失效'
        : '未检测';
      return [
        i + 1,
        `"${row.fileName}"`,
        row.serviceId,
        `"${row.url}"`,
        status,
        r?.status_code || '',
        r?.response_time || '',
        new Date().toISOString(),
      ].join(',');
    });

    return [header, ...csvRows].join('\n');
  }

  // ============================================
  // 按图床分组的统计数据
  // ============================================

  const serviceStats: ComputedRef<import('../types/linkCheck').ServiceStat[]> = computed(() => {
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
    historyIds?: string[];
  }): Promise<BatchCheckResult | null> {
    if (isChecking.value) {
      toast.warn('检测进行中', '请等待当前检测完成');
      return null;
    }

    const rows = checkRows.value;
    const idSet = filter.historyIds ? new Set(filter.historyIds) : null;
    const filtered = rows.filter((row) => {
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
    progress.value = null;

    try {
      const requestItems: BatchCheckRequestItem[] = filtered.map((row) => ({
        url: row.url,
        history_id: row.historyId,
        service_id: row.serviceId,
        fallback_url: row.fallbackUrl,
      }));

      toast.info('开始检测');

      if (progressUnlisten) { progressUnlisten(); progressUnlisten = null; }
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
          concurrency: 10,
          per_host_limit: 3,
          timeout_secs: 10,
        },
      });

      if (checkSessionId !== mySession) return null;

      // 将检测结果更新到对应 row（用 Map O(1) 查找）
      const allRows = [...checkRows.value];
      const subsetMap = new Map(allRows.map((r) => [`${r.url}::${r.historyId}`, r]));
      for (const itemResult of result.results) {
        const row = subsetMap.get(`${itemResult.link}::${itemResult.history_id}`);
        if (row) {
          row.checkResult = itemResult as CheckLinkResult;
          row.pinnedSortWeight = undefined;
        }
      }
      checkRows.value = allRows;

      // 更新 DB
      await historyDB.open();
      const allItems: HistoryItem[] = [];
      for await (const batch of historyDB.getAllStream(1000)) {
        allItems.push(...batch);
      }
      await updateHistoryCheckStatus(allItems, result);

      if (!result.cancelled) {
        toast.success('检测完成', `有效 ${result.valid} / 失效 ${result.invalid}`);
      }

      return result;
    } catch (err) {
      log.error('子集检测失败', err);
      toast.error('检测失败', String(err));
      return null;
    } finally {
      if (checkSessionId === mySession) {
        isChecking.value = false;
        if (progressUnlisten) { progressUnlisten(); progressUnlisten = null; }
      }
    }
  }

  /**
   * 重新检测单条链接
   */

  /** 复制 checkRows、找到目标行、执行变更、触发响应式更新。返回 false 表示行已消失 */
  function updateRow(row: LinkCheckRow, updater: (target: LinkCheckRow) => void): boolean {
    const rows = [...checkRows.value];
    const target = rows.find((r) => r.url === row.url && r.historyId === row.historyId);
    if (!target) return false;
    updater(target);
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

  async function recheckSingle(row: LinkCheckRow, currentFilter?: StatusFilter): Promise<void> {
    // 防并发：已在检测或动画中则跳过
    const existing = checkRows.value.find((r) => r.url === row.url && r.historyId === row.historyId);
    if (existing?.recheckLoading || existing?.recheckResult) return;

    try {
      // 步骤1：按钮转圈（最短 400ms，避免过快闪烁）
      if (!updateRow(row, (t) => { t.recheckLoading = true; })) return;

      const [result] = await Promise.all([
        invoke<CheckLinkResult>('check_image_link', {
          link: row.url,
          fallbackUrl: row.fallbackUrl ?? null,
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 400)),
      ]);

      // 步骤2：停转，显示结果徽章
      if (!updateRow(row, (t) => { t.recheckLoading = false; t.recheckResult = result; })) return;

      // 步骤3：用户读结果 1s
      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (wouldLeaveFilter(result, currentFilter)) {
        // Case B：整行淡出 → 提交最终状态 → filteredRows 重算，行消失
        if (!updateRow(row, (t) => { t.fadingOut = true; })) return;
        await new Promise((resolve) => setTimeout(resolve, 350));
        updateRow(row, (t) => {
          t.checkResult = result;
          t.recheckResult = undefined;
          t.fadingOut = false;
        });
      } else {
        // Case A：徽章淡出 → 左侧状态更新，行留在列表
        if (!updateRow(row, (t) => { t.recheckBadgeFading = true; })) return;
        await new Promise((resolve) => setTimeout(resolve, 300));
        updateRow(row, (t) => {
          // 锁定排序位置，防止 checkResult 更新触发行位置跳动
          t.pinnedSortWeight = SEVERITY[t.checkResult?.error_type ?? 'success'] ?? 5;
          t.checkResult = result;
          t.recheckResult = undefined;
          t.recheckBadgeFading = false;
        });
      }

      // 更新 DB
      await historyDB.open();
      const item = await historyDB.getById(row.historyId);
      if (item) {
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
    } catch (err) {
      updateRow(row, (t) => {
        t.recheckLoading = false;
        t.recheckResult = undefined;
        t.recheckBadgeFading = false;
        t.fadingOut = false;
        t.pinnedSortWeight = undefined;
      });
      log.error('单条检测失败', err);
      toast.error('检测失败', String(err));
    }
  }

  /**
   * 按 historyId 移除 checkRows 中的行（删除历史记录后调用）
   */
  function removeRowsByHistoryIds(ids: string[]): void {
    const idSet = new Set(ids);
    checkRows.value = checkRows.value.filter((r) => !idSet.has(r.historyId));
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

  /** 页面激活时：取消空闲计时，如果数据已被清空则重新加载 */
  function onViewActivated(): void {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (checkRows.value.length === 0 && !isLoading.value) {
      loadHistoryRows();
    }
  }

  /** 页面离开时：启动空闲计时，到期释放数据 */
  function onViewDeactivated(): void {
    if (isChecking.value || progressUnlisten) return; // 检测进行中或后台仍在工作，不清理
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!isChecking.value) {
        checkRows.value = [];
        lastBatchResult.value = null;
        log.info('空闲超时，已释放检测数据');
      }
      idleTimer = null;
    }, IDLE_RELEASE_MS);
  }

  return {
    // 状态
    isChecking,
    isLoading,
    progress,
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
    setFadingOut,
    onViewActivated,
    onViewDeactivated,
  };
}
