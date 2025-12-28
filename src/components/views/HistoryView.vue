<script setup lang="ts">
import { ref, computed, onMounted, onActivated, onDeactivated, watch, nextTick } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Button from 'primevue/button';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import Checkbox from 'primevue/checkbox';
import Select from 'primevue/select';
import Dialog from 'primevue/dialog';
import Tag from 'primevue/tag';
import Skeleton from 'primevue/skeleton';
import { VirtualWaterfall } from '@lhlyu/vue-virtual-waterfall';
import type { HistoryItem, ServiceType } from '../../config/types';
import { getActivePrefix } from '../../config/types';
import { useHistoryManager, type ViewMode } from '../../composables/useHistory';
import { useToast } from '../../composables/useToast';
import { useConfigManager } from '../../composables/useConfig';
import { debounce } from '../../utils/debounce';
import { getThumbnailUrl } from '../../services/ThumbnailService';
import 'primeicons/primeicons.css';

// 【性能优化】DateTimeFormat 提取到组件外，全局复用
// 避免每次渲染时创建新实例，减少 GC 压力
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

const toast = useToast();
const historyManager = useHistoryManager();
const configManager = useConfigManager();

// 本地搜索词（用于防抖）
const localSearchTerm = ref('');

// 防抖更新搜索词（调用 SQLite 搜索）
const debouncedSearch = debounce((term: string) => {
  historyManager.setSearchTerm(term);
}, 300);

// 缩略图 URL 缓存（同步：微博图床）
// 【内存优化】缓存上限从 1000 减少到 500，减少内存占用
const THUMB_CACHE_MAX_SIZE = 500;
const thumbUrlCache = new Map<string, string | undefined>();

// 设置缩略图缓存（带 LRU 淘汰）
const setThumbCache = (id: string, url: string | undefined) => {
  // 如果超过上限，删除最早的条目（Map 保持插入顺序）
  if (thumbUrlCache.size >= THUMB_CACHE_MAX_SIZE && !thumbUrlCache.has(id)) {
    const firstKey = thumbUrlCache.keys().next().value;
    if (firstKey) thumbUrlCache.delete(firstKey);
  }
  thumbUrlCache.set(id, url);
};

// 清空缩略图缓存
const clearThumbCache = () => {
  thumbUrlCache.clear();
};

// 【性能优化】优化缓存清空策略
// 数据变化时增量清理（只删除已移除项的缓存）
watch(() => historyManager.allHistoryItems.value, (newItems) => {
  const newIds = new Set(newItems.map(i => i.id));
  for (const id of thumbUrlCache.keys()) {
    if (!newIds.has(id)) {
      thumbUrlCache.delete(id);
    }
  }
}, { deep: false });

// 只监听影响 URL 的前缀配置项，避免 deep: true 的开销
watch(
  () => configManager.config.value?.linkPrefixConfig?.enabled,
  clearThumbCache
);

watch(
  () => configManager.config.value?.linkPrefixConfig?.selectedIndex,
  clearThumbCache
);


// 视图选项
const viewOptions = ref([
  { label: '表格', value: 'table' as ViewMode, icon: 'pi pi-table' },
  { label: '瀑布流', value: 'grid' as ViewMode, icon: 'pi pi-th-large' }
]);

// Lightbox 状态
const lightboxVisible = ref(false);
const lightboxImage = ref('');
const lightboxTitle = ref('');
const lightboxItem = ref<HistoryItem | null>(null);

// 悬浮预览状态（用于表格视图缩略图悬浮预览）
const hoverPreview = ref({
  visible: false,
  url: '',
  alt: '',
  style: {} as Record<string, string>
});

// 图床筛选选项
const serviceOptions = [
  { label: '全部图床', value: 'all' },
  { label: '微博', value: 'weibo' },
  { label: 'R2', value: 'r2' },
  { label: 'TCL', value: 'tcl' },
  { label: '京东', value: 'jd' },
  { label: '牛客', value: 'nowcoder' },
  { label: '七鱼', value: 'qiyu' },
  { label: '知乎', value: 'zhihu' },
  { label: '纳米', value: 'nami' }
];

const selectAll = ref(false);

// 标志位：防止首次加载时重复刷新
const isFirstMount = ref(true);

// 【性能优化】计算属性：是否全选 - 直接使用 selectedIdsRef
const isAllSelected = computed(() => {
  const currentItems = historyManager.filteredItems.value;
  if (currentItems.length === 0) return false;
  const selectedSet = historyManager.selectedIdsRef.value;
  return currentItems.every(item => selectedSet.has(item.id));
});

// 【性能优化】计算属性：是否部分选中 - 直接使用 selectedIdsRef
const isSomeSelected = computed(() => {
  const currentItems = historyManager.filteredItems.value;
  if (currentItems.length === 0) return false;
  const selectedSet = historyManager.selectedIdsRef.value;
  const selectedCount = currentItems.filter(item => selectedSet.has(item.id)).length;
  return selectedCount > 0 && selectedCount < currentItems.length;
});

// 处理表头复选框变化
const handleHeaderCheckboxChange = (checked: boolean) => {
  selectAll.value = checked;
  handleSelectAll();
};

// 【性能优化】移除冗余 watch
// stopWatchViewMode 和 stopWatchFilter 已删除
// 视图模式通过按钮点击直接调用 switchViewMode
// 筛选器通过 Select 的 @update:model-value 直接调用 setFilter

// 监听本地搜索词变化（防抖）- 用于搜索功能
// SQLite 搜索已在 setSearchTerm 中处理，无需预加载全部数据
watch(localSearchTerm, (newTerm) => {
  debouncedSearch(newTerm);
});

// 监听选中状态变化，同步工具栏全选复选框
watch([isAllSelected, isSomeSelected], () => {
  if (isAllSelected.value) {
    selectAll.value = true;
  } else if (!isSomeSelected.value) {
    selectAll.value = false;
  }
});


// 全选/取消全选
const handleSelectAll = () => {
  historyManager.toggleSelectAll(selectAll.value);
};

