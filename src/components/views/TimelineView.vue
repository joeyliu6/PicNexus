<script setup lang="ts">
/**
 * Timeline View (Google Photos style)
 * Groups photos by Month/Year and provides a timeline sidebar for navigation.
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useHistoryViewState, type LinkFormat } from '../../composables/useHistoryViewState';
import { useThumbCache } from '../../composables/useThumbCache';
import { useToast } from '../../composables/useToast';
import type { HistoryItem, ServiceType } from '../../config/types';
import TimelineSidebar, { type TimeGroup } from './timeline/TimelineSidebar.vue';
import HistoryLightbox from './history/HistoryLightbox.vue';
import FloatingActionBar from './history/FloatingActionBar.vue';
import Skeleton from 'primevue/skeleton';

// Props
const props = defineProps<{
  filter?: ServiceType | 'all';
  searchTerm?: string;
}>();

// Emits
const emit = defineEmits<{
  (e: 'update:totalCount', count: number): void;
  (e: 'update:selectedCount', count: number): void;
}>();

const toast = useToast();
const viewState = useHistoryViewState();
const thumbCache = useThumbCache();

// Lightbox state
const lightboxVisible = ref(false);
const lightboxItem = ref<HistoryItem | null>(null);

// Scroll container ref
const scrollContainer = ref<HTMLElement | null>(null);

// Sidebar Visibility Logic
const isSidebarVisible = ref(false);
let scrollTimeout: number | undefined;
let isHoveringSidebar = ref(false);

// 触发来源：hover 用 0.5s 隐藏，scroll 用 1.5s 隐藏
type ShowSource = 'scroll' | 'hover';
let lastShowSource: ShowSource = 'scroll';

// 滚动进度追踪
const scrollProgress = ref(0);
const visibleRatio = ref(1);

// 拖动状态跟踪（拖动时跳过滚动事件处理）
let isDragging = false;

// 滚动节流
let scrollThrottleTimer: number | undefined;
const SCROLL_THROTTLE_MS = 16; // ~60fps

const showSidebar = () => {
  isSidebarVisible.value = true;
};

const hideSidebarDebounced = () => {
  if (scrollTimeout) clearTimeout(scrollTimeout);
  // 根据触发来源决定延迟时间：hover 离开 0.3s，滚动结束 1s
  const delay = lastShowSource === 'hover' ? 300 : 1000;
  scrollTimeout = window.setTimeout(() => {
    if (!isHoveringSidebar.value) {
      isSidebarVisible.value = false;
    }
  }, delay);
};

// 更新滚动进度
const updateScrollProgress = () => {
  if (!scrollContainer.value) return;
  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value;
  const maxScroll = scrollHeight - clientHeight;
  scrollProgress.value = maxScroll > 0 ? scrollTop / maxScroll : 0;
  visibleRatio.value = scrollHeight > 0 ? clientHeight / scrollHeight : 1;
};

// 无限滚动：检测是否需要加载更多
const SCROLL_THRESHOLD = 300; // 距底部 300px 触发
const checkLoadMore = () => {
  if (!scrollContainer.value) return;
  if (!viewState.hasMore.value || viewState.isLoadingMore.value) return;

  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value;
  const distanceToBottom = scrollHeight - scrollTop - clientHeight;

  if (distanceToBottom < SCROLL_THRESHOLD) {
    viewState.loadMore();
  }
};

const handleScroll = () => {
  // 拖动期间跳过滚动事件处理，避免循环更新
  if (isDragging) return;

  // 滚动节流
  if (scrollThrottleTimer) return;
  scrollThrottleTimer = window.setTimeout(() => {
    scrollThrottleTimer = undefined;
  }, SCROLL_THROTTLE_MS);

  lastShowSource = 'scroll';
  showSidebar();
  hideSidebarDebounced();
  updateScrollProgress();

  // 无限滚动检测
  checkLoadMore();
};

const handleSidebarEnter = () => {
  lastShowSource = 'hover';
  isHoveringSidebar.value = true;
  showSidebar();
  if (scrollTimeout) clearTimeout(scrollTimeout);
};

const handleSidebarLeave = () => {
  isHoveringSidebar.value = false;
  hideSidebarDebounced();
};

// 滚动穿透：在时间轴上滚动时转发到主内容区域
const handleSidebarWheel = (e: WheelEvent) => {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop += e.deltaY;
  }
};

// 处理拖拽滚动
let dragEndTimer: number | undefined;
const handleDragScroll = (progress: number) => {
  if (!scrollContainer.value) return;

  // 设置拖动状态，避免滚动事件循环
  isDragging = true;

  // 重置拖动结束定时器（拖动结束 100ms 后恢复）
  if (dragEndTimer) clearTimeout(dragEndTimer);
  dragEndTimer = window.setTimeout(() => {
    isDragging = false;
  }, 100);

  const { scrollHeight, clientHeight } = scrollContainer.value;
  const maxScroll = scrollHeight - clientHeight;

  // 直接设置滚动位置，不用 requestAnimationFrame（减少延迟）
  scrollContainer.value.scrollTop = maxScroll * progress;

  // 手动更新进度（因为跳过了滚动事件）
  scrollProgress.value = progress;
};


// Grouping Logic - 按天分组
interface PhotoGroup {
  id: string; // '2024-5-15'
  label: string; // '2024年5月15日'
  year: number;
  month: number; // 0-11
  day: number;
  date: Date;
  items: HistoryItem[];
}

const groups = computed(() => {
  const items = viewState.filteredItems.value;
  const groupsMap = new Map<string, PhotoGroup>();

  items.forEach(item => {
    const date = new Date(item.timestamp);
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    const id = `${year}-${month}-${day}`;

    if (!groupsMap.has(id)) {
      groupsMap.set(id, {
        id,
        label: `${year}年${month + 1}月${day}日`,
        year,
        month,
        day,
        date: new Date(year, month, day),
        items: []
      });
    }
    groupsMap.get(id)?.items.push(item);
  });

  // Sort groups by date descending (newest first)
  return Array.from(groupsMap.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
});

// Sidebar data
const sidebarGroups = computed<TimeGroup[]>(() => {
  return groups.value.map(g => ({
    id: g.id,
    label: g.month + 1 + '月', // Short label for sidebar
    year: g.year,
    month: g.month,
    day: g.day,
    date: g.date,
    count: g.items.length
  }));
});

// 当前月份标签（用于滑块显示）
const currentMonthLabel = computed(() => {
  if (groups.value.length === 0) return '';
  const index = Math.floor(scrollProgress.value * (groups.value.length - 1));
  const group = groups.value[Math.min(index, groups.value.length - 1)];
  return `${group.month + 1}月`;
});

// Initialization
onMounted(async () => {
  console.log('[TimelineView] Mounted');
  await viewState.loadHistory();
});

onUnmounted(() => {
  viewState.reset();
  thumbCache.clearThumbCache();
});

// Watchers for props to update internal viewState
watch(() => props.filter, (val) => {
  if (val) viewState.setFilter(val);
}, { immediate: true });

watch(() => props.searchTerm, (val) => {
  if (val !== undefined) viewState.setSearchTerm(val);
}, { immediate: true });

// Sync stats
watch(() => viewState.totalCount.value, (c) => emit('update:totalCount', c), { immediate: true });
watch(() => viewState.selectedIdList.value.length, (c) => emit('update:selectedCount', c), { immediate: true });

// Lightbox & Actions
const openLightbox = (item: HistoryItem) => {
  lightboxItem.value = item;
  lightboxVisible.value = true;
};

const handleLightboxDelete = async (item: HistoryItem) => {
  try {
    await viewState.deleteHistoryItem(item.id);
    lightboxVisible.value = false;
    toast.success('Deleted');
  } catch (e) {
    toast.error('Failed to delete', String(e));
  }
};

// Batch Actions
const handleBulkCopy = (fmt: LinkFormat) => viewState.bulkCopyFormatted(fmt);
const handleBulkExport = () => viewState.bulkExport();
const handleBulkDelete = () => viewState.bulkDelete();

</script>

<template>
  <div class="timeline-view">
    <!-- Main Scroll Area -->
    <div 
      class="timeline-scroll-area" 
      ref="scrollContainer"
      @scroll="handleScroll"
    >
      <div v-if="viewState.isLoading.value" class="loading-state">
        <Skeleton width="100%" height="200px" class="mb-4" />
        <Skeleton width="100%" height="400px" />
      </div>

      <div v-else-if="groups.length === 0" class="empty-state">
        <i class="pi pi-image" style="font-size: 3rem; opacity: 0.5;"></i>
        <p>No photos found</p>
      </div>

      <div v-else class="groups-container">
        <div
          v-for="group in groups"
          :key="group.id"
          :id="`group-${group.id}`"
          class="photo-group"
        >
          <!-- Sticky Header -->
          <div class="group-header">
            <span class="group-title">{{ group.label }}</span>
            <span class="group-subtitle">{{ group.items.length }} 张照片</span>
          </div>

          <!-- Photo Grid -->
          <div class="photo-grid">
            <div
              v-for="item in group.items"
              :key="item.id"
              class="photo-item"
              :class="{ selected: viewState.isSelected(item.id) }"
            >
              <div class="photo-wrapper" @click="openLightbox(item)">
                <img
                  v-if="thumbCache.getThumbUrl(item)"
                  :src="thumbCache.getThumbUrl(item)"
                  loading="lazy"
                  class="photo-img"
                  @error="(e: any) => e.target.src = '/placeholder.png'"
                />
                 <Skeleton v-else width="100%" height="100%" />

                <!-- Selection Overlay -->
                <div class="selection-overlay"></div>

                <!-- Checkbox -->
                <div
                  class="checkbox"
                  :class="{ checked: viewState.isSelected(item.id) }"
                  @click.stop="viewState.toggleSelection(item.id)"
                >
                  <i v-if="viewState.isSelected(item.id)" class="pi pi-check"></i>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 加载更多指示器 -->
        <div v-if="viewState.isLoadingMore.value" class="loading-more">
          <i class="pi pi-spin pi-spinner"></i>
          <span>加载中...</span>
        </div>

        <!-- 已加载全部提示 -->
        <div v-else-if="!viewState.hasMore.value && groups.length > 0" class="all-loaded">
          已加载全部 {{ viewState.totalCount.value }} 张照片
        </div>
      </div>
      
      <!-- Bottom spacing -->
      <div style="height: 100px;"></div>
    </div>

    <!-- Right Sidebar -->
    <div
      class="sidebar-wrapper"
      :class="{ visible: isSidebarVisible }"
      @mouseenter="handleSidebarEnter"
      @mouseleave="handleSidebarLeave"
      @wheel.prevent="handleSidebarWheel"
    >
      <TimelineSidebar
        :groups="sidebarGroups"
        :scroll-progress="scrollProgress"
        :visible-ratio="visibleRatio"
        :current-month-label="currentMonthLabel"
        @drag-scroll="handleDragScroll"
      />
    </div>

    <!-- Components -->
    <HistoryLightbox
      v-model:visible="lightboxVisible"
      :item="lightboxItem"
      @delete="handleLightboxDelete"
    />

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
.timeline-view {
  position: relative;
  height: 100%;
  display: flex;
  background: var(--bg-app);
  overflow: hidden;
}

.timeline-scroll-area {
  flex: 1;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 70px 0 20px; /* 右侧留出空间给 sidebar */
  /* 移除 scroll-behavior: smooth，避免拖动时卡顿 */
}

