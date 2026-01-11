// src/composables/useHistory.ts
// 历史记录管理 Composable（单例模式）
// 纯数据层：使用 SQLite 数据库存储，支持大数据量分页和搜索
// v3.0: 视图状态已移至 useHistoryViewState.ts

import { ref, shallowRef, type Ref } from 'vue';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { HistoryItem, ServiceType } from '../config/types';
import { getActivePrefix } from '../config/types';
import { historyDB, type PageResult, type SearchResult, type SearchOptions, type TimePeriodStats } from '../services/HistoryDatabase';
import type { ImageMeta } from '../types/image-meta';
import { extractMetaFromHistoryItem } from '../types/image-meta';
import { useImageDetailCache } from './useImageDetailCache';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import { useConfigManager } from './useConfig';
import {
  onCacheEvent,
  emitHistoryDeleted,
  emitHistoryCleared,
  type CacheEventPayload,
  type HistoryEventData
} from '../events/cacheEvents';

// ============================================
// 单例共享状态（模块级别）
// ============================================

// 所有图片元数据（轻量级，全量加载）
const sharedImageMetas: Ref<ImageMeta[]> = shallowRef([]);

// 加载中状态
const sharedIsLoading = ref(false);

// 数据是否已加载（用于缓存判断）
const isDataLoaded = ref(false);

// 数据版本号（用于追踪变化）
const dataVersion = ref(0);

// === TTL 缓存相关 ===
const CACHE_TTL = 5 * 60 * 1000;  // 5 分钟 TTL
const lastLoadTime = ref<number>(0);

/**
 * 检查缓存是否有效（未过期）
 */
function isCacheValid(): boolean {
  if (!isDataLoaded.value) return false;
  if (lastLoadTime.value === 0) return false;
  return Date.now() - lastLoadTime.value < CACHE_TTL;
}

// === 跨窗口同步 ===
let crossWindowListenerInitialized = false;

// 总数（无需分页）
const totalCount = ref(0);

// 时间段统计（用于时间轴完整显示）
const sharedTimePeriodStats: Ref<TimePeriodStats[]> = shallowRef([]);
const isTimePeriodStatsLoaded = ref(false);

/**
 * 模块级别的数据重新加载函数（用于事件处理）
 * 直接更新 sharedImageMetas，供时间轴视图使用
 */
async function reloadSharedData(): Promise<void> {
  try {
    sharedIsLoading.value = true;
    await historyDB.open();

    // 并行加载元数据和时间段统计
    const [metas, timePeriodStats] = await Promise.all([
      historyDB.getMetaList(),
      historyDB.getTimePeriodStats(),
    ]);

    sharedImageMetas.value = metas;
    totalCount.value = metas.length;
    sharedTimePeriodStats.value = timePeriodStats;
    isTimePeriodStatsLoaded.value = true;

    console.log(`[历史记录] 事件触发重新加载: ${metas.length} 条元数据, ${timePeriodStats.length} 个月份`);

    isDataLoaded.value = true;
    lastLoadTime.value = Date.now();
    dataVersion.value++;
  } catch (error) {
    console.error('[历史记录] 事件触发重新加载失败:', error);
  } finally {
    sharedIsLoading.value = false;
  }
}

/**
 * 初始化跨窗口事件监听（单例）
 */
function initCrossWindowListener(): void {
  if (crossWindowListenerInitialized) return;
  crossWindowListenerInitialized = true;

  onCacheEvent((payload: CacheEventPayload) => {
    const data = payload.data as HistoryEventData | undefined;

    switch (payload.type) {
      case 'history-deleted':
        if (data?.ids && data.ids.length > 0) {
          console.log('[历史记录] 跨窗口同步: 删除', data.ids);
          const deletedSet = new Set(data.ids);
          sharedImageMetas.value = sharedImageMetas.value.filter(
            meta => !deletedSet.has(meta.id)
          );
          totalCount.value = Math.max(0, totalCount.value - data.ids.length);
          dataVersion.value++;
        }
        break;

      case 'history-cleared':
        console.log('[历史记录] 跨窗口同步: 清空');
        sharedImageMetas.value = [];
        totalCount.value = 0;
        dataVersion.value++;
        break;

      case 'history-updated':
        console.log('[历史记录] 跨窗口同步: 更新，重新加载数据');
        isDataLoaded.value = false;
        // 强制重新加载数据，确保时间轴视图能获取最新数据
        reloadSharedData();
        break;
    }
  }).catch(e => {
    console.warn('[历史记录] 跨窗口监听设置失败:', e);
  });
}