// 批量复制（原有方法，保留兼容）
const handleBulkCopy = async () => {
  await historyManager.bulkCopyLinks(historyManager.selectedIds.value);
};

// === 浮动操作栏 - 复制下拉菜单 ===
const copyMenuVisible = ref(false);
const copyDropdownRef = ref<HTMLElement | null>(null);

// 链接格式类型
type LinkFormat = 'url' | 'markdown' | 'html' | 'bbcode';

// 切换复制菜单
const toggleCopyMenu = () => {
  copyMenuVisible.value = !copyMenuVisible.value;
};

// 使用 VueUse 的 onClickOutside 检测点击外部关闭菜单
onClickOutside(copyDropdownRef, () => {
  copyMenuVisible.value = false;
});

// 格式化链接
const formatLink = (url: string, fileName: string, format: LinkFormat): string => {
  switch (format) {
    case 'url': return url;
    case 'markdown': return `![${fileName}](${url})`;
    case 'html': return `<img src="${url}" alt="${fileName}" />`;
    case 'bbcode': return `[img]${url}[/img]`;
    default: return url;
  }
};

// 批量复制（支持多种格式）
const handleBulkCopyFormatted = async (format: LinkFormat) => {
  copyMenuVisible.value = false;

  const selectedIdList = historyManager.selectedIds.value;
  if (selectedIdList.length === 0) {
    toast.warn('未选择项目', '请先选择要复制的项目');
    return;
  }

  try {
    const items = historyManager.allHistoryItems.value.filter(item => selectedIdList.includes(item.id));
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

    const formatNames: Record<LinkFormat, string> = { url: 'URL', markdown: 'Markdown', html: 'HTML', bbcode: 'BBCode' };
    toast.success('复制成功', `已复制 ${formattedLinks.length} 个 ${formatNames[format]} 链接`, 1500);
  } catch (error) {
    console.error('[批量复制] 失败:', error);
    toast.error('复制失败', String(error));
  }
};

// 显示删除确认（浮动栏使用）
const showDeleteConfirm = () => {
  const count = historyManager.selectedIds.value.length;
  if (count === 0) {
    toast.warn('未选择项目', '请先选择要删除的项目');
    return;
  }
  handleBulkDelete();
};

// 批量导出
const handleBulkExport = async () => {
  await historyManager.bulkExportJSON(historyManager.selectedIds.value);
};

// 批量删除
const handleBulkDelete = async () => {
  await historyManager.bulkDeleteRecords(historyManager.selectedIds.value);
};

// 复制单个链接
const handleCopyLink = async (item: HistoryItem) => {
  try {
    if (!item.generatedLink) {
      toast.warn('无可用链接', '该项目没有可用的链接');
      return;
    }

    // 动态应用前缀
    let finalLink = item.generatedLink;
    if (item.primaryService === 'weibo') {
      const activePrefix = getActivePrefix(configManager.config.value);
      if (activePrefix) {
        finalLink = `${activePrefix}${item.generatedLink}`;
      }
    }

    await writeText(finalLink);
    toast.success('已复制', '链接已复制到剪贴板', 1500);
  } catch (error) {
    console.error('[历史记录] 复制链接失败:', error);
    toast.error('复制失败', String(error));
  }
};

// 加载历史记录
onMounted(async () => {
  console.log('[HistoryView] 组件已挂载，开始加载历史记录');
  await historyManager.loadHistory();  // 首次加载（或使用缓存）
  await nextTick();
  isFirstMount.value = false;
});

// 【性能优化】视图激活时检查是否需要刷新
onActivated(async () => {
  // 检查缓存是否失效（上传后会调用 invalidateCache 使 isDataLoaded 变为 false）
  if (!isFirstMount.value && !historyManager.isDataLoaded.value) {
    console.log('[HistoryView] 缓存已失效，重新加载历史记录');
    await historyManager.loadHistory();
  }
});

// 【内存优化】视图停用时清理缩略图缓存，释放内存
onDeactivated(() => {
  clearThumbCache();
  console.log('[HistoryView] 视图停用，已清理缩略图缓存');
});

// 注意：不再清理 watchers，因为使用单例模式后状态是共享的
// watchers 需要保持活跃以响应 UI 交互

// 【性能优化】格式化时间 - 使用预创建的 formatter
const formatTime = (timestamp: number) => dateFormatter.format(new Date(timestamp));

// 在浏览器中打开链接
const openInBrowser = async (item: HistoryItem) => {
  try {
    if (!item.generatedLink) {
      toast.warn('无可用链接', '该项目没有可用的链接');
      return;
    }

    // 动态应用前缀（与 handleCopyLink 逻辑一致）
    let finalLink = item.generatedLink;
    if (item.primaryService === 'weibo') {
      const activePrefix = getActivePrefix(configManager.config.value);
      if (activePrefix) {
        finalLink = `${activePrefix}${item.generatedLink}`;
      }
    }

    // 使用 Tauri 的 shell 打开链接
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(finalLink);
  } catch (error) {
    console.error('[历史记录] 打开链接失败:', error);
    toast.error('打开失败', String(error));
  }
};

// 获取缩略图 URL（带缓存）
// 微博图床：直接返回服务端缩略图 URL
// 其他图床：直接返回原图 URL（不再进行前端生成）
const getThumbUrl = (item: HistoryItem): string | undefined => {
  // 检查同步缓存（微博图床）
  if (thumbUrlCache.has(item.id)) {
    return thumbUrlCache.get(item.id);
  }

  if (!item.results || item.results.length === 0) {
    setThumbCache(item.id, undefined);
    return undefined;
  }

  // 优先使用主力图床的结果
  const primaryResult = item.results.find(r => r.serviceId === item.primaryService && r.status === 'success');
  const targetResult = primaryResult || item.results.find(r => r.status === 'success' && r.result?.url);

  if (!targetResult?.result?.url) {
    setThumbCache(item.id, undefined);
    return undefined;
  }

  // 微博图床：使用服务端缩略图
  if (targetResult.serviceId === 'weibo' && targetResult.result.fileKey) {
    let thumbUrl = `https://tvax1.sinaimg.cn/bmiddle/${targetResult.result.fileKey}.jpg`;

    // 应用链接前缀（如果启用）
    const activePrefix = getActivePrefix(configManager.config.value);
    if (activePrefix) {
      thumbUrl = `${activePrefix}${thumbUrl}`;
    }

    setThumbCache(item.id, thumbUrl);
    return thumbUrl;
  }

  // 非微博图床：直接使用原图 URL
  return targetResult.result.url;
};