/* 隐藏滚动条但保持可滚动功能 */
.timeline-scroll-area {
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
}
.timeline-scroll-area::-webkit-scrollbar {
  display: none; /* Chrome/Safari/Opera */
}

.sidebar-wrapper {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 120px; /* 扩大以容纳月份标签 */
  z-index: 20;
  background: linear-gradient(to left, var(--bg-app) 40%, transparent 100%);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease;
  overflow: visible; /* 允许指示器溢出 */
}

.sidebar-wrapper.visible {
  opacity: 1;
  pointer-events: auto; /* Enable interaction when visible */
}

/* Enable pointer events on proper sidebar content */
.sidebar-wrapper > * {
  pointer-events: auto;
}

.groups-container {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding-top: 20px;
}

.photo-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.group-header {
  position: sticky;
  top: 0;
  z-index: 5;
  background: rgba(var(--bg-app-rgb), 0.85); /* Need RGB variable or fallback */
  background: var(--bg-app); /* Fallback */
  backdrop-filter: blur(10px);
  padding: 10px 0;
  display: flex;
  align-items: baseline;
  gap: 12px;
}
/* Ensure the sticky header has background to cover scrolling items */
/* Hack to use var with opacity if not defined as RGB: use simple opaque color */

.group-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.group-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}

.photo-item {
  aspect-ratio: 1;
  background: var(--bg-secondary);
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  transition: transform 0.1s;
}

.photo-wrapper {
  width: 100%;
  height: 100%;
  cursor: pointer;
  position: relative;
}

.photo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s;
}

.photo-wrapper:hover .photo-img {
  transform: scale(1.05);
}

.selection-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.1);
  opacity: 0;
  transition: opacity 0.2s;
}

.photo-item.selected .selection-overlay {
  opacity: 1;
  background: rgba(59, 130, 246, 0.2);
  border: 2px solid var(--primary);
  border-radius: 8px;
}

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
  transition: all 0.2s;
  z-index: 2;
}

.photo-wrapper:hover .checkbox,
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

/* Loading/Empty states */
.loading-state, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  height: 100%;
  color: var(--text-secondary);
}

.mb-4 { margin-bottom: 1rem; }

/* 无限滚动状态 */
.loading-more,
.all-loaded {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: var(--text-secondary);
  font-size: 14px;
}

.loading-more i {
  font-size: 16px;
}
</style>
