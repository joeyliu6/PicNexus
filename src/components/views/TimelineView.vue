<script setup lang="ts">
/**
 * Timeline View (Google Photos style)
 * Groups photos by Month/Year and provides a timeline sidebar for navigation.
 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
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

const showSidebar = () => {
  isSidebarVisible.value = true;
};

const hideSidebarDebounced = () => {
  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollTimeout = window.setTimeout(() => {
    if (!isHoveringSidebar.value) {
      isSidebarVisible.value = false;
    }
  }, 1500);
};

const handleScroll = () => {
  showSidebar();
  hideSidebarDebounced();
};

const handleSidebarEnter = () => {
  isHoveringSidebar.value = true;
  showSidebar();
  if (scrollTimeout) clearTimeout(scrollTimeout);
};

const handleSidebarLeave = () => {
  isHoveringSidebar.value = false;
  hideSidebarDebounced();
};


// Grouping Logic
interface PhotoGroup {
  id: string; // '2023-10'
  label: string; // '2023年10月'
  year: number;
  month: number; // 0-11
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
    const id = `${year}-${month}`;
    
    if (!groupsMap.has(id)) {
      groupsMap.set(id, {
        id,
        label: `${year}年${month + 1}月`,
        year,
        month,
        date: new Date(year, month, 1),
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
    date: g.date,
    count: g.items.length
  }));
});

// Scroll to group
const handleScrollTo = (groupId: string) => {
  const el = document.getElementById(`group-${groupId}`);
  if (el && scrollContainer.value) {
    // Scroll with offset for header
    const top = el.offsetTop - 20; // 20px padding
    scrollContainer.value.scrollTo({ top, behavior: 'smooth' });
  }
};

// Initialization
onMounted(async () => {
  console.log('[TimelineView] Mounted');
  if (viewState.allHistoryItems.value.length === 0) {
    await viewState.loadHistory();
  }
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
    >
      <TimelineSidebar 
        :groups="sidebarGroups" 
        @scroll-to="handleScrollTo" 
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
  padding: 0 60px 0 20px; /* Right padding leaves space for sidebar */
  scroll-behavior: smooth;
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
  width: 50px;
  z-index: 10;
  background: linear-gradient(to left, var(--bg-app) 20%, transparent 100%);
  /* backdrop-filter could be added if supported and desired */
  pointer-events: none; /* Let clicks pass through transparent areas */
  opacity: 0;
  transition: opacity 0.3s ease;
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
</style>