// 获取服务名称
const getServiceName = (serviceId: ServiceType): string => {
  const serviceNames: Record<ServiceType, string> = {
    weibo: '微博',
    r2: 'R2',
    tcl: 'TCL',
    jd: '京东',
    nowcoder: '牛客',
    qiyu: '七鱼',
    zhihu: '知乎',
    nami: '纳米'
  };
  return serviceNames[serviceId] || serviceId;
};

// 获取所有成功上传的图床
const getSuccessfulServices = (item: HistoryItem): ServiceType[] => {
  return item.results
    .filter(r => r.status === 'success')
    .map(r => r.serviceId);
};

// 获取特定图床的链接（经过处理的链接）
const getServiceLink = (item: HistoryItem, serviceId: ServiceType): string | null => {
  const result = item.results.find(r => r.serviceId === serviceId && r.status === 'success');
  if (!result?.result?.url) return null;

  let link = result.result.url;

  // 微博图床需要应用前缀配置（与 handleCopyLink 函数逻辑一致）
  if (serviceId === 'weibo') {
    const activePrefix = getActivePrefix(configManager.config.value);
    if (activePrefix) {
      link = `${activePrefix}${link}`;
    }
  }

  return link;
};

// 复制特定图床的链接
const handleCopyServiceLink = async (item: HistoryItem, serviceId: ServiceType) => {
  try {
    const link = getServiceLink(item, serviceId);
    if (!link) {
      toast.warn('无可用链接', `${getServiceName(serviceId)} 图床没有可用的链接`);
      return;
    }

    await writeText(link);
    toast.success('已复制', `${getServiceName(serviceId)} 链接已复制到剪贴板`, 1500);
  } catch (error) {
    console.error(`[历史记录] 复制 ${serviceId} 链接失败:`, error);
    toast.error('复制失败', String(error));
  }
};

// === Lightbox 相关函数 ===

// 获取大图 URL（微博使用 large 尺寸）
const getLargeImageUrl = (item: HistoryItem): string => {
  const result = item.results.find(r =>
    r.serviceId === item.primaryService && r.status === 'success'
  );

  if (!result?.result?.url) return '';

  // 微博图床：使用 large 尺寸（而非 bmiddle）
  if (result.serviceId === 'weibo' && result.result.fileKey) {
    let largeUrl = `https://tvax1.sinaimg.cn/large/${result.result.fileKey}.jpg`;

    const activePrefix = getActivePrefix(configManager.config.value);
    if (activePrefix) {
      largeUrl = `${activePrefix}${largeUrl}`;
    }

    return largeUrl;
  }

  return result.result.url;
};

// 获取中等尺寸图 URL（用于悬浮预览，微博使用 bmiddle 约 440px）
const getMediumImageUrl = (item: HistoryItem): string => {
  const result = item.results.find(r =>
    r.serviceId === item.primaryService && r.status === 'success'
  );

  if (!result?.result?.url) return '';

  // 微博图床：使用 bmiddle 尺寸
  if (result.serviceId === 'weibo' && result.result.fileKey) {
    let mediumUrl = `https://tvax1.sinaimg.cn/bmiddle/${result.result.fileKey}.jpg`;

    const activePrefix = getActivePrefix(configManager.config.value);
    if (activePrefix) {
      mediumUrl = `${activePrefix}${mediumUrl}`;
    }

    return mediumUrl;
  }

  // 非微博图床：使用原始 URL
  return result.result.url;
};

// === 悬浮预览相关函数 ===

// 鼠标进入缩略图，显示悬浮预览
const handlePreviewEnter = (event: MouseEvent, item: HistoryItem) => {
  const url = getMediumImageUrl(item);
  if (!url) return;

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const previewMaxHeight = 300;
  const previewMaxWidth = 300;
  const margin = 8;

  // 计算预览框位置（默认居中于缩略图右侧）
  let top = rect.top + rect.height / 2 - previewMaxHeight / 2;
  let left = rect.right + margin;

  // 边界检测：顶部
  if (top < margin) {
    top = margin;
  }

  // 边界检测：底部
  if (top + previewMaxHeight > window.innerHeight - margin) {
    top = window.innerHeight - previewMaxHeight - margin;
  }

  // 边界检测：右侧（如果超出则显示在左侧）
  if (left + previewMaxWidth > window.innerWidth - margin) {
    left = rect.left - previewMaxWidth - margin;
  }

  hoverPreview.value = {
    visible: true,
    url,
    alt: item.localFileName,
    style: {
      top: `${top}px`,
      left: `${left}px`
    }
  };
};

// 鼠标离开缩略图，隐藏悬浮预览
const handlePreviewLeave = () => {
  hoverPreview.value.visible = false;
};

// 打开 Lightbox
const openLightbox = (item: HistoryItem): void => {
  lightboxItem.value = item;
  lightboxImage.value = getLargeImageUrl(item);
  lightboxTitle.value = item.localFileName;
  lightboxVisible.value = true;
};

// 从 Lightbox 删除单项
const deleteSingleItem = async (item: HistoryItem): Promise<void> => {
  try {
    await historyManager.deleteHistoryItem(item.id);
    lightboxVisible.value = false;
    toast.success('删除成功', '已删除 1 条记录');
  } catch (error) {
    console.error('[历史记录] 删除失败:', error);
    toast.error('删除失败', String(error));
  }
};

// === 网格视图辅助函数 ===

// 【性能优化】检查网格项是否选中 - 直接使用 selectedIdsRef
const isGridSelected = (item: HistoryItem): boolean => {
  return historyManager.selectedIdsRef.value.has(item.id);
};

// 切换网格项选中状态
const toggleGridSelection = (item: HistoryItem): void => {
  historyManager.toggleSelection(item.id);
};

