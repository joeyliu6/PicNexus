import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import TimelineView from '../../../components/views/TimelineView.vue';
import TimelinePhotoItem from '../../../components/views/timeline/TimelinePhotoItem.vue';
import type { ImageMeta } from '../../../types/image-meta';
import type { HistoryItem } from '../../../config/types';
import type { PhotoGroup } from '../../../composables/timeline/types';

const timelineFns = vi.hoisted(() => ({
  loadTimePeriodStats: vi.fn(),
  jumpToMonth: vi.fn(),
  handleSelectClick: vi.fn(),
  resetViewState: vi.fn(),
  clearSelection: vi.fn(),
  setFilter: vi.fn(),
  setSearchTerm: vi.fn(),
  bulkCopyFormatted: vi.fn(),
  bulkExport: vi.fn(),
  bulkDelete: vi.fn(),
  batchSetFavorite: vi.fn(),
  toggleFavorite: vi.fn(),
  trackScrollPosition: vi.fn(),
  virtualHandleScroll: vi.fn(),
  sidebarOnScroll: vi.fn(),
  openLightbox: vi.fn(),
  handleToggleFavorite: vi.fn(),
  handleImageHover: vi.fn(),
  onImageLoad: vi.fn(),
  onImageError: vi.fn(),
  handleLightboxNavigate: vi.fn(),
  handleLightboxDelete: vi.fn(),
}));

const timelineRefs = vi.hoisted(() => ({
  pagination: null as null | {
    groups: { value: PhotoGroup[] };
    dayStats: { value: Array<{ year: number; month: number; count: number; minTimestamp: number; maxTimestamp: number }> };
    loadedDayKeys: { value: Set<string> };
    totalCount: { value: number };
    isLoadingStats: { value: boolean };
    hasLoadedStats: { value: boolean };
    isFullyPreloaded: { value: boolean };
  },
  virtual: null as null | {
    totalHeight: { value: number };
    scrollTop: { value: number };
    scrollProgress: { value: number };
    isCalculating: { value: boolean };
    viewportHeight: { value: number };
    displayMode: { value: 'fast' | 'smooth' | 'normal' };
    scrollDirection: { value: 'up' | 'down' | null };
    visibleItems: { value: Array<{ meta: ImageMeta; x: number; y: number; width: number; height: number; groupId: string }> };
    visibleSkeletonSlots: { value: Array<{ key: string; x: number; y: number; width: number; height: number }> };
    visibleHeaders: { value: Array<{ groupId: string; label: string; y: number; height: number }> };
    fastModeItems: { value: Array<{ x: number; y: number; width: number; height: number }> };
    layoutResult: { value: { itemPositionMap: Map<string, unknown> } | null };
    visibleDayKeys: { value: Set<string> };
  },
  imageLoad: null as null | {
    loadedImages: { value: Set<string> };
    failedImages: { value: Set<string> };
  },
  viewState: null as null | {
    selectedIdList: { value: string[] };
    hasSelection: { value: boolean };
  },
  history: null as null | {
    favoriteSet: { value: Set<string> };
    isStatsLoaded: { value: boolean };
    totalCount: { value: number };
  },
  lightbox: null as null | {
    visible: { value: boolean };
    item: { value: HistoryItem | null };
    hasPrev: { value: boolean };
    hasNext: { value: boolean };
  },
}));

vi.mock('../../../composables/timeline/useTimelineDayPagination', async () => {
  const { ref } = await import('vue');
  timelineRefs.pagination = {
    groups: ref<PhotoGroup[]>([]),
    dayStats: ref([]),
    loadedDayKeys: ref(new Set<string>()),
    totalCount: ref(0),
    isLoadingStats: ref(false),
    hasLoadedStats: ref(true),
    isFullyPreloaded: ref(true),
  };
  return {
    useTimelineDayPagination: () => ({
      ...timelineRefs.pagination!,
      ensureDaysLoaded: vi.fn(),
      prefetchDayAspectRatios: vi.fn(),
      dayMetaCache: new Map(),
      findDayBefore: vi.fn(),
      findDayAfter: vi.fn(),
    }),
  };
});

