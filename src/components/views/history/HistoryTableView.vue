<script setup lang="ts">
/**
 * 历史记录表格视图
 * 独立的表格视图组件，使用 DataTable 展示历史记录
 * v2.0: 服务端分页模式，支持大数据量
 */
import { ref, shallowRef, onMounted, onUnmounted, watch } from 'vue';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Checkbox from 'primevue/checkbox';
import Tag from 'primevue/tag';
import Skeleton from 'primevue/skeleton';
import type { HistoryItem, ServiceType } from '../../../config/types';
import { getActivePrefix } from '../../../config/types';
import { useHistoryViewState, type LinkFormat } from '../../../composables/useHistoryViewState';
import { useHistoryManager } from '../../../composables/useHistory';
import { useThumbCache } from '../../../composables/useThumbCache';
import { useConfigManager } from '../../../composables/useConfig';
import { useToast } from '../../../composables/useToast';
import { onCacheEventType } from '../../../events/cacheEvents';
import HistoryLightbox from './HistoryLightbox.vue';
import FloatingActionBar from './FloatingActionBar.vue';

// Props
const props = defineProps<{
  filter: ServiceType | 'all';
  searchTerm: string;
}>();

// Emits
const emit = defineEmits<{
  (e: 'update:totalCount', count: number): void;
  (e: 'update:selectedCount', count: number): void;
}>();

const toast = useToast();
const configManager = useConfigManager();
const viewState = useHistoryViewState();
const historyManager = useHistoryManager();
const thumbCache = useThumbCache();

// === 服务端分页状态 ===
const currentPageData = shallowRef<HistoryItem[]>([]);
const currentPage = ref(1);
const pageSize = ref(100);
const totalRecords = ref(0);
const isLoadingPage = ref(true);  // 初始为 true，组件挂载时显示骨架屏
const first = ref(0);  // DataTable 的 first 参数（起始索引）

// 骨架数据（加载时使用，确保骨架屏结构与真实数据完全一致）
const skeletonData = Array.from({ length: 20 }, (_, i) => ({
  id: `skeleton-${i}`,
  _skeleton: true  // 标记为骨架数据
})) as any[];

// 判断是否为骨架数据
const isSkeleton = (data: any) => data._skeleton === true;

// 日期格式化器
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

// 格式化时间
const formatTime = (timestamp: number) => dateFormatter.format(new Date(timestamp));

// Lightbox 状态
const lightboxVisible = ref(false);
const lightboxItem = ref<HistoryItem | null>(null);

// 悬浮预览状态
const hoverPreview = ref({
  visible: false,
  url: '',
  alt: '',
  style: {} as Record<string, string>
});

// 表头复选框状态
const selectAll = ref(false);

// 事件监听取消函数
let unlistenUpdated: (() => void) | null = null;
let unlistenDeleted: (() => void) | null = null;

/**
 * 加载当前页数据（服务端分页核心函数）
 */
async function loadCurrentPage() {
  try {
    isLoadingPage.value = true;

    const hasSearch = props.searchTerm?.trim();

    if (hasSearch) {
      // 搜索模式：使用 searchHistory
      const result = await historyManager.searchHistory(props.searchTerm, {
        serviceFilter: props.filter === 'all' ? undefined : props.filter,
        limit: pageSize.value,
        offset: (currentPage.value - 1) * pageSize.value
      });
      currentPageData.value = result.items;
      totalRecords.value = result.total;
    } else {
      // 普通分页模式：使用 loadPageByNumber
      const result = await historyManager.loadPageByNumber(
        currentPage.value,
        pageSize.value,
        props.filter
      );
      currentPageData.value = result.items;
      totalRecords.value = result.total;
    }

    console.log(`[HistoryTableView] 加载第 ${currentPage.value} 页: ${currentPageData.value.length}/${totalRecords.value} 条`);
  } catch (error) {
    console.error('[HistoryTableView] 加载失败:', error);
    toast.error('加载失败', String(error));
    currentPageData.value = [];
    totalRecords.value = 0;
  } finally {
    isLoadingPage.value = false;
  }
}

/**
 * 分页事件处理（DataTable @page 事件）
 */
function onPageChange(event: { page: number; first: number; rows: number }) {
  currentPage.value = event.page + 1;  // PrimeVue 页码从 0 开始
  first.value = event.first;
  loadCurrentPage();
}

// 初始化
onMounted(async () => {
  console.log('[HistoryTableView] 组件已挂载（服务端分页模式）');

  // 监听历史记录更新事件（上传、导入、重传等）
  unlistenUpdated = await onCacheEventType('history-updated', () => {
    console.log('[HistoryTableView] 收到 history-updated 事件，重新加载第一页');
    currentPage.value = 1;
    first.value = 0;
    loadCurrentPage();
  });

  // 监听历史记录删除事件
  unlistenDeleted = await onCacheEventType('history-deleted', () => {
    console.log('[HistoryTableView] 收到 history-deleted 事件，重新加载当前页');
    loadCurrentPage();
  });

  // 初始加载第一页
  await loadCurrentPage();
});

