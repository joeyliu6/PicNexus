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
import { historyDB } from '../services/HistoryDatabase';
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

// 所有历史记录项（shallowRef 优化）
const sharedAllHistoryItems: Ref<HistoryItem[]> = shallowRef([]);

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

// 分页状态
const PAGE_SIZE = 500;
const currentPage = ref(1);
const totalCount = ref(0);
const hasMore = ref(true);
const isLoadingMore = ref(false);

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
          sharedAllHistoryItems.value = sharedAllHistoryItems.value.filter(
            item => !deletedSet.has(item.id)
          );
          totalCount.value = Math.max(0, totalCount.value - data.ids.length);
          dataVersion.value++;
        }
        break;

      case 'history-cleared':
        console.log('[历史记录] 跨窗口同步: 清空');
        sharedAllHistoryItems.value = [];
        totalCount.value = 0;
        hasMore.value = false;
        dataVersion.value++;
        break;

      case 'history-updated':
        console.log('[历史记录] 跨窗口同步: 更新，标记缓存失效');
        isDataLoaded.value = false;
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

  // 初始化跨窗口事件监听（单例）
  initCrossWindowListener();

  // 使用共享状态（单例）
  const allHistoryItems = sharedAllHistoryItems;
  const isLoading = sharedIsLoading;

  /**
   * 初始化数据库
   */
  async function initDatabase(): Promise<void> {
    await historyDB.open();
  }

  /**
   * 加载历史记录（从 SQLite 分页加载）
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

      currentPage.value = 1;

      const { items, total, hasMore: more } = await historyDB.getPage({
        page: 1,
        pageSize: PAGE_SIZE,
      });

      allHistoryItems.value = items;
      totalCount.value = total;
      hasMore.value = more;

      console.log(`[历史记录] 加载完成: 显示 ${items.length}/${total} 条`);

      isDataLoaded.value = true;
      lastLoadTime.value = Date.now();
      dataVersion.value++;

    } catch (error) {
      console.error('[历史记录] 加载失败:', error);
      toast.error('加载失败', String(error));
      allHistoryItems.value = [];
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 加载更多数据（无限滚动）
   */
  async function loadMore(): Promise<void> {
    if (!hasMore.value || isLoadingMore.value) {
      return;
    }

    try {
      isLoadingMore.value = true;
      currentPage.value++;

      const { items, hasMore: more } = await historyDB.getPage({
        page: currentPage.value,
        pageSize: PAGE_SIZE,
      });

      if (items.length > 0) {
        allHistoryItems.value = [...allHistoryItems.value, ...items];
        console.log(`[历史记录] 加载更多: ${allHistoryItems.value.length}/${totalCount.value} 条`);
      }

      hasMore.value = more;
    } finally {
      isLoadingMore.value = false;
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

      allHistoryItems.value = allHistoryItems.value.filter(item => item.id !== itemId);
      totalCount.value = Math.max(0, totalCount.value - 1);
      dataVersion.value++;

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

      allHistoryItems.value = [];
      totalCount.value = 0;
      hasMore.value = false;
      dataVersion.value++;

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

      const selectedItems = allHistoryItems.value.filter(item => selectedIds.includes(item.id));
      const { config } = useConfigManager();
      const currentConfig = config.value;
      const activePrefix = getActivePrefix(currentConfig);

      const links = selectedItems.map(item => {
        if (!item.generatedLink) return null;
        if (item.primaryService === 'weibo' && activePrefix) {
          return `${activePrefix}${item.generatedLink}`;
        }
        return item.generatedLink;
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

      const selectedItems = allHistoryItems.value.filter(item => selectedIds.includes(item.id));
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
      allHistoryItems.value = allHistoryItems.value.filter(item => !selectedIdSet.has(item.id));
      totalCount.value = Math.max(0, totalCount.value - selectedIds.length);
      dataVersion.value++;

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

  return {
    // 状态
    allHistoryItems,
    isLoading,
    isDataLoaded,

    // 分页状态
    totalCount,
    hasMore,
    isLoadingMore,

    // 方法
    loadHistory,
    loadAllHistory,
    loadMore,
    invalidateCache,
    deleteHistoryItem,
    clearHistory,
    exportToJson,
    bulkCopyLinks,
    bulkExportJSON,
    bulkDeleteRecords,
  };
}