vi.mock('../../../composables/useVirtualTimeline', async () => {
  const { ref } = await import('vue');
  timelineRefs.virtual = {
    totalHeight: ref(800),
    scrollTop: ref(0),
    scrollProgress: ref(0.25),
    isCalculating: ref(false),
    viewportHeight: ref(600),
    displayMode: ref<'fast' | 'smooth' | 'normal'>('normal'),
    scrollDirection: ref<'up' | 'down' | null>('down'),
    visibleItems: ref([]),
    visibleSkeletonSlots: ref([]),
    visibleHeaders: ref([]),
    fastModeItems: ref([]),
    layoutResult: ref({ itemPositionMap: new Map() }),
    visibleDayKeys: ref(new Set<string>()),
  };
  return {
    useVirtualTimeline: () => ({
      ...timelineRefs.virtual!,
      scrollToItem: vi.fn(),
      scrollToProgress: vi.fn(),
      forceUpdateVisibleArea: vi.fn(),
      forceNormalMode: vi.fn(),
      restoreScrollTop: vi.fn(),
      handleScroll: timelineFns.virtualHandleScroll,
    }),
  };
});

vi.mock('../../../composables/useImageLoadManager', async () => {
  const { ref } = await import('vue');
  timelineRefs.imageLoad = {
    loadedImages: ref(new Set<string>()),
    failedImages: ref(new Set<string>()),
  };
  return {
    useImageLoadManager: () => ({
      loadedImages: timelineRefs.imageLoad!.loadedImages,
      failedImages: timelineRefs.imageLoad!.failedImages,
      onImageLoad: timelineFns.onImageLoad,
      onImageError: timelineFns.onImageError,
      isImageLoaded: (id: string) => timelineRefs.imageLoad!.loadedImages.value.has(id),
      clearAll: vi.fn(),
    }),
  };
});

vi.mock('../../../composables/timeline/useScrollRestore', () => ({
  useScrollRestore: () => ({
    trackScrollPosition: timelineFns.trackScrollPosition,
    setLastStableProgress: vi.fn(),
  }),
}));

vi.mock('../../../composables/timeline/useTimelineData', async () => {
  const { ref } = await import('vue');
  return {
    useTimelineData: () => ({
      getThumbnailUrl: (meta: ImageMeta) => meta.primaryUrl,
      getThumbnailUrls: (meta: ImageMeta) => meta.mirrorServices?.map(service => service.url) ?? [meta.primaryUrl],
      selectedAvailableServices: ref([{ serviceId: 'jd', count: 1 }]),
      handleToggleFavorite: timelineFns.handleToggleFavorite,
      hoverDetailsMap: ref(new Map<string, HistoryItem>()),
      handleImageHover: timelineFns.handleImageHover,
    }),
  };
});

vi.mock('../../../composables/timeline/useTimelineLightbox', async () => {
  const { ref } = await import('vue');
  timelineRefs.lightbox = {
    visible: ref(false),
    item: ref<HistoryItem | null>(null),
    hasPrev: ref(false),
    hasNext: ref(false),
  };
  return {
    useTimelineLightbox: () => ({
      lightboxVisible: timelineRefs.lightbox!.visible,
      lightboxItem: timelineRefs.lightbox!.item,
      lightboxHasPrev: timelineRefs.lightbox!.hasPrev,
      lightboxHasNext: timelineRefs.lightbox!.hasNext,
      openLightbox: timelineFns.openLightbox,
      handleLightboxDelete: timelineFns.handleLightboxDelete,
      handleLightboxNavigate: timelineFns.handleLightboxNavigate,
    }),
  };
});