// 清理
onUnmounted(() => {
  console.log('[HistoryTableView] 组件已卸载');

  // 取消事件监听
  unlistenUpdated?.();
  unlistenDeleted?.();

  viewState.reset();
  thumbCache.clearThumbCache();
});

// 监听 props 变化，重置到第一页并重新加载
watch([() => props.filter, () => props.searchTerm], () => {
  console.log('[HistoryTableView] 筛选/搜索条件变化，重置到第一页');
  currentPage.value = 1;
  first.value = 0;
  loadCurrentPage();
});

// 向父组件同步统计数据
watch(() => totalRecords.value, (count) => {
  emit('update:totalCount', count);
}, { immediate: true });

watch(() => viewState.selectedIdList.value.length, (count) => {
  emit('update:selectedCount', count);
}, { immediate: true });

// 监听选中状态变化，同步全选复选框（仅当前页）
watch(() => {
  if (currentPageData.value.length === 0) return false;
  return currentPageData.value.every(item => viewState.isSelected(item.id));
}, (allSelected) => {
  selectAll.value = allSelected;
});

// === 服务相关函数 ===

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

const getSuccessfulServices = (item: HistoryItem): ServiceType[] => {
  return item.results
    .filter(r => r.status === 'success')
    .map(r => r.serviceId);
};

// 复制特定图床的链接
const handleCopyServiceLink = async (item: HistoryItem, serviceId: ServiceType) => {
  try {
    const result = item.results.find(r => r.serviceId === serviceId && r.status === 'success');
    if (!result?.result?.url) {
      toast.warn('无可用链接', `${getServiceName(serviceId)} 图床没有可用的链接`);
      return;
    }

    let link = result.result.url;
    if (serviceId === 'weibo') {
      const activePrefix = getActivePrefix(configManager.config.value);
      if (activePrefix) {
        link = `${activePrefix}${link}`;
      }
    }

    await writeText(link);
    toast.success('已复制', `${getServiceName(serviceId)} 链接已复制到剪贴板`, 1500);
  } catch (error) {
    console.error(`[历史记录] 复制 ${serviceId} 链接失败:`, error);
    toast.error('复制失败', String(error));
  }
};

// === 悬浮预览相关 ===

