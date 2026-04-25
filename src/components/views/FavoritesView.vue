<script setup lang="ts">
/**
 * FavoritesView - 收藏视图
 * 平铺均匀网格，服务端分页（SQL WHERE is_favorited=1 LIMIT/OFFSET）
 */
import { ref, computed, watch, onUnmounted } from 'vue';
import Skeleton from 'primevue/skeleton';
import EmptyState from '../common/EmptyState.vue';
import { useHistoryViewState } from '../../composables/useHistoryViewState';
import { useHistoryManager } from '../../composables/useHistory';
import { useLazyLoadOnVisible } from '../../composables/useLazyLoadOnVisible';
import { useConfigManager } from '../../composables/useConfig';
import { useFavoritesData } from '../../composables/favorites/useFavoritesData';
import { useFavoritesLightbox } from '../../composables/favorites/useFavoritesLightbox';
import type { HistoryItem, ServiceType } from '../../config/types';
import HistoryLightbox from './history/HistoryLightbox.vue';
import FloatingActionBar from './history/FloatingActionBar.vue';
import FavoritePhotoItem from './favorites/FavoritePhotoItem.vue';

const props = defineProps<{
  filter?: ServiceType | 'all';
  searchTerm?: string;
  visible?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:totalCount', count: number): void;
  (e: 'update:selectedCount', count: number): void;
}>();

const viewState = useHistoryViewState();
const historyManager = useHistoryManager();
const configManager = useConfigManager();

// 滚动容器（用于保存/恢复滚动位置）
const scrollContainerRef = ref<HTMLElement | null>(null);
let savedScrollTop = 0;

// 本地 filter/searchTerm：useFavoritesData 以它们为分页查询输入；同时 props 变化也同步到 viewState 用于清空多选
const localFilter = ref<ServiceType | 'all'>(props.filter ?? 'all');
const localSearchTerm = ref<string>(props.searchTerm ?? '');

const {
  loadedMetas, totalCount, hasMore, isLoading, hasLoadedOnce,
  imageStates, getThumbnailUrls, getItemService, onFavoritesScroll,
  loadFirstPage, loadNextPage,
} = useFavoritesData({
  filter: localFilter,
  searchTerm: localSearchTerm,
  favoriteSet: historyManager.favoriteSet,
  scrollContainerRef,
  config: configManager.config,
});

const {
  lightboxVisible, lightboxItem,
  lightboxHasPrev, lightboxHasNext,
  openLightbox, handleLightboxNavigate, handleLightboxDelete,
} = useFavoritesLightbox({
  favoriteMetas: loadedMetas,
  getDetail: (id: string) => viewState.detailCache.getDetail(id),
  deleteHistoryItem: (id: string) => viewState.deleteHistoryItem(id),
  hasMore,
  loadNext: loadNextPage,
  config: configManager.config,
});

const selectedIdsSet = computed(() => new Set(viewState.selectedIdList.value));
const selectedAvailableServices = computed<{ serviceId: ServiceType; count: number }[]>(() => {
  const ids = viewState.selectedIdList.value;
  if (ids.length === 0) return [];
  const serviceCountMap = new Map<ServiceType, number>();
  for (const id of ids) {
    const service = getItemService(id);
    if (service) {
      serviceCountMap.set(service, (serviceCountMap.get(service) ?? 0) + 1);
    }
  }
  return Array.from(serviceCountMap.entries()).map(([serviceId, count]) => ({ serviceId, count }));
});

const handleToggleFavorite = async (id: string) => {
  try {
    await historyManager.toggleFavorite(id);
  } catch { /* useHistory 内部已处理 toast */ }
};

watch(() => props.filter, (val) => {
  if (val === undefined) return;
  localFilter.value = val;
  viewState.setFilter(val);
}, { immediate: true });
watch(() => props.searchTerm, (val) => {
  if (val === undefined) return;
  localSearchTerm.value = val;
  viewState.setSearchTerm(val);
}, { immediate: true });

watch(
  [() => totalCount.value, () => props.visible],
  ([c, isVisible]) => {
    if (isVisible !== false) emit('update:totalCount', c);
  },
  { immediate: true }
);
watch(() => viewState.selectedIdList.value.length, (c) => emit('update:selectedCount', c), { immediate: true });

onUnmounted(() => {
  viewState.reset();
});