vi.mock('../../../composables/timeline/useTimelineDragAndSkeleton', async () => {
  const { ref } = await import('vue');
  return {
    useTimelineDragAndSkeleton: () => ({
      isJumping: ref(false),
      isFirstLoadSkeleton: ref(false),
      skeletonLayout: ref({ totalHeight: 320, groups: [], items: [] }),
      loadedMonthsSet: ref(new Set<string>()),
      monthLayoutPositions: ref(new Map<string, { start: number; end: number }>()),
      visibleRatio: ref(0.4),
      getIsDragging: () => false,
      handleSidebarWheel: vi.fn(),
      handleDragScroll: vi.fn(),
      handleJumpToPeriod: vi.fn(),
      handleJumpToYear: vi.fn(),
      cleanup: vi.fn(),
    }),
  };
});

vi.mock('../../../composables/useTimelineSidebarControl', async () => {
  const { ref } = await import('vue');
  return {
    useTimelineSidebarControl: () => ({
      isSidebarVisible: ref(true),
      onScroll: timelineFns.sidebarOnScroll,
      onSidebarEnter: vi.fn(),
      onSidebarLeave: vi.fn(),
      cleanup: vi.fn(),
    }),
  };
});

vi.mock('../../../composables/useHistoryViewState', async () => {
  const { computed, ref } = await import('vue');
  timelineRefs.viewState = {
    selectedIdList: ref<string[]>([]),
    hasSelection: ref(false),
  };
  return {
    useHistoryViewState: () => ({
      selectedIdList: computed(() => timelineRefs.viewState!.selectedIdList.value),
      hasSelection: computed(() => timelineRefs.viewState!.hasSelection.value),
      handleSelectClick: timelineFns.handleSelectClick,
      clearSelection: timelineFns.clearSelection,
      setFilter: timelineFns.setFilter,
      setSearchTerm: timelineFns.setSearchTerm,
      reset: timelineFns.resetViewState,
      bulkCopyFormatted: timelineFns.bulkCopyFormatted,
      bulkExport: timelineFns.bulkExport,
      bulkDelete: timelineFns.bulkDelete,
      deleteHistoryItem: vi.fn(),
      detailCache: { getDetail: vi.fn() },
    }),
  };
});

vi.mock('../../../composables/useHistory', async () => {
  const { ref } = await import('vue');
  timelineRefs.history = {
    favoriteSet: ref(new Set<string>()),
    isStatsLoaded: ref(false),
    totalCount: ref(0),
  };
  return {
    useHistoryManager: () => ({
      favoriteSet: timelineRefs.history!.favoriteSet,
      isStatsLoaded: timelineRefs.history!.isStatsLoaded,
      totalCount: timelineRefs.history!.totalCount,
      loadTimePeriodStats: timelineFns.loadTimePeriodStats,
      jumpToMonth: timelineFns.jumpToMonth,
      batchSetFavorite: timelineFns.batchSetFavorite,
    }),
  };
});

vi.mock('../../../composables/useConfig', async () => {
  const { ref } = await import('vue');
  return {
    useConfigManager: () => ({
      config: ref({
        linkOutput: { defaultFormat: 'url', customTemplate: '', autoCopy: false },
      }),
    }),
  };
});

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ error: vi.fn(), warn: vi.fn(), silent: vi.fn() }),
}));

vi.mock('../../../composables/timeline/useVisibleDayBuffer', () => ({
  useVisibleDayBuffer: () => ({ cleanup: vi.fn() }),
}));

vi.mock('../../../composables/timeline/useImagePreload', () => ({
  useImagePreload: () => ({ cleanup: vi.fn() }),
}));

vi.mock('../../../composables/timeline/useScrollAnchor', () => ({
  useScrollAnchor: () => ({ suspend: vi.fn(), resume: vi.fn() }),
}));

vi.mock('../../../composables/useDebouncedTrue', () => ({
  useDebouncedTrue: (source: { value: boolean }) => source,
}));

function meta(overrides: Partial<ImageMeta> = {}): ImageMeta {
  const id = overrides.id ?? 'time-1';
  return {
    id,
    timestamp: overrides.timestamp ?? 1_700_000_000_000,
    localFileName: overrides.localFileName ?? `${id}.jpg`,
    aspectRatio: overrides.aspectRatio ?? 1,
    primaryService: overrides.primaryService ?? 'jd',
    primaryUrl: overrides.primaryUrl ?? `https://img.example.com/${id}.jpg`,
    mirrorServices: overrides.mirrorServices,
    isFavorited: overrides.isFavorited,
  };
}

