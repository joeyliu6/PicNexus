<script setup lang="ts">
/**
 * 历史记录瀑布流视图
 * 独立的瀑布流视图组件，使用 VirtualWaterfall 展示历史记录
 */
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { VirtualWaterfall } from '@lhlyu/vue-virtual-waterfall';
import Skeleton from 'primevue/skeleton';
import type { HistoryItem, ServiceType } from '../../../config/types';
import { useHistoryViewState, type LinkFormat } from '../../../composables/useHistoryViewState';
import { useThumbCache } from '../../../composables/useThumbCache';
import { useToast } from '../../../composables/useToast';
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
const viewState = useHistoryViewState();
const thumbCache = useThumbCache();

// Lightbox 状态
const lightboxVisible = ref(false);
const lightboxItem = ref<HistoryItem | null>(null);

// 网格参数
const CARD_IMAGE_HEIGHT = 180;
const CARD_BORDER = 2;
const gridGap = 16;
const gridColumnWidth = 200;

// 计算卡片高度
const calcItemHeight = (_item: HistoryItem, _itemWidth: number): number => {
  return CARD_IMAGE_HEIGHT + CARD_BORDER;
};

// 初始化
onMounted(async () => {
  console.log('[HistoryGridView] 组件已挂载');
  await viewState.loadHistory();
});

// 清理
onUnmounted(() => {
  console.log('[HistoryGridView] 组件已卸载');
  viewState.reset();
  thumbCache.clearThumbCache();
});

// 监听 props 变化，同步到 viewState
watch(() => props.filter, (newFilter) => {
  viewState.setFilter(newFilter);
}, { immediate: true });

watch(() => props.searchTerm, (newTerm) => {
  viewState.setSearchTerm(newTerm);
}, { immediate: true });

// 向父组件同步统计数据
watch(() => viewState.totalCount.value, (count) => {
  emit('update:totalCount', count);
}, { immediate: true });

watch(() => viewState.selectedIdList.value.length, (count) => {
  emit('update:selectedCount', count);
}, { immediate: true });

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

// === 无限滚动 ===

const handleScroll = (event: Event) => {
  const target = event.target as HTMLElement;
  if (!target) return;

  const { scrollTop, scrollHeight, clientHeight } = target;
  const threshold = 200;

  if (scrollHeight - scrollTop - clientHeight < threshold) {
    if (viewState.hasMore.value && !viewState.isLoadingMore.value) {
      viewState.loadMore();
    }
  }
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
  <div class="grid-view-container">
    <!-- 加载状态 -->
    <div v-if="viewState.isLoading.value" class="loading-grid">
      <div v-for="i in 12" :key="i" class="skeleton-card">
        <Skeleton width="100%" height="180px" />
      </div>
    </div>

    <!-- 瀑布流容器 -->
    <div
      v-else
      class="virtual-waterfall-container"
      @scroll="handleScroll"
    >
      <!-- 空状态 -->
      <div v-if="viewState.filteredItems.value.length === 0" class="empty-state">
        <i class="pi pi-folder-open"></i>
        <p>{{ viewState.allHistoryItems.value.length === 0 ? '暂无历史记录' : '未找到匹配的记录' }}</p>
      </div>

      <!-- 虚拟瀑布流 -->
      <VirtualWaterfall
        v-else
        :items="viewState.filteredItems.value"
        :calcItemHeight="calcItemHeight"
        :gap="gridGap"
        :itemMinWidth="gridColumnWidth"
        rowKey="id"
        class="virtual-waterfall"
      >
        <template #default="{ item }: { item: HistoryItem }">
          <div
            class="waterfall-card"
            :class="{ selected: viewState.isSelected(item.id) }"
          >
            <!-- 图片区域 -->
            <div class="card-image-container" @click="openLightbox(item)">
              <img
                v-if="thumbCache.getThumbUrl(item)"
                :src="thumbCache.getThumbUrl(item)"
                :alt="item.localFileName"
                class="waterfall-image"
                loading="lazy"
                @error="(e: any) => e.target.src = '/placeholder.png'"
              />
              <!-- 图片加载中：骨架屏 -->
              <div v-else class="card-skeleton">
                <Skeleton width="100%" height="100%" animation="wave" />
              </div>

              <!-- 顶部渐变阴影 -->
              <div class="card-top-gradient"></div>

              <!-- 左上角圆形复选框 -->
              <div
                class="card-checkbox"
                :class="{ checked: viewState.isSelected(item.id) }"
                @click.stop="viewState.toggleSelection(item.id)"
              >
                <i v-if="viewState.isSelected(item.id)" class="pi pi-check"></i>
              </div>
            </div>
          </div>
        </template>
      </VirtualWaterfall>

      <!-- 加载更多提示 -->
      <div v-if="viewState.isLoadingMore.value" class="loading-more">
        <i class="pi pi-spin pi-spinner"></i>
        <span>加载中...</span>
      </div>
      <div v-else-if="viewState.hasMore.value && viewState.filteredItems.value.length > 0" class="load-more-hint">
        <span>向下滚动加载更多 ({{ viewState.filteredItems.value.length }}/{{ viewState.totalCount.value }})</span>
      </div>
      <div v-else-if="viewState.filteredItems.value.length > 0" class="load-complete">
        <span>已加载全部 {{ viewState.totalCount.value }} 条记录</span>
      </div>
    </div>

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
  </div>
</template>

<style scoped>
.grid-view-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 虚拟瀑布流容器 */
.virtual-waterfall-container {
  background: var(--bg-card);
  border-radius: 12px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
  height: 100%;
}

.virtual-waterfall {
  width: 100%;
  height: 100%;
}

/* 滚动条样式 */
:deep(.virtual-waterfall)::-webkit-scrollbar-track {
  background: transparent;
}

/* 加载骨架屏网格 */
.loading-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  padding: 1rem;
  background: var(--bg-card);
  border-radius: 12px;
}

.skeleton-card {
  border-radius: 12px;
  overflow: hidden;
}

/* 瀑布流卡片 */
.waterfall-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  overflow: hidden;
  position: relative;
}

.waterfall-card.selected {
  border-color: var(--primary);
}

/* 图片容器 */
.card-image-container {
  position: relative;
  width: 100%;
  height: 180px;
  background: var(--bg-input);
  cursor: pointer;
  overflow: hidden;
  border-radius: 12px;
}

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

/* 顶部渐变阴影 */
.card-top-gradient {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 60px;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.4) 0%,
    rgba(0, 0, 0, 0.15) 50%,
    transparent 100%
  );
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
  border-radius: 12px 12px 0 0;
}

.waterfall-card:hover .card-top-gradient,
.waterfall-card.selected .card-top-gradient {
  opacity: 1;
}

/* 左上角圆形复选框 */
.card-checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.3);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s ease, background 0.15s ease, border-color 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.card-checkbox:hover {
  background: rgba(0, 0, 0, 0.5);
}

.waterfall-card:hover .card-checkbox {
  opacity: 1;
}

.card-checkbox.checked {
  opacity: 1;
  background: var(--primary);
  border-color: var(--primary);
}

.card-checkbox.checked:hover {
  background: var(--primary);
  border-color: var(--primary);
  filter: brightness(1.1);
}

.card-checkbox.checked i {
  color: white;
  font-size: 10px;
  font-weight: bold;
}

/* 加载更多提示 */
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
</style>