// 获取预览图 URL（复用 getThumbUrl）
const getPreviewUrl = (item: HistoryItem): string | undefined => {
  return getThumbUrl(item);
};

// === 虚拟滚动相关 ===

// 网格视图：计算每个卡片的高度（用于虚拟瀑布流）
// 使用固定的图片容器高度，确保计算高度与实际渲染高度一致
const CARD_IMAGE_HEIGHT = 150;  // 固定图片容器高度
const CARD_INFO_HEIGHT = 72;    // 信息区域高度（包含 padding）
const CARD_BORDER = 2;          // 边框

const calcItemHeight = (_item: HistoryItem, _itemWidth: number): number => {
  return CARD_IMAGE_HEIGHT + CARD_INFO_HEIGHT + CARD_BORDER;
};

// 网格列数（响应式）
const gridGap = 16;
const gridColumnWidth = 200;

// === 无限滚动相关 ===

// 处理滚动触底加载更多
const handleScroll = (event: Event) => {
  const target = event.target as HTMLElement;
  if (!target) return;

  const { scrollTop, scrollHeight, clientHeight } = target;
  const threshold = 200;  // 距离底部 200px 时开始加载

  if (scrollHeight - scrollTop - clientHeight < threshold) {
    if (historyManager.hasMore.value && !historyManager.isLoadingMore.value) {
      historyManager.loadMore();
    }
  }
};
</script>