function group(items: ImageMeta[]): PhotoGroup {
  return {
    id: '2024-0-2',
    label: '2024-01-02',
    year: 2024,
    month: 0,
    day: 2,
    date: new Date('2024-01-02T00:00:00Z'),
    items,
  };
}

function mountTimelineView(props = {}) {
  return mountWithDefaults(TimelineView, {
    props: {
      filter: 'all',
      searchTerm: '',
      visible: true,
      activationTrigger: 1,
      ...props,
    },
    global: {
      stubs: {
        EmptyState: {
          props: ['title', 'description'],
          template: '<section class="empty-state-stub">{{ title }}{{ description }}</section>',
        },
        HistoryLightbox: {
          props: ['visible', 'item', 'hasPrev', 'hasNext'],
          emits: ['navigate', 'delete'],
          template: `
            <section class="lightbox-stub" :data-visible="visible" :data-prev="hasPrev" :data-next="hasNext">
              <button class="lightbox-prev" @click="$emit('navigate', 'prev')"></button>
              <button class="lightbox-next" @click="$emit('navigate', 'next')"></button>
              <button class="lightbox-delete" @click="$emit('delete', item)"></button>
            </section>
          `,
        },
        FloatingActionBar: {
          props: ['selectedCount', 'favoriteState'],
          emits: ['batch-favorite'],
          template: `
            <section
              class="floating-action-stub"
              :data-selected-count="selectedCount"
              :data-favorite-state="favoriteState"
            >
              <button class="fab-favorite" @click="$emit('batch-favorite', favoriteState === 'all' ? false : true)">favorite</button>
            </section>
          `,
        },
        TimelineIndicator: { template: '<section class="timeline-indicator-stub" />' },
      },
    },
  });
}