const isLeaving = ref(false);
const isLastLeave = ref(false);
// gate 在 hasLoadedOnce 上避免首次切到收藏时 v-show 切 block 的一帧露出空状态
const showEmptyState = computed(() =>
  hasLoadedOnce.value
  && totalCount.value === 0
  && !isLoading.value
  && !isLeaving.value
);
const onAfterLeave = () => {
  isLeaving.value = false;
  isLastLeave.value = false;
};

// TransitionGroup @before-leave：冻结退场元素尺寸，使 position:absolute 不丢失 Grid 尺寸
const onBeforeLeave = (el: Element) => {
  const htmlEl = el as HTMLElement;
  const { width, height } = htmlEl.getBoundingClientRect();
  htmlEl.style.width = `${width}px`;
  htmlEl.style.height = `${height}px`;
};

watch(() => loadedMetas.value.length, (newLen, oldLen) => {
  if (newLen === 0 && oldLen > 0) {
    isLeaving.value = true;
    isLastLeave.value = true;
  }
});

// 视图首次可见时加载首页（避免首屏跑 SQL；也避免切到其他视图时浪费）
useLazyLoadOnVisible(() => props.visible, () => loadFirstPage());

// 滚动位置保存/恢复（v-show 兼容，与 TimelineView 保持一致）
watch(() => props.visible, async (isVisible, wasVisible) => {
  if (!isVisible) {
    savedScrollTop = scrollContainerRef.value?.scrollTop ?? savedScrollTop;
    return;
  }
  if (wasVisible) return;

  await new Promise<void>(r => requestAnimationFrame(() => r()));
  if (savedScrollTop > 0 && scrollContainerRef.value) {
    scrollContainerRef.value.scrollTop = savedScrollTop;
  }
});
</script>

<template>
  <div class="favorites-view">
    <div ref="scrollContainerRef" class="favorites-scroll" @scroll="onFavoritesScroll">

      <!-- 首次未加载时也走骨架屏分支，避免 v-show 切 block 时的空状态闪烁 -->
      <template v-if="(!hasLoadedOnce || isLoading) && loadedMetas.length === 0">
        <div class="favorites-grid">
          <div v-for="i in 16" :key="i" class="skeleton-cell">
            <Skeleton width="100%" height="100%" border-radius="8px" class="skeleton-fill" />
          </div>
        </div>
      </template>

      <!-- 非加载态：空状态 + 网格共存，用 v-show/v-if 控制可见性 -->
      <template v-else>
        <!-- 空状态（延迟显示，等 TransitionGroup leave 动画结束后才出现） -->
        <Transition name="empty-fade">
          <div v-if="showEmptyState" class="empty-state-wrapper">
            <EmptyState
              icon="pi pi-star"
              title="暂无收藏"
              description="点击图片右上角的 ★ 开始收藏"
            />
          </div>
        </Transition>

        <!-- 均匀网格（始终挂载，v-show 保持 TransitionGroup 存活以执行 leave 动画） -->
        <TransitionGroup
          v-show="loadedMetas.length > 0 || isLeaving"
          tag="div"
          :name="isLastLeave ? 'fav-last' : 'fav-item'"
          class="favorites-grid"
          @before-leave="onBeforeLeave"
          @after-leave="onAfterLeave"
        >
          <FavoritePhotoItem
            v-for="meta in loadedMetas"
            :key="meta.id"
            :meta="meta"
            :thumbnail-urls="getThumbnailUrls(meta)"
            :image-state="imageStates[meta.id]"
            :selected="selectedIdsSet.has(meta.id)"
            @click="openLightbox(meta)"
            @toggle-select="viewState.toggleSelection(meta.id)"
            @toggle-favorite="handleToggleFavorite(meta.id)"
            @image-state-change="(s) => imageStates[meta.id] = s"
          />
        </TransitionGroup>

        <!-- 加载更多指示器 -->
        <div v-if="hasMore" class="load-more-sentinel">
          <i class="pi pi-spin pi-spinner"></i>
          <span>加载更多（{{ loadedMetas.length }}/{{ totalCount }}）</span>
        </div>
      </template>

    </div>

    <!-- 灯箱 -->
    <HistoryLightbox
      v-model:visible="lightboxVisible"
      :item="lightboxItem"
      :has-prev="lightboxHasPrev"
      :has-next="lightboxHasNext"
      @delete="handleLightboxDelete"
      @navigate="handleLightboxNavigate"
      @toggle-favorite="(item: HistoryItem) => handleToggleFavorite(item.id)"
    />

    <!-- 浮动操作栏 -->
    <FloatingActionBar
      :selected-count="viewState.selectedIdList.value.length"
      :visible="viewState.hasSelection.value"
      :available-services="selectedAvailableServices"
      @copy="viewState.bulkCopyFormatted"
      @export="viewState.bulkExport"
      @delete="viewState.bulkDelete"
      @clear-selection="viewState.clearSelection"
      @batch-favorite="(favorited: boolean) => historyManager.batchSetFavorite(viewState.selectedIdList.value, favorited)"
    />
  </div>
