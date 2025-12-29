/**
 * 历史记录视图状态 composable
 * 工厂函数，每次调用返回独立的视图状态实例
 * 用于表格视图和瀑布流视图各自独立管理状态
 */
import { ref, shallowRef, computed, triggerRef, watch } from 'vue';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { HistoryItem, ServiceType } from '../config/types';
import { getActivePrefix } from '../config/types';
import { useHistoryManager } from './useHistory';
import { useConfigManager } from './useConfig';
import { useToast } from './useToast';

// 链接格式类型
export type LinkFormat = 'url' | 'markdown' | 'html' | 'bbcode';

/**
 * 创建独立的视图状态
 * 每次调用返回新的状态实例，用于独立视图
 */
export function useHistoryViewState() {
  const historyManager = useHistoryManager();
  const configManager = useConfigManager();
  const toast = useToast();

  // === 独立状态（每个视图实例独立）===
  const selectedIds = shallowRef(new Set<string>());
  const currentFilter = ref<ServiceType | 'all'>('all');
  const searchTerm = ref('');

  // === 计算属性 ===

  // 筛选后的项目（根据 currentFilter 和 searchTerm 过滤）
  const filteredItems = computed(() => {
    let items = historyManager.allHistoryItems.value;

    // 图床筛选
    if (currentFilter.value !== 'all') {
      items = items.filter(item =>
        item.results.some(r => r.serviceId === currentFilter.value && r.status === 'success')
      );
    }

    // 搜索筛选
    if (searchTerm.value.trim()) {
      const term = searchTerm.value.toLowerCase().trim();
      items = items.filter(item =>
        item.localFileName.toLowerCase().includes(term)
      );
    }

    return items;
  });

  // 是否全选
  const isAllSelected = computed(() => {
    const items = filteredItems.value;
    if (items.length === 0) return false;
    return items.every(item => selectedIds.value.has(item.id));
  });

  // 是否部分选中
  const isSomeSelected = computed(() => {
    const items = filteredItems.value;
    if (items.length === 0) return false;
    const count = items.filter(item => selectedIds.value.has(item.id)).length;
    return count > 0 && count < items.length;
  });

  // 是否有选中项
  const hasSelection = computed(() => selectedIds.value.size > 0);

  // 选中的 ID 数组
  const selectedIdList = computed(() => Array.from(selectedIds.value));

  // === 选中操作 ===

  /**
   * 切换单项选中状态
   */
  function toggleSelection(id: string): void {
    const newSet = new Set(selectedIds.value);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    selectedIds.value = newSet;
    triggerRef(selectedIds);
  }

  /**
   * 全选/取消全选
   */
  function toggleSelectAll(checked: boolean): void {
    if (checked) {
      const newSet = new Set<string>();
      filteredItems.value.forEach(item => newSet.add(item.id));
      selectedIds.value = newSet;
    } else {
      selectedIds.value = new Set();
    }
    triggerRef(selectedIds);
  }

  /**
   * 清空选中
   */
  function clearSelection(): void {
    selectedIds.value = new Set();
    triggerRef(selectedIds);
  }

  /**
   * 检查项目是否选中
   */
  function isSelected(id: string): boolean {
    return selectedIds.value.has(id);
  }

  // === 筛选和搜索 ===

  /**
   * 设置图床筛选
   */
  function setFilter(filter: ServiceType | 'all'): void {
    currentFilter.value = filter;
    // 筛选变化时清空选中
    clearSelection();
  }

  /**
   * 设置搜索词
   */
  function setSearchTerm(term: string): void {
    searchTerm.value = term;
    // 搜索变化时清空选中
    clearSelection();
  }

  // === 批量操作 ===

  /**
   * 格式化链接
   */
  function formatLink(url: string, fileName: string, format: LinkFormat): string {
    switch (format) {
      case 'url': return url;
      case 'markdown': return `![${fileName}](${url})`;
      case 'html': return `<img src="${url}" alt="${fileName}" />`;
      case 'bbcode': return `[img]${url}[/img]`;
      default: return url;
    }
  }

  /**
   * 批量复制链接（支持多种格式）
   */
  async function bulkCopyFormatted(format: LinkFormat): Promise<void> {
    const ids = selectedIdList.value;
    if (ids.length === 0) {
      toast.warn('未选择项目', '请先选择要复制的项目');
      return;
    }

    try {
      const items = historyManager.allHistoryItems.value.filter(item => ids.includes(item.id));
      const activePrefix = getActivePrefix(configManager.config.value);

      const formattedLinks = items.map(item => {
        if (!item.generatedLink) return null;
        let finalLink = item.generatedLink;
        if (item.primaryService === 'weibo' && activePrefix) {
          finalLink = `${activePrefix}${item.generatedLink}`;
        }
        return formatLink(finalLink, item.localFileName, format);
      }).filter((link): link is string => !!link);

      if (formattedLinks.length === 0) {
        toast.warn('无可用链接', '选中的项目没有可用链接');
        return;
      }

      await writeText(formattedLinks.join('\n'));

      const formatNames: Record<LinkFormat, string> = {
        url: 'URL',
        markdown: 'Markdown',
        html: 'HTML',
        bbcode: 'BBCode'
      };
      toast.success('复制成功', `已复制 ${formattedLinks.length} 个 ${formatNames[format]} 链接`, 1500);
    } catch (error) {
      console.error('[批量复制] 失败:', error);
      toast.error('复制失败', String(error));
    }
  }

  /**
   * 批量导出
   */
  async function bulkExport(): Promise<void> {
    await historyManager.bulkExportJSON(selectedIdList.value);
  }

  /**
   * 批量删除
   */
  async function bulkDelete(): Promise<void> {
    const ids = selectedIdList.value;
    if (ids.length === 0) {
      toast.warn('未选择项目', '请先选择要删除的项目');
      return;
    }

    await historyManager.bulkDeleteRecords(ids);
    clearSelection();
  }

  // === 重置 ===

  /**
   * 重置所有状态
   */
  function reset(): void {
    selectedIds.value = new Set();
    currentFilter.value = 'all';
    searchTerm.value = '';
  }

  return {
    // 状态
    selectedIds,
    currentFilter,
    searchTerm,
    filteredItems,

    // 计算属性
    isAllSelected,
    isSomeSelected,
    hasSelection,
    selectedIdList,

    // 选中操作
    toggleSelection,
    toggleSelectAll,
    clearSelection,
    isSelected,

    // 筛选和搜索
    setFilter,
    setSearchTerm,

    // 批量操作
    bulkCopyFormatted,
    bulkExport,
    bulkDelete,

    // 重置
    reset,

    // 代理 historyManager 的方法
    loadHistory: historyManager.loadHistory,
    loadMore: historyManager.loadMore,
    deleteHistoryItem: historyManager.deleteHistoryItem,

    // 代理 historyManager 的状态
    allHistoryItems: historyManager.allHistoryItems,
    isLoading: historyManager.isLoading,
    isLoadingMore: historyManager.isLoadingMore,
    totalCount: historyManager.totalCount,
    hasMore: historyManager.hasMore,
  };
}
