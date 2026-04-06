<script setup lang="ts">
/**
 * FavoritesView - 收藏视图
 * 平铺均匀网格，无日期分组
 */
import { ref, computed, watch, reactive } from 'vue';
import Skeleton from 'primevue/skeleton';
import { useHistoryViewState } from '../../composables/useHistoryViewState';
import { useHistoryManager } from '../../composables/useHistory';
import { useConfigManager } from '../../composables/useConfig';
import { useToast } from '../../composables/useToast';
import { generateMediumThumbnailUrl } from '../../composables/useThumbCache';
import type { ImageMeta } from '../../types/image-meta';
import type { HistoryItem, ServiceType } from '../../config/types';
import HistoryLightbox from './history/HistoryLightbox.vue';
import FloatingActionBar from './history/FloatingActionBar.vue';

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

const toast = useToast();
const viewState = useHistoryViewState();
const historyManager = useHistoryManager();
const configManager = useConfigManager();

// 滚动容器（用于保存/恢复滚动位置）
const scrollContainerRef = ref<HTMLElement | null>(null);
let savedScrollTop = 0;

// 图片加载状态追踪（响应式对象，Vue 3 Proxy 自动追踪属性增删）
const imageStates = reactive<Record<string, 'loading' | 'loaded' | 'failed'>>({});

// 收藏列表（基于独立 favoriteSet 过滤，避免依赖 imageMetas 的 isFavorited 属性）
const favoriteMetas = computed<ImageMeta[]>(() => {
  const favSet = historyManager.favoriteSet.value;
  return viewState.filteredMetas.value.filter(m => favSet.has(m.id));
});

// 灯箱
const lightboxVisible = ref(false);
const lightboxItem = ref<HistoryItem | null>(null);

const lightboxIndex = computed(() => {
  if (!lightboxItem.value) return -1;
  return favoriteMetas.value.findIndex(m => m.id === lightboxItem.value!.id);
});

const lightboxHasPrev = computed(() => lightboxIndex.value > 0);
const lightboxHasNext = computed(() =>
  lightboxIndex.value >= 0 && lightboxIndex.value < favoriteMetas.value.length - 1
);

// 多选
const selectedIdsSet = computed(() => new Set(viewState.selectedIdList.value));
const selectedAvailableServices = computed<ServiceType[]>(() => {
  const ids = viewState.selectedIdList.value;
  if (ids.length === 0) return [];
  const serviceSet = new Set<ServiceType>();
  for (const meta of favoriteMetas.value) {
    if (ids.includes(meta.id)) serviceSet.add(meta.primaryService);
  }
  return Array.from(serviceSet);
});

function getThumbnailUrl(meta: ImageMeta): string {
  return generateMediumThumbnailUrl(
    meta.primaryService,
    meta.primaryUrl,
    meta.primaryFileKey,
    configManager.config.value
  );
}

const openLightbox = async (meta: ImageMeta) => {
  try {
    const detail = await viewState.detailCache.getDetail(meta.id);
    lightboxItem.value = detail;
    lightboxVisible.value = true;
  } catch (e) {
    toast.error('加载失败', String(e));
  }
};

const handleLightboxNavigate = async (direction: 'prev' | 'next') => {
  const metas = favoriteMetas.value;
  const nextIdx = lightboxIndex.value + (direction === 'prev' ? -1 : 1);
  if (nextIdx < 0 || nextIdx >= metas.length) return;
  try {
    lightboxItem.value = await viewState.detailCache.getDetail(metas[nextIdx].id);
  } catch (e) {
    console.error('[FavoritesView] 导航失败:', e);
  }
};

const handleToggleFavorite = async (item: HistoryItem) => {
  try {
    await historyManager.toggleFavorite(item.id);
  } catch { /* useHistory 内部已处理 toast */ }
};

const handleItemToggleFavorite = async (id: string) => {
  try {
    await historyManager.toggleFavorite(id);
  } catch { /* useHistory 内部已处理 toast */ }
};

const handleLightboxDelete = async (item: HistoryItem) => {
  try {
    await viewState.deleteHistoryItem(item.id);
    lightboxVisible.value = false;
    toast.success('已删除');
  } catch (e) {
    toast.error('删除失败', String(e));
  }
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
    <div ref="scrollContainerRef" class="favorites-scroll">

      <!-- 加载骨架屏 -->
      <template v-if="viewState.isLoading.value">
        <div class="favorites-grid">
          <div v-for="i in 16" :key="i" class="photo-item">
            <Skeleton width="100%" height="100%" border-radius="8px" class="photo-skeleton" />
          </div>
        </div>
      </template>

      <!-- 非加载态：空状态 + 网格共存，用 v-show/v-if 控制可见性 -->
      <template v-else>
        <!-- 空状态（延迟显示，等 TransitionGroup leave 动画结束后才出现） -->
        <Transition name="empty-fade">
          <div v-if="showEmptyState" class="empty-state">
            <i class="pi pi-star empty-star-icon" style="font-size: 2.8rem; opacity: 0.35"></i>
            <p class="empty-title">暂无收藏</p>
            <p class="empty-hint">点击图片右上角的 ★ 开始收藏</p>
          </div>
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
          <div
            v-for="meta in favoriteMetas"
            :key="meta.id"
            class="photo-item"
            :class="{ selected: selectedIdsSet.has(meta.id) }"
            @click="openLightbox(meta)"
          >
            <!-- 加载骨架 -->
            <Skeleton
              v-if="imageStates[meta.id] !== 'loaded' && imageStates[meta.id] !== 'failed'"
              width="100%"
              height="100%"
              border-radius="8px"
              class="photo-skeleton"
            />

            <!-- 加载失败占位 -->
            <div v-if="imageStates[meta.id] === 'failed'" class="photo-error">
              <i class="pi pi-image"></i>
            </div>

            <!-- 图片 -->
            <img
              v-if="imageStates[meta.id] !== 'failed'"
              :src="getThumbnailUrl(meta)"
              class="photo-img"
              :class="{ loaded: imageStates[meta.id] === 'loaded' }"
              loading="lazy"
              @load="imageStates[meta.id] = 'loaded'"
              @error="imageStates[meta.id] = 'failed'"
            />

            <!-- 选中遮罩 -->
            <div class="selection-overlay"></div>

            <!-- 复选框 -->
            <div
              class="checkbox"
              :class="{ checked: selectedIdsSet.has(meta.id) }"
              @click.stop="viewState.toggleSelection(meta.id)"
            >
              <i v-if="selectedIdsSet.has(meta.id)" class="pi pi-check"></i>
            </div>

            <!-- 收藏按钮（收藏视图中始终为已收藏状态） -->
            <div
              class="favorite-btn favorited"
              @click.stop="handleItemToggleFavorite(meta.id)"
            >
              <i class="pi pi-star-fill"></i>
            </div>
          </div>
        </TransitionGroup>
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
      @toggle-favorite="handleToggleFavorite"
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
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px 24px;
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
  gap: 4px;
  padding-bottom: 60px;
}