</template>

<style scoped>
.favorites-view {
  position: relative;
  height: 100%;
  background: var(--bg-app);
  overflow: hidden;
}

.favorites-scroll {
  height: 100%;
  overflow: hidden auto;
  padding: var(--space-lg-xl) var(--space-xl);
  scrollbar-width: none;           /* Firefox */
  -ms-overflow-style: none;        /* IE/Edge */
  display: flex;
  flex-direction: column;
}

.favorites-scroll::-webkit-scrollbar {
  display: none;                   /* Chrome/Safari */
}

/* 空状态容器：垂直居中 */
.empty-state-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}


/* === 网格 === */
.favorites-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-xs);
  padding-bottom: var(--space-5xl);
}

/* === 加载骨架占位格 === */
.skeleton-cell {
  position: relative;
  aspect-ratio: 1;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.skeleton-fill {
  position: absolute !important;
  inset: 0;
}

/* === 加载更多指示器 === */
.load-more-sentinel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  padding: var(--space-xl) 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.load-more-sentinel i {
  font-size: var(--text-base);
  color: var(--primary);
}

/* === TransitionGroup 动画 === */
.fav-item-enter-active {
  transition: opacity var(--duration-slower) var(--ease-decelerate),
              transform var(--duration-slower) var(--ease-decelerate);
}

.fav-item-enter-from {
  opacity: 0;
  transform: scale(0.9);
}

.fav-item-leave-active {
  position: absolute; /* 脱离 Grid 流，邻居立刻开始滑动填补 */
  transition: opacity var(--duration-slower) var(--ease-accelerate),
              transform var(--duration-slower) var(--ease-accelerate);
  z-index: 0;
}

.fav-item-leave-to {
  opacity: 0;
  transform: scale(0.8) translateY(-12px);
}

.fav-item-move {
  transition: transform var(--duration-slower) var(--ease-standard);
}

/* === 最后一项特殊离场：柔和淡出 === */
.fav-last-enter-active {
  transition: opacity var(--duration-slower) var(--ease-decelerate),
              transform var(--duration-slower) var(--ease-decelerate);
}

.fav-last-enter-from {
  opacity: 0;
  transform: scale(0.9);
}

.fav-last-leave-active {
  position: absolute;
  transition: opacity var(--duration-medium) var(--ease-accelerate),
              transform var(--duration-medium) var(--ease-accelerate);
  z-index: 0;
}

.fav-last-leave-to {
  opacity: 0;
  transform: scale(0.92);
}

.fav-last-move {
  transition: transform var(--duration-slower) var(--ease-standard);
}

/* === 空状态入场：下方浮入 + 缩放 + 弹性缓动 === */
.empty-fade-enter-active {
  transition: opacity var(--duration-slow) var(--ease-standard) var(--duration-fast),
              transform var(--duration-slow) var(--ease-spring) var(--duration-fast);
}

.empty-fade-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}

.empty-fade-leave-active {
  transition: opacity var(--duration-fast) ease;
}

.empty-fade-leave-to {
  opacity: 0;
}


/* === 无障碍：减少动态效果 === */
@media (prefers-reduced-motion: reduce) {
  .fav-item-enter-active,
  .fav-item-leave-active,
  .fav-item-move,
  .fav-last-enter-active,
  .fav-last-leave-active,
  .fav-last-move,
  .empty-fade-enter-active,
  .empty-fade-leave-active {
    transition: none;
  }

  .empty-fade-enter-active .empty-star-icon {
    animation: none;
  }
}

/* === 响应式 === */
@media (width <= 768px) {
  .favorites-scroll {
    padding: var(--space-lg);
  }

  .favorites-grid {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }
}

@media (width <= 480px) {
  .favorites-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2xs);
  }
}
</style>