/**
 * 使缓存失效，下次 loadHistory 将强制重新加载
 */
export function invalidateCache(): void {
  isDataLoaded.value = false;
  lastLoadTime.value = 0;
  console.log('[历史记录] 缓存已失效');
}

/**
 * 历史记录管理 Composable（单例模式）
 * 纯数据层：所有组件共享同一份数据
 */
export function useHistoryManager() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const detailCache = useImageDetailCache();

  // 初始化跨窗口事件监听（单例）
  initCrossWindowListener();

  // 使用共享状态（单例）
  const imageMetas = sharedImageMetas;
  const isLoading = sharedIsLoading;

  /**
   * 初始化数据库
   */
  async function initDatabase(): Promise<void> {
    await historyDB.open();
  }

  /**
   * 加载历史记录元数据（全量加载）
   * @param forceReload 是否强制重新加载（忽略缓存）
   */
  async function loadHistory(forceReload = false): Promise<void> {
    // 如果缓存有效且不强制刷新，直接返回
    if (isCacheValid() && !forceReload) {
      console.log('[历史记录] 缓存命中（TTL 有效），跳过加载');
      return;
    }

    if (isDataLoaded.value && !isCacheValid()) {
      console.log('[历史记录] 缓存已过期（TTL），重新加载');
    }

    try {
      isLoading.value = true;

      await initDatabase();

      // 全量加载元数据
      const metas = await historyDB.getMetaList();

      imageMetas.value = metas;
      totalCount.value = metas.length;

      console.log(`[历史记录] 加载完成: ${metas.length} 条元数据`);

      isDataLoaded.value = true;
      lastLoadTime.value = Date.now();
      dataVersion.value++;

    } catch (error) {
      console.error('[历史记录] 加载失败:', error);
      toast.error('加载失败', String(error));
      imageMetas.value = [];
    } finally {
      isLoading.value = false;
    }
  }


  /**
   * 删除单个历史记录项
   */
  async function deleteHistoryItem(itemId: string): Promise<void> {
    try {
      if (!itemId || typeof itemId !== 'string' || itemId.trim().length === 0) {
        console.error('[历史记录] 删除失败: 无效的 itemId:', itemId);
        toast.error('删除失败', '无效的项目ID');
        return;
      }

      const confirmed = await confirm(
        '您确定要从本地历史记录中删除此条目吗？此操作不会删除已上传到图床的图片。',
        '确认删除'
      );

      if (!confirmed) {
        console.log('[历史记录] 用户取消删除');
        return;
      }

      await historyDB.delete(itemId);

      console.log('[历史记录] ✓ 删除成功:', itemId);
      toast.success('删除成功', '历史记录已删除');

      // 更新元数据
      imageMetas.value = imageMetas.value.filter(meta => meta.id !== itemId);
      totalCount.value = Math.max(0, totalCount.value - 1);
      dataVersion.value++;

      // 清除详情缓存
      detailCache.removeDetail(itemId);

      emitHistoryDeleted([itemId]).catch(e => {
        console.warn('[历史记录] 跨窗口通知失败:', e);
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[历史记录] 删除失败:', error);
      toast.error('删除失败', errorMsg);
    }
  }

  /**
   * 清空所有历史记录
   */
  async function clearHistory(): Promise<void> {
    try {
      const confirmed = await confirm(
        '确定要清空所有上传历史记录吗？此操作不可撤销。',
        '确认清空'
      );

      if (!confirmed) {
        return;
      }

      await historyDB.clear();

      toast.success('清空成功', '所有历史记录已清空');

      // 清空元数据
      imageMetas.value = [];
      totalCount.value = 0;
      dataVersion.value++;

      // 清除详情缓存
      detailCache.clearCache();

      emitHistoryCleared().catch(e => {
        console.warn('[历史记录] 跨窗口通知失败:', e);
      });

    } catch (error) {
      console.error('[历史记录] 清空失败:', error);
      toast.error('清空失败', String(error));
    }
  }

  /**
   * 导出所有历史记录为 JSON
   */
  async function exportToJson(): Promise<void> {
    try {
      const count = await historyDB.getCount();
      if (count === 0) {
        toast.warn('无数据', '没有可导出的历史记录');
        return;
      }

      const jsonContent = await historyDB.exportToJSON();
      const filePath = await saveDialog({
        defaultPath: 'picnexus_export.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });

      if (!filePath) {
        console.log('[历史记录] 用户取消导出');
        return;
      }

      await writeTextFile(filePath, jsonContent);
      toast.success('导出成功', `已导出 ${count} 条记录`);

    } catch (error) {
      console.error('[历史记录] 导出失败:', error);
      toast.error('导出失败', String(error));
    }
  }

  /**
   * 批量复制链接
   */
  async function bulkCopyLinks(selectedIds: string[]): Promise<void> {
    try {
      if (selectedIds.length === 0) {
        toast.warn('未选择项目', '请先选择要复制的项目');
        return;
      }

      const selectedMetas = imageMetas.value.filter(meta => selectedIds.includes(meta.id));
      const { config } = useConfigManager();
      const currentConfig = config.value;
      const activePrefix = getActivePrefix(currentConfig);

      const links = selectedMetas.map(meta => {
        if (!meta.primaryUrl) return null;
        if (meta.primaryService === 'weibo' && activePrefix) {
          return `${activePrefix}${meta.primaryUrl}`;
        }
        return meta.primaryUrl;
      }).filter((link): link is string => !!link);

      if (links.length === 0) {
        toast.warn('无可用链接', '选中的项目没有可用链接');
        return;
      }

      await writeText(links.join('\n'));
      toast.success('已复制', `已复制 ${links.length} 个链接到剪贴板`, 1500);
      console.log(`[批量操作] 已复制 ${links.length} 个链接`);

    } catch (error: any) {
      console.error('[批量操作] 复制失败:', error);
      toast.error('复制失败', error.message || String(error));
    }
  }

  /**
   * 批量导出为 JSON
   */
  async function bulkExportJSON(selectedIds: string[]): Promise<void> {
    try {
      if (selectedIds.length === 0) {
        toast.warn('未选择项目', '请先选择要导出的项目');
        return;
      }

      // 从数据库加载完整详情
      const selectedItems: HistoryItem[] = [];
      for (const id of selectedIds) {
        try {
          const detail = await detailCache.getDetail(id);
          selectedItems.push(detail);
        } catch (e) {
          console.warn(`[批量操作] 跳过无效记录: ${id}`, e);
        }
      }

      if (selectedItems.length === 0) {
        toast.warn('无可用数据', '选中的项目无法加载');
        return;
      }

      const jsonContent = JSON.stringify(selectedItems, null, 2);

      const filePath = await saveDialog({
        defaultPath: `picnexus-history-${Date.now()}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });

      if (!filePath) {
        console.log('[批量操作] 用户取消导出');
        return;
      }

      await writeTextFile(filePath, jsonContent);

      toast.success('导出成功', `已导出 ${selectedItems.length} 条记录`);
      console.log(`[批量操作] 已导出 ${selectedItems.length} 条记录`);

    } catch (error: any) {
      console.error('[批量操作] 导出失败:', error);
      toast.error('导出失败', error.message || String(error));
    }
  }

  /**
   * 批量删除记录
   */
  async function bulkDeleteRecords(selectedIds: string[]): Promise<void> {
    try {
      if (selectedIds.length === 0) {
        toast.warn('未选择项目', '请先选择要删除的项目');
        return;
      }

      const confirmed = await confirm(
        `确定要删除选中的 ${selectedIds.length} 条历史记录吗？此操作不可撤销。`,
        '批量删除确认'
      );

      if (!confirmed) {
        console.log('[批量操作] 用户取消删除');
        return;
      }

      await historyDB.deleteMany(selectedIds);

      toast.success('删除成功', `已删除 ${selectedIds.length} 条记录`);
      console.log(`[批量操作] 已删除 ${selectedIds.length} 条记录`);

      const selectedIdSet = new Set(selectedIds);
      imageMetas.value = imageMetas.value.filter(meta => !selectedIdSet.has(meta.id));
      totalCount.value = Math.max(0, totalCount.value - selectedIds.length);
      dataVersion.value++;

      // 清除详情缓存
      selectedIds.forEach(id => detailCache.removeDetail(id));

      emitHistoryDeleted(selectedIds).catch(e => {
        console.warn('[历史记录] 跨窗口通知失败:', e);
      });

    } catch (error: any) {
      console.error('[批量操作] 删除失败:', error);
      toast.error('删除失败', error.message || String(error));
    }
  }

  /**
   * 加载全量历史记录（独立于分页状态）
   * 用于 LinkCheckerView 等需要完整数据的场景
   */
  async function loadAllHistory(): Promise<HistoryItem[]> {
    await initDatabase();

    const allItems: HistoryItem[] = [];
    for await (const batch of historyDB.getAllStream(1000)) {
      allItems.push(...batch);
    }

    return allItems;
  }

  /**
   * 按页码加载数据（用于表格视图服务端分页）
   * 不影响 imageMetas，返回独立的分页结果
   *
   * @param page 页码（从 1 开始）
   * @param pageSize 每页数量（默认 100）
   * @param serviceFilter 图床筛选
   * @returns 分页结果
   */
  async function loadPageByNumber(
    page: number,
    pageSize: number = 100,
    serviceFilter: ServiceType | 'all' = 'all'
  ): Promise<PageResult> {
    await initDatabase();
    const result = await historyDB.getPage({
      page,
      pageSize,
      serviceFilter: serviceFilter === 'all' ? undefined : serviceFilter,
    });
    console.log(`[历史记录] 加载第 ${page} 页: ${result.items.length}/${result.total} 条`);
    return result;
  }

  /**
   * 搜索历史记录（支持分页）
   *
   * @param keyword 搜索关键词
   * @param options 搜索选项（serviceFilter、limit、offset）
   * @returns 搜索结果
   */
  async function searchHistory(
    keyword: string,
    options: SearchOptions = {}
  ): Promise<SearchResult> {
    await initDatabase();
    const result = await historyDB.search(keyword, options);
    console.log(`[历史记录] 搜索"${keyword}": ${result.items.length}/${result.total} 条`);
    return result;
  }

  /**
   * 加载时间段统计信息（轻量级，用于时间轴完整显示）
   * 只在首次加载或数据变化时调用
   */
  async function loadTimePeriodStats(): Promise<TimePeriodStats[]> {
    // 如果已加载，直接返回缓存
    if (isTimePeriodStatsLoaded.value && sharedTimePeriodStats.value.length > 0) {
      return sharedTimePeriodStats.value;
    }

    await initDatabase();
    const stats = await historyDB.getTimePeriodStats();
    sharedTimePeriodStats.value = stats;
    isTimePeriodStatsLoaded.value = true;
    console.log(`[历史记录] 加载时间段统计: ${stats.length} 个月份`);
    return stats;
  }

  /**
   * 跳转到指定月份（验证该月份是否有数据）
   * 在新架构下，所有元数据已加载，此函数仅验证目标月份存在性
   * 实际滚动定位由 TimelineView 负责
   *
   * @param year 年份
   * @param month 月份 (0-11)
   * @returns 是否成功跳转
   */
  async function jumpToMonth(year: number, month: number): Promise<boolean> {
    try {
      isLoading.value = true;

      // 从时间段统计中找到目标月份
      const targetPeriod = sharedTimePeriodStats.value.find(
        p => p.year === year && p.month === month
      );

      if (!targetPeriod) {
        console.warn(`[历史记录] 未找到目标月份: ${year}年${month + 1}月`);
        return false;
      }

      // 验证元数据中是否有该月份的数据
      const hasData = imageMetas.value.some(meta => {
        const date = new Date(meta.timestamp);
        return date.getFullYear() === year && date.getMonth() === month;
      });

      if (!hasData) {
        console.warn(`[历史记录] 目标月份无数据: ${year}年${month + 1}月`);
        return false;
      }

      console.log(`[历史记录] 跳转到 ${year}年${month + 1}月`);
      return true;

    } catch (error) {
      console.error(`[历史记录] 跳转失败:`, error);
      toast.error('跳转失败', String(error));
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  return {
    // 状态
    imageMetas,  // ← 改为元数据（原 allHistoryItems）
    isLoading,
    isDataLoaded,

    // 统计
    totalCount,

    // 时间段统计
    timePeriodStats: sharedTimePeriodStats,

    // 详情缓存
    detailCache,

    // 方法
    loadHistory,
    loadAllHistory,
    loadPageByNumber,
    searchHistory,
    invalidateCache,
    deleteHistoryItem,
    clearHistory,
    exportToJson,
    bulkCopyLinks,
    bulkExportJSON,
    bulkDeleteRecords,

    // 时间轴相关
    loadTimePeriodStats,
    jumpToMonth,
  };
}

// 导出类型
export type { TimePeriodStats };