/* === 图片项 === */
.photo-item {
  position: relative;
  aspect-ratio: 1;
  background: var(--bg-secondary);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  will-change: transform;
}

.photo-skeleton {
  position: absolute !important;
  inset: 0;
  z-index: 1;
}

.photo-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  color: var(--text-muted);
  opacity: 0.6;
}

.photo-error i {
  font-size: 1.5rem;
}

.photo-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity var(--duration-medium) ease-in-out, transform var(--duration-medium);
}

.photo-img.loaded {
  opacity: 1;
}

.photo-item:hover .photo-img.loaded {
  transform: scale(1.03);
}

/* 选中遮罩 */
.selection-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.1);
  opacity: 0;
  transition: opacity var(--duration-normal);
  pointer-events: none;
}

.photo-item.selected .selection-overlay {
  opacity: 1;
  background: var(--primary-alpha-20);
  border: 2px solid var(--primary);
  border-radius: 8px;
}

/* 复选框 */
.checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.8);
  background: rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all var(--duration-normal);
  z-index: 2;
}

.photo-item:hover .checkbox,
.checkbox.checked {
  opacity: 1;
}

.checkbox:hover {
  background: rgba(0, 0, 0, 0.4);
}

.checkbox.checked {
  background: var(--primary);
  border-color: var(--primary);
}

.checkbox.checked i {
  font-size: 10px;
  color: white;
  font-weight: bold;
}

/* 收藏按钮 */
.favorite-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all var(--duration-normal);
  z-index: 2;
  cursor: pointer;
  font-size: 11px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}

.photo-item:hover .favorite-btn,
.favorite-btn.favorited {
  opacity: 1;
}

.favorite-btn.favorited {
  color: var(--warning);
  filter: drop-shadow(0 1px 3px rgba(234, 179, 8, 0.4));
}

.favorite-btn:hover {
  transform: scale(1.15);
}

.favorite-btn.favorited:hover {
  filter: drop-shadow(0 1px 4px rgba(234, 179, 8, 0.6));
}

/* === 空状态 === */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: calc(100% - 40px);
  color: var(--text-secondary);
  gap: 8px;
}

.empty-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-secondary);
  margin: 8px 0 0;
}

.empty-hint {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0;
}

/* === TransitionGroup 动画 === */
.fav-item-enter-active {
  transition: opacity 0.45s ease, transform 0.45s ease;
}

.fav-item-enter-from {
  opacity: 0;
  transform: scale(0.9);
}

.fav-item-leave-active {
  position: absolute; /* 脱离 Grid 流，邻居立刻开始滑动填补 */
  transition: opacity var(--duration-slower) ease-out, transform var(--duration-slower) ease-out;
  z-index: 0;
}

.fav-item-leave-to {
  opacity: 0;
  transform: scale(0.8) translateY(-12px);
}

.fav-item-move {
  transition: transform 0.55s cubic-bezier(0.25, 0.1, 0.25, 1);
}

/* === 最后一项特殊离场：柔和淡出 === */
.fav-last-enter-active {
  transition: opacity 0.45s ease, transform 0.45s ease;
}

.fav-last-enter-from {
  opacity: 0;
  transform: scale(0.9);
}

.fav-last-leave-active {
  position: absolute;
  transition: opacity 0.33s ease-out, transform 0.33s ease-out;
  z-index: 0;
}

.fav-last-leave-to {
  opacity: 0;
  transform: scale(0.92);
}

.fav-last-move {
  transition: transform 0.55s cubic-bezier(0.25, 0.1, 0.25, 1);
}

/* === 空状态入场：下方浮入 + 缩放 + 弹性缓动 === */
.empty-fade-enter-active {
  transition: opacity 0.4s var(--ease-standard) 0.15s,
              transform 0.4s var(--ease-spring) 0.15s;
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
  animation: empty-star-arrive 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.3s both;
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
@media (max-width: 768px) {
  .favorites-scroll {
    padding: 16px;
  }

  .favorites-grid {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }
}

@media (max-width: 480px) {
  .favorites-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
  }
}
</style>