const handlePreviewEnter = (event: MouseEvent, item: HistoryItem) => {
  const url = thumbCache.getMediumImageUrl(item);
  if (!url) return;

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const previewMaxHeight = 300;
  const previewMaxWidth = 300;
  const margin = 8;

  let top = rect.top + rect.height / 2 - previewMaxHeight / 2;
  let left = rect.right + margin;

  if (top < margin) top = margin;
  if (top + previewMaxHeight > window.innerHeight - margin) {
    top = window.innerHeight - previewMaxHeight - margin;
  }
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

const handlePreviewLeave = () => {
  hoverPreview.value.visible = false;
};

// === Lightbox 相关 ===

const openLightbox = (item: HistoryItem) => {
  lightboxItem.value = item;
  lightboxVisible.value = true;
};

const handleLightboxDelete = async (item: HistoryItem) => {
  try {
    await viewState.deleteHistoryItem(item.id);
    lightboxVisible.value = false;
    toast.success('删除成功', '已删除 1 条记录');
  } catch (error) {
    console.error('[历史记录] 删除失败:', error);
    toast.error('删除失败', String(error));
  }
};

// === 表头复选框相关（仅当前页）===

const handleHeaderCheckboxChange = (checked: boolean) => {
  selectAll.value = checked;
  // 只选中/取消选中当前页的数据
  currentPageData.value.forEach(item => {
    if (checked) {
      viewState.select(item.id);
    } else {
      viewState.deselect(item.id);
    }
  });
};

// === 浮动操作栏相关 ===

const handleBulkCopy = (format: LinkFormat) => {
  viewState.bulkCopyFormatted(format);
};

const handleBulkExport = () => {
  viewState.bulkExport();
};

const handleBulkDelete = () => {
  viewState.bulkDelete();
};
</script>

<template>
  <div class="table-view-container">
    <!-- 表格视图（服务端分页，加载时使用骨架数据） -->
    <DataTable
      :value="isLoadingPage ? skeletonData : currentPageData"
      dataKey="id"
      lazy
      :paginator="!isLoadingPage"
      :first="first"
      :rows="pageSize"
      :totalRecords="totalRecords"
      @page="onPageChange"
      sortField="timestamp"
      :sortOrder="-1"
      class="history-table minimal-table"
      rowHover
      :rowClass="(data: any) => data._skeleton ? '' : (viewState.isSelected(data.id) ? 'row-selected' : '')"
      :emptyMessage="totalRecords === 0 ? '暂无历史记录' : '未找到匹配的记录'"
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
            v-if="!isLoadingPage"
            :model-value="selectAll"
            @update:model-value="handleHeaderCheckboxChange"
            :binary="true"
            :indeterminate="currentPageData.some(item => viewState.isSelected(item.id)) && !selectAll"
          />
          <Skeleton v-else width="1.25rem" height="1.25rem" borderRadius="4px" />
        </template>
        <template #body="slotProps">
          <Skeleton v-if="isSkeleton(slotProps.data)" width="1.25rem" height="1.25rem" borderRadius="4px" />
          <Checkbox
            v-else
            :model-value="viewState.isSelected(slotProps.data.id)"
            @update:model-value="viewState.toggleSelection(slotProps.data.id)"
            :binary="true"
          />
        </template>
      </Column>

      <!-- 预览列 -->
      <Column header="预览" style="width: 60px">
        <template #body="slotProps">
          <!-- 骨架屏状态 - 使用与真实数据相同的结构 -->
          <div v-if="isSkeleton(slotProps.data)" class="thumb-preview-wrapper">
            <div class="thumb-box">
              <Skeleton width="100%" height="100%" borderRadius="0" />
            </div>
          </div>
          <!-- 真实数据 -->
          <div
            v-else
            class="thumb-preview-wrapper"
            @mouseenter="handlePreviewEnter($event, slotProps.data)"
            @mouseleave="handlePreviewLeave"
          >
            <div class="thumb-box" @click="openLightbox(slotProps.data)">
              <Skeleton v-if="thumbCache.getThumbUrl(slotProps.data)" class="thumb-skeleton" />
              <img
                v-if="thumbCache.getThumbUrl(slotProps.data)"
                :src="thumbCache.getThumbUrl(slotProps.data)"
                :alt="slotProps.data.localFileName"
                loading="lazy"
                class="thumb-img"
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
          <!-- 骨架屏状态 -->
          <div v-if="isSkeleton(slotProps.data)" class="filename-cell">
            <Skeleton width="70%" height="13px" />
            <Skeleton width="140px" height="11px" class="mt-skeleton" />
          </div>
          <!-- 真实数据 -->
          <div v-else class="filename-cell">
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
          <!-- 骨架屏状态 -->
          <Skeleton v-if="isSkeleton(slotProps.data)" width="50px" height="22px" borderRadius="4px" />
          <!-- 真实数据 -->
          <div v-else class="service-badges">
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

    <!-- Lightbox -->
    <HistoryLightbox
      v-model:visible="lightboxVisible"
      :item="lightboxItem"
      @delete="handleLightboxDelete"
    />

    <!-- 浮动操作栏 -->
    <FloatingActionBar
      :selected-count="viewState.selectedIdList.value.length"
      :visible="viewState.hasSelection.value"
      @copy="handleBulkCopy"
      @export="handleBulkExport"
      @delete="handleBulkDelete"
      @clear-selection="viewState.clearSelection"
    />

    <!-- 全局悬浮预览层 -->
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
.table-view-container {
  height: 100%;
}

/* === 表格视图（极简风格）=== */
.history-table {
  background: var(--bg-card);
  border-radius: 12px;
  overflow: hidden;
  width: 100%;
}

/* 强制固定列宽，确保骨架屏和真实数据的列宽一致 */
:deep(.minimal-table .p-datatable-table) {
  table-layout: fixed;
}

/* 禁用 DataTable 内部滚动 */
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
  height: 40px !important;  /* 固定表头高度 */
  box-sizing: border-box;
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

/* 表格行选中态 */
:deep(.minimal-table .p-datatable-tbody > tr.row-selected) {
  background: rgba(59, 130, 246, 0.12) !important;
}

:root.dark-theme :deep(.minimal-table .p-datatable-tbody > tr.row-selected) {
  background: rgba(59, 130, 246, 0.18) !important;
}

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
  height: 52px !important;  /* 固定行高，与骨架屏一致 */
  box-sizing: border-box;
}

/* 缩略图盒子 */
.thumb-box {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  cursor: zoom-in;
  background: var(--bg-input);
  display: inline-block;
  position: relative;  /* 确保子元素可以绝对定位 */
}

.thumb-skeleton {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
  border-radius: 0;
  z-index: 0;
}

.thumb-img {
  position: absolute;
  inset: 0;
  z-index: 1;  /* 图片在骨架屏之上 */
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

/* 骨架屏间距辅助类 */
.mt-1 {
  margin-top: 4px;
}

.mt-skeleton {
  margin-top: 2px;
}

/* 修复骨架屏累积偏移：强制 Skeleton 使用 inline-block 布局 */
:deep(.minimal-table .p-datatable-tbody .p-skeleton) {
  display: inline-block !important;
  vertical-align: middle;
}
</style>

<!-- 全局样式（悬浮预览层） -->
<style>
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
