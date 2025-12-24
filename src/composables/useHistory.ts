// src/composables/useHistory.ts
// 历史记录管理 Composable（单例模式）
// 使用 SQLite 数据库存储，支持大数据量分页和搜索

import { ref, computed, shallowRef, triggerRef, type Ref } from 'vue';
import { save as saveDialog } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { writeText } from '@tauri-apps/api/clipboard';
import type { HistoryItem, ServiceType, UserConfig } from '../config/types';
import { getActivePrefix } from '../config/types';
import { Store } from '../store';
import { historyDB } from '../services/HistoryDatabase';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import { useConfigManager } from './useConfig';

/**
 * 视图模式类型
 */
export type ViewMode = 'table' | 'grid';

/**
 * 历史记录状态接口（不含 selectedItems，因为它变化频繁需要独立管理）
 */
export interface HistoryState {
  viewMode: ViewMode;
  currentFilter: ServiceType | 'all';
  displayedItems: HistoryItem[];
  gridLoadedCount: number;
  gridBatchSize: number;
}

/**
 * 完整的历史记录状态接口（包含 selectedItems，用于外部接口兼容）
 */
export interface HistoryStateWithSelection extends HistoryState {
  selectedItems: Set<string>;
}

// ============================================
// 单例共享状态（模块级别）
// ============================================

// 【性能优化】使用 shallowRef 替代 ref
// 历史记录项只需监听数组本身的替换，不需要深层追踪每个对象属性
const sharedAllHistoryItems: Ref<HistoryItem[]> = shallowRef([]);

// 【性能优化】将 selectedItems 独立为 shallowRef
// Set 变化频繁，独立管理避免触发整个 state 的响应式更新
const sharedSelectedIds = shallowRef(new Set<string>());

// 历史记录状态（共享）- 移除 selectedItems
const sharedHistoryState: Ref<HistoryState> = ref({
  viewMode: 'table',
  currentFilter: 'all',
  displayedItems: [],
  gridLoadedCount: 0,
  gridBatchSize: 50,
});

// 加载中状态（共享）
const sharedIsLoading = ref(false);

// 搜索词（共享）
const sharedSearchTerm = ref('');

// 数据是否已加载（用于缓存判断）
const isDataLoaded = ref(false);

// 数据版本号（用于追踪变化）
const dataVersion = ref(0);

// === 分页加载相关 ===
const PAGE_SIZE = 500;  // 每页加载数量
const currentPage = ref(1);  // 当前页码
const totalCount = ref(0);  // 总记录数
const hasMore = ref(true);  // 是否还有更多数据
const isLoadingMore = ref(false);  // 是否正在加载更多

// 是否处于搜索模式
const isSearchMode = ref(false);

/**
 * 使缓存失效，下次 loadHistory 将强制重新加载
 * 导出为模块级别函数，可在任何地方调用（包括异步函数）
 */
export function invalidateCache(): void {
  isDataLoaded.value = false;
  console.log('[历史记录] 缓存已失效');
}

/**
 * 历史记录管理 Composable（单例模式）
 * 所有组件共享同一份数据，避免重复加载
 */