<template>
  <div class="history-view">
    <!-- Dashboard Strip（固定顶部，不随表格滚动） -->
    <div class="dashboard-strip">
        <!-- 左侧控制区 -->
        <div class="controls-area">
          <span class="view-title">上传历史</span>

          <div class="view-switcher">
            <button
              v-for="opt in viewOptions"
              :key="opt.value"
              class="switch-btn"
              :class="{ active: historyManager.historyState.value.viewMode === opt.value }"
              @click="historyManager.switchViewMode(opt.value)"
              :title="opt.label"
            >
              <i :class="opt.icon"></i>
            </button>
          </div>

          <Select
            :model-value="historyManager.historyState.value.currentFilter"
            @update:model-value="historyManager.setFilter($event)"
            :options="serviceOptions"
            optionLabel="label"
            optionValue="value"
            class="filter-select"
          />

          <IconField iconPosition="left" class="search-field">
            <InputIcon class="pi pi-search" />
            <InputText
              v-model="localSearchTerm"
              placeholder="搜索文件名..."
              class="search-input-prime"
            />
            <InputIcon
              v-if="localSearchTerm"
              class="pi pi-times clear-icon"
              @click="localSearchTerm = ''"
            />
          </IconField>
        </div>

        <!-- 右侧统计区 -->
        <div class="stats-area">
          <div class="stat-item">
            <span class="stat-val">{{ historyManager.totalCount.value }}</span>
            <span class="stat-key">总数</span>
          </div>
          <template v-if="historyManager.hasSelection.value">
            <div class="v-divider"></div>
            <div class="stat-item selected">
              <span class="stat-val">{{ historyManager.selectedIds.value.length }}</span>
              <span class="stat-key">已选</span>
            </div>
          </template>
        </div>
    </div>

    <!-- 表格/网格内容区域（可滚动） -->
    <div class="history-container">
      <!-- 加载状态骨架屏 -->
      <div v-if="historyManager.isLoading.value" class="loading-skeleton">
        <div class="skeleton-header">
          <Skeleton width="3rem" height="1.5rem" />
          <Skeleton width="60px" height="36px" />
          <Skeleton width="200px" height="1.5rem" />
          <Skeleton width="180px" height="1.5rem" />
          <Skeleton width="120px" height="1.5rem" />
        </div>
        <div v-for="i in 8" :key="i" class="skeleton-row">
          <Skeleton width="1.5rem" height="1.5rem" />
          <Skeleton width="36px" height="36px" />
          <Skeleton width="70%" height="1rem" />
          <Skeleton width="100px" height="1.5rem" />
          <Skeleton width="60px" height="1.5rem" />
        </div>
      </div>

      <!-- 表格视图（使用分页） -->
      <DataTable
        v-else-if="historyManager.historyState.value.viewMode === 'table'"
        key="table-view"
        :value="historyManager.filteredItems.value"
        dataKey="id"
        paginator
        :rows="50"
        sortField="timestamp"
        :sortOrder="-1"
        class="history-table minimal-table"
        rowHover
        :rowClass="(data: HistoryItem) => historyManager.selectedIdsRef.value.has(data.id) ? 'row-selected' : ''"
        :emptyMessage="historyManager.allHistoryItems.value.length === 0 ? '暂无历史记录' : '未找到匹配的记录'"
      >
        <template #empty>
          <div class="empty-state">
            <i class="pi pi-folder-open"></i>
            <p>没有找到相关记录</p>
          </div>
        </template>

        <!-- 复选框列 -->
        <Column headerStyle="width: 3rem">
          <template #header>
            <Checkbox
              :model-value="isAllSelected"
              @update:model-value="handleHeaderCheckboxChange"
              :binary="true"
              :indeterminate="isSomeSelected && !isAllSelected"
            />
          </template>
          <template #body="slotProps">
            <Checkbox
              :model-value="historyManager.selectedIdsRef.value.has(slotProps.data.id)"
              @update:model-value="historyManager.toggleSelection(slotProps.data.id)"
              :binary="true"
            />
          </template>
        </Column>

        <!-- 预览列（36px 缩略图 + 悬浮预览） -->
        <Column header="预览" style="width: 60px">
          <template #body="slotProps">
            <div
              class="thumb-preview-wrapper"
              @mouseenter="handlePreviewEnter($event, slotProps.data)"
              @mouseleave="handlePreviewLeave"
            >
              <div class="thumb-box" @click="openLightbox(slotProps.data)">
                <img
                  v-if="getThumbUrl(slotProps.data)"
                  :src="getThumbUrl(slotProps.data)"
                  :alt="slotProps.data.localFileName"
                  loading="lazy"
                  @error="(e: any) => e.target.src = '/placeholder.png'"
                />
                <i v-else class="pi pi-image thumb-placeholder"></i>
              </div>
            </div>
          </template>
        </Column>

        <!-- 文件名列 -->
        <Column field="localFileName" header="文件名" sortable style="width: 285px">
          <template #body="slotProps">
            <div class="filename-cell">
              <span class="fname" :title="slotProps.data.localFileName">
                {{ slotProps.data.localFileName }}
              </span>
              <span class="fdate">{{ formatTime(slotProps.data.timestamp) }}</span>
            </div>
          </template>
        </Column>

        <!-- 已传图床列 -->
        <Column header="已传图床" style="width: 180px">
          <template #body="slotProps">
            <div class="service-badges">
              <Tag
                v-for="serviceId in getSuccessfulServices(slotProps.data)"
                :key="serviceId"
                :value="getServiceName(serviceId)"
                severity="secondary"
                class="mini-tag"
                @click="handleCopyServiceLink(slotProps.data, serviceId)"
                v-tooltip.top="`点击复制${getServiceName(serviceId)}链接`"
              />
            </div>
          </template>
        </Column>

      </DataTable>

      <!-- 网格视图（虚拟瀑布流） -->
      <div
        v-else-if="!historyManager.isLoading.value"
        class="virtual-waterfall-container"
        @scroll="handleScroll"
      >
        <!-- 空状态 -->
        <div v-if="historyManager.filteredItems.value.length === 0" class="empty-state">
          <i class="pi pi-folder-open"></i>
          <p>{{ historyManager.allHistoryItems.value.length === 0 ? '暂无历史记录' : '未找到匹配的记录' }}</p>
        </div>

        <!-- 虚拟瀑布流 -->
        <VirtualWaterfall
          v-else
          :items="historyManager.filteredItems.value"
          :calcItemHeight="calcItemHeight"
          :gap="gridGap"
          :itemMinWidth="gridColumnWidth"
          rowKey="id"
          class="virtual-waterfall"
        >
          <template #default="{ item }: { item: HistoryItem }">
            <div
              class="waterfall-card"
              :class="{ selected: isGridSelected(item) }"
            >
              <!-- 图片区域 -->
              <div class="card-image-container" @click="toggleGridSelection(item)">
                <img
                  v-if="getPreviewUrl(item)"
                  :src="getPreviewUrl(item)"
                  :alt="item.localFileName"
                  class="waterfall-image"
                  loading="lazy"
                  @click.stop="openLightbox(item)"
                  @error="(e: any) => e.target.src = '/placeholder.png'"
                />
                <!-- 图片加载中：骨架屏 -->
                <div v-else class="card-skeleton">
                  <Skeleton width="100%" height="100%" animation="wave" />
                </div>

                <!-- 覆盖层 (Glassmorphism) -->
                <div class="card-overlay">
                  <div class="overlay-actions">
                    <Button
                      icon="pi pi-copy"
                      class="p-button-rounded p-button-text p-button-sm overlay-btn"
                      @click.stop="handleCopyLink(item)"
                      v-tooltip.top="'复制链接'"
                    />
                    <Button
                      icon="pi pi-external-link"
                      class="p-button-rounded p-button-text p-button-sm overlay-btn"
                      @click.stop="openLightbox(item)"
                      v-tooltip.top="'查看大图'"
                    />
                  </div>
                </div>
              </div>

              <!-- 选中指示器 -->
              <div v-if="isGridSelected(item)" class="card-selection-overlay">
                <i class="pi pi-check-circle"></i>
              </div>

              <!-- 信息区域 -->
              <div class="card-info">
                <div class="info-top">
                  <span class="filename" :title="item.localFileName">{{ item.localFileName }}</span>
                </div>
                <div class="info-bottom">
                  <span class="date">{{ formatTime(item.timestamp) }}</span>
                  <div class="service-badges-mini">
                    <Tag
                      v-for="serviceId in getSuccessfulServices(item).slice(0, 2)"
                      :key="serviceId"
                      :value="getServiceName(serviceId)"
                      severity="secondary"
                      class="mini-badge"
                    />
                  </div>
                </div>
              </div>
            </div>
          </template>
        </VirtualWaterfall>

        <!-- 加载更多提示 -->
        <div v-if="historyManager.isLoadingMore.value" class="loading-more">
          <i class="pi pi-spin pi-spinner"></i>
          <span>加载中...</span>
        </div>
        <div v-else-if="historyManager.hasMore.value && historyManager.filteredItems.value.length > 0" class="load-more-hint">
          <span>向下滚动加载更多 ({{ historyManager.filteredItems.value.length }}/{{ historyManager.totalCount.value }})</span>
        </div>
        <div v-else-if="historyManager.filteredItems.value.length > 0" class="load-complete">
          <span>已加载全部 {{ historyManager.totalCount.value }} 条记录</span>
        </div>
      </div>

      <!-- Lightbox 图片查看器 -->
      <Dialog
        v-model:visible="lightboxVisible"
        modal
        :dismissableMask="true"
        :showHeader="false"
        class="lightbox-dialog"
        :style="{ width: 'auto', maxWidth: '90vw', background: 'transparent', boxShadow: 'none', border: 'none' }"
        :contentStyle="{ padding: 0, background: 'transparent' }"
      >
        <div class="lightbox-container" @click="lightboxVisible = false">
          <img :src="lightboxImage" class="lightbox-img" @click.stop />

          <div class="lightbox-caption" @click.stop>
            <div class="lightbox-info">
              <span class="lightbox-title">{{ lightboxTitle }}</span>
              <span class="lightbox-time" v-if="lightboxItem">{{ formatTime(lightboxItem.timestamp) }}</span>
            </div>

            <div class="lightbox-actions" v-if="lightboxItem">
              <Button
                icon="pi pi-copy"
                text
                rounded
                class="text-white"
                @click="handleCopyLink(lightboxItem)"
                v-tooltip.top="'复制链接'"
              />
              <Button
                icon="pi pi-external-link"
                text
                rounded
                class="text-white"
                @click="openInBrowser(lightboxItem)"
                v-tooltip.top="'在浏览器打开'"
              />
              <Button
                icon="pi pi-trash"
                severity="danger"
                text
                rounded
                class="text-white"
                @click="deleteSingleItem(lightboxItem)"
                v-tooltip.top="'删除'"
              />
            </div>
          </div>
        </div>
      </Dialog>

      <!-- 浮动批量操作栏 -->
      <Transition name="float-bar">
        <div v-if="historyManager.hasSelection.value" class="floating-action-bar">
          <div class="fab-content">
            <!-- 选中计数 -->
            <span class="fab-count">
              <i class="pi pi-check-circle"></i>
              {{ historyManager.selectedIds.value.length }}
            </span>

            <div class="fab-divider"></div>

            <!-- 复制链接下拉菜单 -->
            <div class="fab-copy-dropdown" ref="copyDropdownRef">
              <Button
                icon="pi pi-copy"
                text
                size="small"
                class="fab-btn"
                @click.stop="toggleCopyMenu"
                v-tooltip.top="'复制链接'"
              />
              <Transition name="dropdown">
                <div v-if="copyMenuVisible" class="copy-menu">
                  <button class="copy-menu-item" @click="handleBulkCopyFormatted('url')">
                    <i class="pi pi-link"></i><span>URL</span>
                  </button>
                  <button class="copy-menu-item" @click="handleBulkCopyFormatted('markdown')">
                    <i class="pi pi-file-edit"></i><span>Markdown</span>
                  </button>
                  <button class="copy-menu-item" @click="handleBulkCopyFormatted('html')">
                    <i class="pi pi-code"></i><span>HTML</span>
                  </button>
                  <button class="copy-menu-item" @click="handleBulkCopyFormatted('bbcode')">
                    <i class="pi pi-comment"></i><span>BBCode</span>
                  </button>
                </div>
              </Transition>
            </div>

            <!-- 导出 -->
            <Button
              icon="pi pi-download"
              text
              size="small"
              class="fab-btn"
              @click="handleBulkExport"
              v-tooltip.top="'导出'"
            />

            <!-- 删除 -->
            <Button
              icon="pi pi-trash"
              severity="danger"
              text
              size="small"
              class="fab-btn fab-btn-danger"
              @click="showDeleteConfirm"
              v-tooltip.top="'删除'"
            />

            <div class="fab-divider"></div>

            <!-- 取消选择 -->
            <Button
              icon="pi pi-times"
              text
              rounded
              size="small"
              class="fab-close"
              @click="historyManager.clearSelection()"
              v-tooltip.top="'取消选择'"
            />
          </div>
        </div>
      </Transition>

    </div>

    <!-- 全局悬浮预览层（Teleport 到 body，避免被父容器 overflow 裁剪） -->
    <Teleport to="body">
      <div
        v-if="hoverPreview.visible && hoverPreview.url"
        class="global-thumb-hover-preview"
        :style="hoverPreview.style"
      >
        <img
          :src="hoverPreview.url"
          :alt="hoverPreview.alt"
          @error="(e: any) => e.target.style.display = 'none'"
        />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* CSS 变量 */
