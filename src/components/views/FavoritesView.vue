<script setup lang="ts">
/**
 * FavoritesView - 收藏视图
 * 平铺均匀网格，无日期分组
 */
import { ref, computed, watch, onUnmounted } from 'vue';
import Skeleton from 'primevue/skeleton';
import EmptyState from '../common/EmptyState.vue';
import { useHistoryViewState } from '../../composables/useHistoryViewState';
import { useHistoryManager } from '../../composables/useHistory';
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
  activationTrigger?: number;
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

// 收藏数据管理（过滤、缩略图、增量渲染）
const {
  favoriteMetas, renderedMetas, hasMore,
  imageStates, getThumbnailUrl, onFavoritesScroll,
} = useFavoritesData({
  filteredMetas: viewState.filteredMetas,
  favoriteSet: historyManager.favoriteSet,
  scrollContainerRef,
  config: configManager.config,
});

// 灯箱管理
const {
  lightboxVisible, lightboxItem,
  lightboxHasPrev, lightboxHasNext,
  openLightbox, handleLightboxNavigate, handleLightboxDelete,
} = useFavoritesLightbox({
  favoriteMetas,
  getDetail: (id: string) => viewState.detailCache.getDetail(id),
  deleteHistoryItem: (id: string) => viewState.deleteHistoryItem(id),
});

// 多选
const selectedIdsSet = computed(() => new Set(viewState.selectedIdList.value));
const selectedAvailableServices = computed<{ serviceId: ServiceType; count: number }[]>(() => {
  const ids = viewState.selectedIdList.value;
  if (ids.length === 0) return [];
  const serviceCountMap = new Map<string, number>();
  for (const meta of favoriteMetas.value) {
    if (ids.includes(meta.id)) {
      serviceCountMap.set(meta.primaryService, (serviceCountMap.get(meta.primaryService) ?? 0) + 1);
    }
  }
  return Array.from(serviceCountMap.entries()).map(([serviceId, count]) => ({
    serviceId: serviceId as ServiceType,
    count,
  }));
});

const handleToggleFavorite = async (id: string) => {
  try {
    await historyManager.toggleFavorite(id);
  } catch { /* useHistory 内部已处理 toast */ }
};

// 监听 filter/searchTerm 变化（与 TimelineView 保持一致）
watch(() => props.filter, (val) => { if (val) viewState.setFilter(val); }, { immediate: true });
watch(() => props.searchTerm, (val) => { if (val !== undefined) viewState.setSearchTerm(val); }, { immediate: true });

// 上报收藏数量（让 HistoryView header 的计数徽章显示正确）
watch(
  [() => favoriteMetas.value.length, () => props.visible],
  ([c, isVisible]) => {
    if (isVisible !== false) emit('update:totalCount', c);
  },
  { immediate: true }
);
watch(() => viewState.selectedIdList.value.length, (c) => emit('update:selectedCount', c), { immediate: true });

// 组件卸载清理
onUnmounted(() => {
  viewState.reset();
});

// TransitionGroup 退场动画：延迟显示空状态，等 leave 动画结束
const isLeaving = ref(false);
const isLastLeave = ref(false);
const showEmptyState = computed(() =>
  favoriteMetas.value.length === 0 && !isLeaving.value
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

watch(() => favoriteMetas.value.length, (newLen, oldLen) => {
  if (newLen === 0 && oldLen > 0) {
    isLeaving.value = true;
    isLastLeave.value = true;
  }
});

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

      <!-- 加载骨架屏 -->
      <template v-if="viewState.isLoading.value">
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
          <EmptyState
            v-if="showEmptyState"
            icon="pi pi-star"
            title="暂无收藏"
            description="点击图片右上角的 ★ 开始收藏"
          />
        </Transition>

        <!-- 均匀网格（始终挂载，v-show 保持 TransitionGroup 存活以执行 leave 动画） -->
        <TransitionGroup
          v-show="favoriteMetas.length > 0 || isLeaving"
          tag="div"
          :name="isLastLeave ? 'fav-last' : 'fav-item'"
          class="favorites-grid"
          @before-leave="onBeforeLeave"
          @after-leave="onAfterLeave"
        >
          <FavoritePhotoItem
            v-for="meta in renderedMetas"
            :key="meta.id"
            :meta="meta"
            :thumbnail-url="getThumbnailUrl(meta)"
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
          <span>加载更多（{{ renderedMetas.length }}/{{ favoriteMetas.length }}）</span>
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
}

.favorites-scroll::-webkit-scrollbar {
  display: none;                   /* Chrome/Safari */
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

/* 星形图标入场动画 */
.empty-fade-enter-active .empty-star-icon {
  animation: empty-star-arrive var(--duration-medium) var(--ease-spring) var(--duration-medium) both;
}

@keyframes empty-star-arrive {
  0% {
    transform: scale(0.5) rotate(-15deg);
    opacity: 0;
  }

  100% {
    transform: scale(1) rotate(0deg);
    opacity: 0.35;
  }
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