export function useHistoryManager() {
  const toast = useToast();
  const { confirm } = useConfirm();

  // 使用共享状态（单例）
  const allHistoryItems = sharedAllHistoryItems;
  const historyStateInternal = sharedHistoryState;
  const selectedIdsSet = sharedSelectedIds;
  const isLoading = sharedIsLoading;
  const searchTerm = sharedSearchTerm;

  // 【性能优化】暴露给外部保持接口兼容
  // 将 selectedItems 合并到 historyState 中
  const historyState = computed(() => ({
    ...historyStateInternal.value,
    selectedItems: selectedIdsSet.value
  }));

  // 计算属性：筛选后的项目
  // 注意：由于使用 SQLite，搜索和筛选已在 loadHistory/searchHistory 中完成
  // 这里只是返回 displayedItems
  const filteredItems = computed(() => {
    return historyStateInternal.value.displayedItems;
  });

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
    // 如果数据已加载且不强制刷新，直接返回
    if (isDataLoaded.value && !forceReload) {
      console.log('[历史记录] 数据已缓存，跳过加载');
      return;
    }

    try {
      isLoading.value = true;
      isSearchMode.value = false;
      searchTerm.value = '';

      // 确保数据库已初始化
      await initDatabase();

      // 重置分页状态
      currentPage.value = 1;

      // 从 SQLite 获取第一页数据
      const { items, total, hasMore: more } = await historyDB.getPage({
        page: 1,
        pageSize: PAGE_SIZE,
        serviceFilter: historyStateInternal.value.currentFilter
      });

      allHistoryItems.value = items;
      historyStateInternal.value.displayedItems = items;
      totalCount.value = total;
      hasMore.value = more;

      console.log(`[历史记录] 加载完成: 显示 ${items.length}/${total} 条`);

      // 标记数据已加载
      isDataLoaded.value = true;
      dataVersion.value++;

    } catch (error) {
      console.error('[历史记录] 加载失败:', error);
      toast.error('加载失败', String(error));
      allHistoryItems.value = [];
      historyStateInternal.value.displayedItems = [];
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 加载更多数据（无限滚动）
   */
  async function loadMore(): Promise<void> {
    // 搜索模式下不分页
    if (isSearchMode.value) {
      return;
    }

    if (!hasMore.value || isLoadingMore.value) {
      return;
    }

    try {
      isLoadingMore.value = true;
      currentPage.value++;

      const { items, hasMore: more } = await historyDB.getPage({
        page: currentPage.value,
        pageSize: PAGE_SIZE,
        serviceFilter: historyStateInternal.value.currentFilter
      });

      if (items.length > 0) {
        // 追加到现有数据
        allHistoryItems.value = [...allHistoryItems.value, ...items];
        historyStateInternal.value.displayedItems = allHistoryItems.value;
        console.log(`[历史记录] 加载更多: ${allHistoryItems.value.length}/${totalCount.value} 条`);
      }

      hasMore.value = more;
    } finally {
      isLoadingMore.value = false;
    }
  }

  /**
   * 搜索历史记录（使用 SQLite LIKE 查询）
   */
  async function searchHistory(keyword: string): Promise<void> {
    if (!keyword.trim()) {
      // 清空搜索时，重新加载分页数据
      isSearchMode.value = false;
      await loadHistory(true);
      return;
    }

    try {
      isLoading.value = true;
      isSearchMode.value = true;
      searchTerm.value = keyword;

      // 从 SQLite 搜索
      const { items, total } = await historyDB.search(keyword, {
        serviceFilter: historyStateInternal.value.currentFilter,
        limit: 200  // 搜索结果限制为 200 条，减少内存占用
      });

      allHistoryItems.value = items;
      historyStateInternal.value.displayedItems = items;
      totalCount.value = total;
      hasMore.value = false;  // 搜索结果不分页

      console.log(`[历史记录] 搜索 "${keyword}": 找到 ${total} 条`);

    } catch (error) {
      console.error('[历史记录] 搜索失败:', error);
      toast.error('搜索失败', String(error));
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 设置图床筛选
   */
  async function setFilter(filter: ServiceType | 'all'): Promise<void> {
    historyStateInternal.value.currentFilter = filter;
    // 重新加载数据（应用新的筛选条件）
    await loadHistory(true);
  }

  /**
   * 设置搜索词（触发搜索）
   */
  async function setSearchTerm(term: string): Promise<void> {
    await searchHistory(term);
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

      // 从 SQLite 删除
      await historyDB.delete(itemId);

      console.log('[历史记录] ✓ 删除成功:', itemId);
      toast.success('删除成功', '历史记录已删除');

      // 【性能优化】直接更新内存数据，避免全量重加载
      allHistoryItems.value = allHistoryItems.value.filter(item => item.id !== itemId);
      historyStateInternal.value.displayedItems = allHistoryItems.value;
      totalCount.value = Math.max(0, totalCount.value - 1);

      // 从选中集合中移除
      selectedIdsSet.value.delete(itemId);
      triggerRef(selectedIdsSet);

      dataVersion.value++;

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

      // 清空 SQLite 数据库
      await historyDB.clear();

      toast.success('清空成功', '所有历史记录已清空');

      // 【性能优化】直接清空内存数据，避免重新加载
      allHistoryItems.value = [];
      historyStateInternal.value.displayedItems = [];
      totalCount.value = 0;
      hasMore.value = false;
      selectedIdsSet.value.clear();
      triggerRef(selectedIdsSet);

      dataVersion.value++;

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
   * 批量操作：批量复制链接
   */
  async function bulkCopyLinks(selectedIds: string[]): Promise<void> {
    try {
      if (selectedIds.length === 0) {
        toast.warn('未选择项目', '请先选择要复制的项目');
        return;
      }

      // 从内存中的已加载数据获取
      const selectedItems = allHistoryItems.value.filter(item => selectedIds.includes(item.id));

      // 获取当前配置
      const { config } = useConfigManager();
      const currentConfig = config.value;
      const activePrefix = getActivePrefix(currentConfig);

      // 为每个链接应用前缀
      const links = selectedItems.map(item => {
        if (!item.generatedLink) return null;

        // 微博图床且启用了前缀，应用前缀
        if (item.primaryService === 'weibo' && activePrefix) {
          return `${activePrefix}${item.generatedLink}`;
        }

        return item.generatedLink;
      }).filter((link): link is string => !!link);

      if (links.length === 0) {
        toast.warn('无可用链接', '选中的项目没有可用链接');
        return;
      }

      // 复制到剪贴板（每行一个链接）
      await writeText(links.join('\n'));

      toast.success('已复制', `已复制 ${links.length} 个链接到剪贴板`, 1500);
      console.log(`[批量操作] 已复制 ${links.length} 个链接`);

    } catch (error: any) {
      console.error('[批量操作] 复制失败:', error);
      toast.error('复制失败', error.message || String(error));
    }
  }

  /**
   * 批量操作：批量导出为 JSON
   */
  async function bulkExportJSON(selectedIds: string[]): Promise<void> {
    try {
      if (selectedIds.length === 0) {
        toast.warn('未选择项目', '请先选择要导出的项目');
        return;
      }

      // 从内存中的已加载数据获取
      const selectedItems = allHistoryItems.value.filter(item => selectedIds.includes(item.id));

      // 生成 JSON 内容
      const jsonContent = JSON.stringify(selectedItems, null, 2);

      // 保存文件
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
   * 批量操作：批量删除记录
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

      // 从 SQLite 批量删除
      await historyDB.deleteMany(selectedIds);

      toast.success('删除成功', `已删除 ${selectedIds.length} 条记录`);
      console.log(`[批量操作] 已删除 ${selectedIds.length} 条记录`);

      // 【性能优化】直接更新内存数据，避免全量重加载
      const selectedIdSet = new Set(selectedIds);
      allHistoryItems.value = allHistoryItems.value.filter(item => !selectedIdSet.has(item.id));
      historyStateInternal.value.displayedItems = allHistoryItems.value;
      totalCount.value = Math.max(0, totalCount.value - selectedIds.length);

      // 清空选中
      selectedIdsSet.value.clear();
      triggerRef(selectedIdsSet);

      dataVersion.value++;

    } catch (error: any) {
      console.error('[批量操作] 删除失败:', error);
      toast.error('删除失败', error.message || String(error));
    }
  }

  /**
   * 切换视图模式
   * 【性能优化】立即切换视图，配置保存在后台异步执行，不阻塞 UI
   */
  function switchViewMode(mode: ViewMode): void {
    // 立即切换视图（不等待保存）
    historyStateInternal.value.viewMode = mode;

    // 后台异步保存配置（不阻塞 UI）
    queueMicrotask(async () => {
      try {
        const configStore = new Store('.settings.dat');
        const config = await configStore.get<UserConfig>('config');
        if (config) {
          if (!config.galleryViewPreferences) {
            config.galleryViewPreferences = {
              viewMode: mode,
              gridColumnWidth: 220,
            };
          } else {
            config.galleryViewPreferences.viewMode = mode;
          }
          await configStore.set('config', config);
          await configStore.save();
        }
      } catch (error) {
        console.error('[历史记录] 保存视图偏好失败:', error);
      }
    });
  }

  /**
   * 【性能优化】切换选中状态
   * 使用 shallowRef + triggerRef 避免深层响应式追踪
   */
  function toggleSelection(itemId: string): void {
    const set = selectedIdsSet.value;
    if (set.has(itemId)) {
      set.delete(itemId);
    } else {
      set.add(itemId);
    }
    // shallowRef 修改内部需要手动触发更新
    triggerRef(selectedIdsSet);
  }

  /**
   * 【性能优化】全选/取消全选
   * 批量操作后只触发一次更新，而非 N 次
   */
  function toggleSelectAll(checked: boolean): void {
    const set = selectedIdsSet.value;
    set.clear();

    if (checked) {
      filteredItems.value.forEach(item => set.add(item.id));
    }
    // 批量操作完成后，只触发一次更新
    triggerRef(selectedIdsSet);
  }

  /**
   * 清空选中
   */
  function clearSelection(): void {
    selectedIdsSet.value.clear();
    triggerRef(selectedIdsSet);
  }

  /**
   * 获取选中的项目 ID 列表
   */
  const selectedIds = computed(() => {
    return Array.from(selectedIdsSet.value);
  });

  /**
   * 是否有选中项目
   */
  const hasSelection = computed(() => {
    return selectedIdsSet.value.size > 0;
  });

  return {
    // 状态
    allHistoryItems,
    historyState,
    selectedIdsRef: selectedIdsSet,  // 【性能优化】暴露原始 shallowRef 供高性能组件使用
    isLoading,
    searchTerm,
    filteredItems,
    selectedIds,
    hasSelection,
    isDataLoaded,  // 导出数据加载状态

    // 分页加载状态
    totalCount,
    hasMore,
    isLoadingMore,

    // 方法
    loadHistory,
    loadMore,  // 加载更多（无限滚动）
    searchHistory,  // 搜索（SQLite LIKE）
    invalidateCache,  // 导出缓存失效方法
    setFilter,
    setSearchTerm,
    deleteHistoryItem,
    clearHistory,
    exportToJson,
    bulkCopyLinks,
    bulkExportJSON,
    bulkDeleteRecords,
    switchViewMode,
    toggleSelection,
    toggleSelectAll,
    clearSelection,
  };
}