.history-view {
  --thumbnail-size: 60px;
}

.history-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-app);
}

.history-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px 24px;
}

/* history-container 滚动条样式 */
.history-container::-webkit-scrollbar {
  width: 8px;
}

.history-container::-webkit-scrollbar-track {
  background: transparent;
}

.history-container::-webkit-scrollbar-thumb {
  background: var(--border-subtle);
  border-radius: 4px;
}

.history-container::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

/* === Dashboard Strip（顶部控制条）=== */
.dashboard-strip {
  flex-shrink: 0;
  height: 60px;
  background-color: var(--bg-card);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  z-index: 10;
}

/* 左侧控制区 */
.controls-area {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* 右侧统计区 */
.stats-area {
  display: flex;
  align-items: center;
  gap: 24px;
}

/* 统计项 */
.stat-item {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1;
}

.stat-val {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.stat-key {
  font-size: 10px;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin-top: 2px;
}

.stat-item.selected .stat-val {
  color: var(--primary);
}

/* 竖线分隔符 */
.v-divider {
  width: 1px;
  height: 24px;
  background-color: var(--border-subtle);
}

/* 视图标题 */
.view-title {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 16px;
  white-space: nowrap;
}

/* 视图切换器 */
.view-switcher {
  display: flex;
  background: var(--bg-input);
  border-radius: 6px;
  padding: 2px;
  border: 1px solid var(--border-subtle);
}

.switch-btn {
  border: none;
  background: transparent;
  width: 32px;
  height: 28px;
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.switch-btn:hover {
  color: var(--text-primary);
}

.switch-btn.active {
  background-color: var(--bg-card);
  color: var(--primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

/* PrimeVue 搜索框样式 */
.search-field {
  width: 280px;
  transition: width 0.3s ease;
}

.search-field:focus-within {
  width: 320px;
}

/* 深度定制 PrimeVue InputText */
:deep(.search-input-prime.p-inputtext) {
  background: var(--bg-input);
  border: 1px solid transparent;
  border-radius: 20px;
  padding: 0.5rem 2.5rem;
  font-size: 13px;
  color: var(--text-primary);
  transition: all 0.2s;
  height: 32px;
}

:deep(.search-input-prime.p-inputtext:focus) {
  background: var(--bg-card);
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

:deep(.search-input-prime.p-inputtext::placeholder) {
  color: var(--text-secondary);
}

:deep(.search-field .p-icon) {
  color: var(--text-secondary);
  font-size: 13px;
}

:deep(.search-field .pi-times) {
  cursor: pointer;
}

:deep(.search-field .pi-times:hover) {
  color: var(--text-primary);
}

/* 筛选下拉 - 与搜索框保持一致的药丸形样式 */
.filter-select {
  width: 140px;
}

:deep(.filter-select.p-select) {
  height: 32px;
  border-radius: 20px;
  border: 1px solid transparent;
  background: var(--bg-input);
  font-size: 13px;
  transition: all 0.2s;
}

:deep(.filter-select.p-select:hover) {
  border-color: var(--border-subtle);
}

:deep(.filter-select.p-select.p-focus) {
  background: var(--bg-card);
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

:deep(.filter-select .p-select-label) {
  padding: 0.5rem 1rem;
  font-size: 13px;
}

/* 批量操作（保留兼容，但已移至浮动栏） */
.batch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  animation: fadeIn 0.2s ease;
}

.selected-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
  background: rgba(59, 130, 246, 0.1);
  padding: 2px 8px;
  border-radius: 10px;
}

.icon-only-btn {
  width: 32px;
  height: 32px;
}

.danger-hover:hover {
  color: var(--error) !important;
  background: rgba(239, 68, 68, 0.1) !important;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* === 表格视图（极简风格）=== */
.history-table {
  background: var(--bg-card);
  border-radius: 12px;
  overflow: hidden;
  width: 100%;
}

/* 禁用 DataTable 内部滚动，由外层 .history-container 统一处理 */
:deep(.history-table .p-datatable-table-container) {
  overflow: visible !important;
}

/* 表头样式 */
:deep(.minimal-table .p-datatable-thead > tr > th) {
  background: var(--bg-card) !important;
  border-bottom: 2px solid var(--border-subtle) !important;
  padding: 10px 16px !important;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
}

/* 行样式 */
:deep(.minimal-table .p-datatable-tbody > tr) {
  background: transparent !important;
}

:deep(.minimal-table .p-datatable-tbody > tr:nth-child(even)) {
  background: rgba(0, 0, 0, 0.015) !important;
}

:deep(.minimal-table .p-datatable-tbody > tr:hover) {
  background: rgba(59, 130, 246, 0.08) !important;
}

:root.dark-theme :deep(.minimal-table .p-datatable-tbody > tr:hover) {
  background: rgba(59, 130, 246, 0.15) !important;
}

/* 表格行选中态 - 仅背景色 */
:deep(.minimal-table .p-datatable-tbody > tr.row-selected) {
  background: rgba(59, 130, 246, 0.12) !important;
}

:root.dark-theme :deep(.minimal-table .p-datatable-tbody > tr.row-selected) {
  background: rgba(59, 130, 246, 0.18) !important;
}

/* 选中行悬浮态 */
:deep(.minimal-table .p-datatable-tbody > tr.row-selected:hover) {
  background: rgba(59, 130, 246, 0.16) !important;
}

:root.dark-theme :deep(.minimal-table .p-datatable-tbody > tr.row-selected:hover) {
  background: rgba(59, 130, 246, 0.22) !important;
}

/* 单元格样式 */
:deep(.minimal-table .p-datatable-tbody > tr > td) {
  padding: 8px 16px !important;
  border-bottom: 1px solid var(--border-subtle) !important;
  font-size: 13px;
  vertical-align: middle;
}

/* 缩略图盒子（36px 正方形） */
.thumb-box {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  cursor: zoom-in;
  background: var(--bg-input);
  display: inline-block;
}

.thumb-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-placeholder {
  font-size: 1.5rem;
  color: var(--text-muted);
  opacity: 0.5;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

/* 缩略图悬浮预览容器 */
.thumb-preview-wrapper {
  position: relative;
  display: inline-block;
}

/* 文件名单元格 */
.filename-cell {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.fname {
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fdate {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

/* 服务徽章 */
.service-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.mini-tag {
  font-size: 11px !important;
  padding: 2px 6px !important;
  height: auto !important;
  cursor: pointer;
  transition: all 0.2s;
}

.mini-tag:hover {
  transform: translateY(-1px);
  filter: brightness(1.1);
}

/* 链接操作 */
.link-actions {
  display: flex;
  justify-content: center;
  gap: 4px;
}

.action-icon-btn {
  color: var(--text-secondary) !important;
  width: 28px !important;
  height: 28px !important;
}

.action-icon-btn:hover {
  color: var(--primary) !important;
  background: rgba(59, 130, 246, 0.1) !important;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--text-muted);
  gap: 16px;
}

.empty-state i {
  font-size: 48px;
  opacity: 0.5;
}

/* 图床按钮容器（保留用于兼容） */
.service-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

/* 图床按钮样式 */
.service-tag-btn {
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.875rem;
  border-radius: 4px !important;
}

.service-tag-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  filter: brightness(1.1);
}

/* === 网格视图（虚拟瀑布流）=== */

/* 虚拟瀑布流容器 */
.virtual-waterfall-container {
  background: var(--bg-card);
  border-radius: 12px;
  flex: 1;
  min-height: 0;
  /* 关键修改：让 VirtualWaterfall 接管滚动 */
  overflow-y: auto;
  padding: 1rem;
  /* 确保有明确的高度上下文 */
  height: 100%;
}

/* 虚拟瀑布流组件 */
.virtual-waterfall {
  width: 100%;
  height: 100%;
}

/* 滚动条样式 */
.virtual-waterfall-container::-webkit-scrollbar,
:deep(.virtual-waterfall)::-webkit-scrollbar {
  width: 8px;
}

:deep(.virtual-waterfall)::-webkit-scrollbar-track {
  background: transparent;
}

:deep(.virtual-waterfall)::-webkit-scrollbar-thumb {
  background: var(--border-subtle);
  border-radius: 4px;
}

:deep(.virtual-waterfall)::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

/* 加载更多提示样式 */
.loading-more,
.load-more-hint,
.load-complete {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 13px;
}

.loading-more i {
  font-size: 16px;
  color: var(--primary);
}

.load-complete {
  color: var(--text-muted);
  font-size: 12px;
}

/* 瀑布流卡片 */
.waterfall-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
  position: relative;
}

.waterfall-card:hover {
  transform: translateY(-2px);
  border-color: var(--primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.waterfall-card:hover .card-overlay {
  opacity: 1;
}

/* 选中状态（增强） */
.waterfall-card.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2), 0 4px 12px rgba(59, 130, 246, 0.15);
}


/* 图片容器 - 固定高度确保虚拟滚动计算准确 */
.card-image-container {
  position: relative;
  width: 100%;
  height: 150px;  /* 固定高度，与 CARD_IMAGE_HEIGHT 常量一致 */
  background: var(--bg-input);
  cursor: pointer;
  overflow: hidden;
}

/* 定制 Image 组件样式 */
:deep(.waterfall-image) {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.waterfall-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 骨架屏 */
.card-skeleton {
  width: 100%;
  height: 100%;
}

:deep(.card-skeleton .p-skeleton) {
  width: 100%;
  height: 100%;
}

/* 覆盖层（毛玻璃效果） */
.card-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(2px);
  opacity: 0;
  transition: opacity 0.2s ease;
  display: flex;
  align-items: flex-end;
  padding: 0.5rem;
  justify-content: center;
}

.overlay-actions {
  display: flex;
  gap: 0.5rem;
  background: rgba(255, 255, 255, 0.9);
  padding: 4px 8px;
  border-radius: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

:root.dark-theme .overlay-actions {
  background: rgba(30, 30, 30, 0.9);
}

.overlay-btn {
  width: 28px !important;
  height: 28px !important;
  color: var(--text-primary) !important;
}

.overlay-btn:hover {
  background: rgba(0, 0, 0, 0.1) !important;
}

/* 选中指示器（增强：蓝色背景 + 弹跳动画） */
.card-selection-overlay {
  position: absolute;
  top: 8px;
  right: 8px;
  color: white;
  background: var(--primary);
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
  z-index: 10;
  animation: checkBounce 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes checkBounce {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* 信息区域 */
.card-info {
  padding: 0.75rem;
}

.info-top {
  margin-bottom: 0.5rem;
}

.filename {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-primary);
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.info-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.date {
  font-size: 0.7rem;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.service-badges-mini {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.mini-badge {
  font-size: 0.65rem !important;
  padding: 2px 6px !important;
  height: auto !important;
}

/* 滚动条 */
.history-view::-webkit-scrollbar {
  width: 8px;
}

.history-view::-webkit-scrollbar-track {
  background: var(--bg-input);
}

.history-view::-webkit-scrollbar-thumb {
  background: var(--border-subtle);
  border-radius: 4px;
}

.history-view::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

/* === Lightbox 图片查看器 === */
:deep(.lightbox-dialog .p-dialog-mask) {
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(10px);
}

:deep(.lightbox-dialog .p-dialog) {
  background: transparent;
  border: none;
  box-shadow: none;
}

:deep(.lightbox-dialog .p-dialog-content) {
  padding: 0;
  background: transparent;
}

.lightbox-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  cursor: pointer;
}

.lightbox-img {
  max-width: 100%;
  max-height: 80vh;
  border-radius: 4px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  cursor: default;
}

.lightbox-caption {
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 8px 16px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  backdrop-filter: blur(10px);
  cursor: default;
}

.lightbox-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lightbox-title {
  font-size: 14px;
  font-weight: 500;
}

.lightbox-time {
  font-size: 11px;
  opacity: 0.8;
  font-family: var(--font-mono);
}

.lightbox-actions {
  display: flex;
  gap: 8px;
}

.text-white {
  color: white !important;
}

.text-white:hover {
  background: rgba(255, 255, 255, 0.2) !important;
}

/* === 加载骨架屏 === */
.loading-skeleton {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skeleton-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  border-bottom: 2px solid var(--border-subtle);
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.skeleton-row:last-child {
  border-bottom: none;
}

/* === 浮动操作栏 === */
.floating-action-bar {
  position: fixed;
  bottom: 70px;  /* 分页栏高度 ~46px + 间距 24px */
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: rgba(30, 41, 59, 0.9);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  box-shadow: var(--shadow-float), 0 -1px 0 rgba(255, 255, 255, 0.05) inset;
  padding: 8px 16px;
}

:root.light-theme .floating-action-bar {
  background: rgba(255, 255, 255, 0.95);
  box-shadow: var(--shadow-float), 0 1px 0 rgba(0, 0, 0, 0.03) inset;
}

.fab-content {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fab-count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--primary);
  padding: 6px 12px;
  background: rgba(59, 130, 246, 0.1);
  border-radius: 12px;
  white-space: nowrap;
}

.fab-count i {
  font-size: 14px;
}

.fab-divider {
  width: 1px;
  height: 24px;
  background: var(--border-subtle);
  margin: 0 4px;
}

.fab-btn {
  font-size: 13px !important;
  padding: 6px 12px !important;
  border-radius: 8px !important;
}

.fab-btn-danger:hover {
  color: var(--error) !important;
  background: rgba(239, 68, 68, 0.1) !important;
}

.fab-close {
  width: 32px !important;
  height: 32px !important;
  color: var(--text-secondary) !important;
}

.fab-close:hover {
  color: var(--text-primary) !important;
  background: var(--hover-overlay) !important;
}

/* 浮动栏进入/退出动画 */
.float-bar-enter-active,
.float-bar-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.float-bar-enter-from,
.float-bar-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}

/* === 复制下拉菜单 === */
.fab-copy-dropdown {
  position: relative;
}

.copy-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  box-shadow: var(--shadow-float);
  padding: 6px;
  min-width: 140px;
  z-index: 1001;
}

.copy-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}

.copy-menu-item:hover {
  background: var(--hover-overlay);
  color: var(--primary);
}

.copy-menu-item i {
  font-size: 14px;
  color: var(--text-secondary);
  width: 16px;
  text-align: center;
}

.copy-menu-item:hover i {
  color: var(--primary);
}

/* 下拉菜单动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

/* 响应式：窄屏幕隐藏按钮文字 */
@media (max-width: 600px) {
  .fab-btn :deep(.p-button-label) {
    display: none;
  }

  .floating-action-bar {
    padding: 8px 12px;
  }
}
</style>

<!-- 全局样式（不带 scoped，用于 Teleport 渲染到 body 的元素） -->
<style>
/* 全局悬浮预览层（fixed 定位，不受父容器 overflow 限制） */
.global-thumb-hover-preview {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  animation: globalPreviewFadeIn 0.2s ease;
}

@keyframes globalPreviewFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.global-thumb-hover-preview img {
  max-width: 300px;
  max-height: 300px;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  object-fit: contain;
}
</style>