describe('TimelineView P1 coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    timelineRefs.pagination!.groups.value = [];
    timelineRefs.pagination!.dayStats.value = [];
    timelineRefs.pagination!.loadedDayKeys.value = new Set();
    timelineRefs.pagination!.totalCount.value = 0;
    timelineRefs.pagination!.isLoadingStats.value = false;
    timelineRefs.virtual!.visibleItems.value = [];
    timelineRefs.virtual!.visibleSkeletonSlots.value = [];
    timelineRefs.virtual!.visibleHeaders.value = [];
    timelineRefs.virtual!.fastModeItems.value = [];
    timelineRefs.virtual!.displayMode.value = 'normal';
    timelineRefs.imageLoad!.loadedImages.value = new Set();
    timelineRefs.imageLoad!.failedImages.value = new Set();
    timelineRefs.viewState!.selectedIdList.value = [];
    timelineRefs.viewState!.hasSelection.value = false;
    timelineRefs.history!.favoriteSet.value = new Set();
    timelineRefs.history!.isStatsLoaded.value = false;
    timelineRefs.history!.totalCount.value = 0;
    timelineRefs.lightbox!.visible.value = false;
    timelineRefs.lightbox!.item.value = null;
    timelineRefs.lightbox!.hasPrev.value = false;
    timelineRefs.lightbox!.hasNext.value = false;
  });

  it('loads time stats and renders the empty timeline state', () => {
    const wrapper = mountTimelineView({ favoritesOnly: true });

    expect(timelineFns.loadTimePeriodStats).toHaveBeenCalled();
    expect(wrapper.find('.empty-state-stub').exists()).toBe(true);
    expect(wrapper.emitted('update:totalCount')).toEqual([[0]]);
  });

  it('renders loaded grid items and wires scroll, select, favorite, hover, and image fallback events', async () => {
    const item = meta({ id: 'time-1', mirrorServices: [{ serviceId: 'jd', url: 'https://img.example.com/time-1.jpg' }] });
    timelineRefs.pagination!.groups.value = [group([item])];
    timelineRefs.pagination!.dayStats.value = [{ year: 2024, month: 0, count: 1, minTimestamp: 1, maxTimestamp: 2 }];
    timelineRefs.pagination!.totalCount.value = 1;
    timelineRefs.virtual!.visibleItems.value = [{ meta: item, x: 0, y: 36, width: 120, height: 90, groupId: '2024-0-2' }];
    timelineRefs.virtual!.visibleHeaders.value = [{ groupId: '2024-0-2', label: '2024-01-02', y: 0, height: 36 }];
    timelineRefs.imageLoad!.loadedImages.value = new Set(['time-1']);

    const wrapper = mountTimelineView();

    await wrapper.get('.timeline-scroll-area').trigger('scroll');
    await wrapper.get('.photo-wrapper').trigger('mouseenter');
    await wrapper.get('.photo-wrapper').trigger('click');
    await wrapper.get('.checkbox').trigger('click');
    await wrapper.get('.favorite-btn').trigger('click');
    await wrapper.get('img').trigger('error');

    expect(timelineFns.trackScrollPosition).toHaveBeenCalled();
    expect(timelineFns.virtualHandleScroll).toHaveBeenCalled();
    expect(timelineFns.sidebarOnScroll).toHaveBeenCalled();
    expect(timelineFns.openLightbox).toHaveBeenCalledWith(item);
    expect(timelineFns.handleSelectClick).toHaveBeenCalledWith('time-1', expect.any(MouseEvent), ['time-1']);
    expect(timelineFns.handleToggleFavorite).toHaveBeenCalledWith('time-1');
    expect(timelineFns.onImageError).toHaveBeenCalledWith(expect.any(Event), 'time-1');
  });

  it('shows skeleton instead of empty state while initial data is loading', () => {
    timelineRefs.history!.isStatsLoaded.value = true;
    timelineRefs.history!.totalCount.value = 1;
    timelineRefs.pagination!.isLoadingStats.value = true;
    timelineRefs.virtual!.visibleSkeletonSlots.value = [
      { key: 'slot-1', x: 0, y: 36, width: 120, height: 90 },
    ];

    const wrapper = mountTimelineView();

    expect(wrapper.find('.empty-state-stub').exists()).toBe(false);
    expect(wrapper.find('.timeline-skeleton-overlay').exists()).toBe(true);
    expect(wrapper.find('.photo-slot-skeleton').exists()).toBe(true);
  });

  it('renders empty state instead of skeleton when global stats confirm no history', () => {
    timelineRefs.history!.isStatsLoaded.value = true;
    timelineRefs.history!.totalCount.value = 0;
    timelineRefs.pagination!.isLoadingStats.value = true;

    const wrapper = mountTimelineView();

    expect(wrapper.find('.empty-state-stub').exists()).toBe(true);
    expect(wrapper.find('.timeline-skeleton-overlay').exists()).toBe(false);
  });

  it('passes lightbox state through and wires navigate/delete events', async () => {
    const lightboxItem = { id: 'lightbox-item' } as HistoryItem;
    timelineRefs.lightbox!.visible.value = true;
    timelineRefs.lightbox!.item.value = lightboxItem;
    timelineRefs.lightbox!.hasPrev.value = true;
    timelineRefs.lightbox!.hasNext.value = true;

    const wrapper = mountTimelineView();

    expect(wrapper.get('.lightbox-stub').attributes('data-visible')).toBe('true');
    expect(wrapper.get('.lightbox-stub').attributes('data-prev')).toBe('true');
    expect(wrapper.get('.lightbox-stub').attributes('data-next')).toBe('true');

    await wrapper.get('.lightbox-next').trigger('click');
    await wrapper.get('.lightbox-delete').trigger('click');

    expect(timelineFns.handleLightboxNavigate).toHaveBeenCalledWith('next');
    expect(timelineFns.handleLightboxDelete).toHaveBeenCalledWith(lightboxItem);
  });

  it('clears timeline selection on filter/search changes and passes favorite state to batch actions', async () => {
    const item = meta({ id: 'time-1' });
    timelineRefs.pagination!.groups.value = [group([item])];
    timelineRefs.viewState!.selectedIdList.value = ['time-1'];
    timelineRefs.viewState!.hasSelection.value = true;
    timelineRefs.history!.favoriteSet.value = new Set(['time-1']);

    const wrapper = mountTimelineView();

    expect(wrapper.get('.floating-action-stub').attributes('data-favorite-state')).toBe('all');

    await wrapper.get('.fab-favorite').trigger('click');
    expect(timelineFns.batchSetFavorite).toHaveBeenCalledWith(['time-1'], false);

    await wrapper.setProps({ filter: 'r2', searchTerm: 'cat' });
    expect(timelineFns.setFilter).toHaveBeenCalledWith('r2');
    expect(timelineFns.setSearchTerm).toHaveBeenCalledWith('cat');
  });
});

