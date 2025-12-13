// src/composables/useHistory.ts
// 历史记录管理 Composable（单例模式）

import { ref, computed, shallowRef, triggerRef, type Ref } from 'vue';
import { save as saveDialog } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { writeText } from '@tauri-apps/api/clipboard';
import type { HistoryItem, ServiceType, UserConfig } from '../config/types';
import { getActivePrefix } from '../config/types';
import { Store } from '../store';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import { useConfigManager } from './useConfig';

const historyStore = new Store('.history.dat');

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

/**
 * 使缓存失效，下次 loadHistory 将强制重新加载
 * 导出为模块级别函数，可在任何地方调用（包括异步函数）
 */
export function invalidateCache(): void {
  isDataLoaded.value = false;
  console.log('[历史记录] 缓存已失效');
}

/**
 * 历史记录迁移函数（将旧格式转换为新格式）
 */
function migrateHistoryItem(item: any): HistoryItem {
  // 如果是新格式且有必要字段，直接返回
  if (item.id && item.localFileName && item.generatedLink &&
      item.primaryService && item.results) {
    return item as HistoryItem;
  }

  // 迁移旧格式
  const migratedItem: HistoryItem = {
    id: item.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
    timestamp: item.timestamp || Date.now(),
    localFileName: item.localFileName || item.fileName || 'unknown',
    filePath: item.filePath || '',
    generatedLink: item.generatedLink || item.weiboLink || '',
    primaryService: item.primaryService || 'weibo',
    results: []
  };

  // 迁移结果数组
  if (item.results) {
    migratedItem.results = item.results;
  } else {
    // 从旧字段构建结果
    if (item.weiboPid || item.weiboLink) {
      migratedItem.results.push({
        serviceId: 'weibo',
        status: item.weiboLink ? 'success' : 'failed',
        result: item.weiboPid ? {
          serviceId: 'weibo',
          fileKey: item.weiboPid,
          url: item.weiboLink || ''
        } : undefined,
        error: item.weiboError
      });
    }
    if (item.r2Link || item.r2Error) {
      migratedItem.results.push({
        serviceId: 'r2',
        status: item.r2Link ? 'success' : 'failed',
        result: item.r2Link ? {
          serviceId: 'r2',
          fileKey: item.r2Link,
          url: item.r2Link
        } : undefined,
        error: item.r2Error
      });
    }
  }

  return migratedItem;
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
  const filteredItems = computed(() => {
    let items = historyStateInternal.value.displayedItems;

    // 应用搜索过滤
    if (searchTerm.value.trim()) {
      const term = searchTerm.value.toLowerCase().trim();
      items = items.filter(item =>
        item.localFileName.toLowerCase().includes(term)
      );
    }

    return items;
  });

  /**
   * 加载历史记录
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

      let items = await historyStore.get<any[]>('uploads');
      if (!items || items.length === 0) {
        allHistoryItems.value = [];
        historyStateInternal.value.displayedItems = [];
        isDataLoaded.value = true;
        return;
      }

      // 迁移数据（只检查是否需要迁移，不每次都保存）
      const migratedItems = items.map(migrateHistoryItem);
      const needsSave = items.some(item =>
        !item.id ||
        !item.localFileName ||
        !item.generatedLink ||
        !item.results ||
        !item.primaryService
      );

      // 只在真正需要迁移时才保存
      if (needsSave) {
        console.log('[历史记录] 检测到旧格式数据，执行迁移');
        await historyStore.set('uploads', migratedItems);
        await historyStore.save();
      }

      // 按时间倒序排列
      allHistoryItems.value = migratedItems.sort((a, b) => b.timestamp - a.timestamp);

      // 应用当前筛选
      applyFilter();

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
   * 应用筛选（根据图床和搜索词）
   */
  function applyFilter(): void {
    let items = allHistoryItems.value;

    // 应用图床筛选
    if (historyStateInternal.value.currentFilter !== 'all') {
      items = items.filter(item =>
        item.results?.some(r =>
          r.serviceId === historyStateInternal.value.currentFilter && r.status === 'success'
        )
      );
    }

    historyStateInternal.value.displayedItems = items;
  }

  /**
   * 设置图床筛选
   */
  function setFilter(filter: ServiceType | 'all'): void {
    historyStateInternal.value.currentFilter = filter;
    applyFilter();
  }

  /**
   * 设置搜索词
   */
  function setSearchTerm(term: string): void {
    searchTerm.value = term;
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

      const items = await historyStore.get<HistoryItem[]>('uploads') || [];
      const filteredItems = items.filter(item => item.id !== itemId);

      if (filteredItems.length === items.length) {
        console.warn('[历史记录] 未找到要删除的项目:', itemId);
        toast.warn('未找到项目', '未找到要删除的项目');
        return;
      }

      await historyStore.set('uploads', filteredItems);
      await historyStore.save();

      console.log('[历史记录] ✓ 删除成功:', itemId);
      toast.success('删除成功', '历史记录已删除');

      // 【性能优化】直接更新内存数据，避免全量重加载
      allHistoryItems.value = allHistoryItems.value.filter(item => item.id !== itemId);
      applyFilter();

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

      await historyStore.clear();
      await historyStore.save();

      toast.success('清空成功', '所有历史记录已清空');

      // 【性能优化】直接清空内存数据，避免重新加载
      allHistoryItems.value = [];
      historyStateInternal.value.displayedItems = [];
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
      const items = await historyStore.get<HistoryItem[]>('uploads') || [];
      if (items.length === 0) {
        toast.warn('无数据', '没有可导出的历史记录');
        return;
      }

      const jsonContent = JSON.stringify(items, null, 2);
      const filePath = await saveDialog({
        defaultPath: 'weibo_dr_export.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });

      if (!filePath) {
        console.log('[历史记录] 用户取消导出');
        return;
      }

      await writeTextFile(filePath, jsonContent);
      toast.success('导出成功', `已导出 ${items.length} 条记录`);

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

      const items = await historyStore.get<HistoryItem[]>('uploads', []) || [];
      const selectedItems = items.filter(item => selectedIds.includes(item.id));

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

      const items = await historyStore.get<HistoryItem[]>('uploads', []) || [];
      const selectedItems = items.filter(item => selectedIds.includes(item.id));

      // 生成 JSON 内容
      const jsonContent = JSON.stringify(selectedItems, null, 2);

      // 保存文件
      const filePath = await saveDialog({
        defaultPath: `weibo-history-${Date.now()}.json`,
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

      const items = await historyStore.get<HistoryItem[]>('uploads', []) || [];
      const remainingItems = items.filter(item => !selectedIds.includes(item.id));

      await historyStore.set('uploads', remainingItems);
      await historyStore.save();

      toast.success('删除成功', `已删除 ${selectedIds.length} 条记录`);
      console.log(`[批量操作] 已删除 ${selectedIds.length} 条记录`);

      // 【性能优化】直接更新内存数据，避免全量重加载
      const selectedIdSet = new Set(selectedIds);
      allHistoryItems.value = allHistoryItems.value.filter(item => !selectedIdSet.has(item.id));
      applyFilter();

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

    // 方法
    loadHistory,
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