describe('TimelinePhotoItem fallback and interaction states', () => {
  const item = meta({ id: 'photo-item' });

  it('tries fallback thumbnails before emitting image-error', async () => {
    const wrapper = mountWithDefaults(TimelinePhotoItem, {
      props: {
        meta: item,
        x: 1,
        y: 2,
        width: 120,
        height: 90,
        isSelected: false,
        isFavorited: false,
        isLoaded: false,
        isFailed: false,
        hasSelection: false,
        displayMode: 'normal',
        thumbnailUrls: ['https://primary.example.com/a.jpg', 'https://mirror.example.com/a.jpg'],
      },
    });

    expect(wrapper.get('img').attributes('src')).toBe('https://primary.example.com/a.jpg');

    await wrapper.get('img').trigger('error');
    await nextTick();

    expect(wrapper.get('img').attributes('src')).toBe('https://mirror.example.com/a.jpg');
    expect(wrapper.emitted('image-error')).toBeUndefined();

    await wrapper.get('img').trigger('error');

    expect(wrapper.emitted('image-error')).toHaveLength(1);
  });

  it('does not restart fallback when parent re-renders with equal thumbnail URLs', async () => {
    const wrapper = mountWithDefaults(TimelinePhotoItem, {
      props: {
        meta: item,
        x: 1,
        y: 2,
        width: 120,
        height: 90,
        isSelected: false,
        isFavorited: false,
        isLoaded: false,
        isFailed: false,
        hasSelection: false,
        displayMode: 'normal',
        thumbnailUrls: ['https://primary.example.com/a.jpg', 'https://mirror.example.com/a.jpg'],
      },
    });

    await wrapper.get('img').trigger('error');
    await nextTick();
    expect(wrapper.get('img').attributes('src')).toBe('https://mirror.example.com/a.jpg');

    await wrapper.setProps({
      thumbnailUrls: ['https://primary.example.com/a.jpg', 'https://mirror.example.com/a.jpg'],
      isLoaded: true,
    });

    expect(wrapper.get('img').attributes('src')).toBe('https://mirror.example.com/a.jpg');
  });

  it('uses selection mode clicks and exposes the magnifier lightbox path', async () => {
    const wrapper = mountWithDefaults(TimelinePhotoItem, {
      props: {
        meta: item,
        x: 0,
        y: 0,
        width: 120,
        height: 90,
        isSelected: true,
        isFavorited: true,
        isLoaded: true,
        isFailed: false,
        hasSelection: true,
        displayMode: 'normal',
        thumbnailUrls: ['https://primary.example.com/a.jpg'],
      },
    });

    await wrapper.get('.photo-wrapper').trigger('click');
    await wrapper.get('.magnifier-btn').trigger('click');
    await wrapper.get('.favorite-btn').trigger('click');
    await wrapper.get('img').trigger('load');

    expect(wrapper.emitted('toggle-select')).toHaveLength(1);
    expect(wrapper.emitted('click')).toHaveLength(1);
    expect(wrapper.emitted('toggle-favorite')).toHaveLength(1);
    expect(wrapper.emitted('image-load')).toHaveLength(1);
    expect(wrapper.get('.photo-item').classes()).toContain('selected');
  });
});
