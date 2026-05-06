import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, defineComponent, ref, shallowRef } from 'vue';
import { mountWithDefaults } from '../../../helpers/vueMount';
import { flushPromisesAndTicks } from '../../../helpers/wait';
import { resetTauriMocks } from '../../../helpers/tauriMock';
import { historyRows } from '../../../fixtures/historyRows';
import { createHistoryItem, createHistoryResult } from '../../../factories/historyFactory';
import HistoryView from '../../../../components/views/HistoryView.vue';
import HistoryTableView from '../../../../components/views/history/HistoryTableView.vue';

const mockState = vi.hoisted(() => ({
  loadStats: vi.fn(),
  batchSetFavorite: vi.fn(),
  bulkCopyFormatted: vi.fn(),
  bulkExport: vi.fn(),
  bulkDelete: vi.fn(),
  clearSelection: vi.fn(),
  handleSelectClick: vi.fn(),
  handleHeaderCheckboxChange: vi.fn(),
  openLightbox: vi.fn(),
  handleCopyServiceLink: vi.fn(),
  handleLightboxDelete: vi.fn(),
  handleLightboxNavigate: vi.fn(),
  handleToggleFavorite: vi.fn(),
  historyManager: undefined as any,
  viewState: undefined as any,
  tableState: undefined as any,
  interactions: undefined as any,
  visibleServiceCount: 4,
}));

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), silent: vi.fn() }),
}));

vi.mock('../../../../composables/useConfig', () => ({
  useConfigManager: () => ({
    config: ref({}),
    getActivePrefix: vi.fn(),
  }),
}));

vi.mock('../../../../composables/useHistory', () => ({
  useHistoryManager: () => mockState.historyManager,
}));

vi.mock('../../../../composables/useHistoryViewState', () => ({
  useHistoryViewState: () => mockState.viewState,
}));

vi.mock('../../../../composables/history/useHistoryBadgeLayout', () => ({
  useHistoryBadgeLayout: () => ({
    setupBadgeWidthObserver: vi.fn(),
    getVisibleCount: () => mockState.visibleServiceCount,
    getVisibleServices: (services: string[]) => services.slice(0, mockState.visibleServiceCount),
    getOverflowServices: (services: string[]) => services.slice(mockState.visibleServiceCount),
    getCachedServices: (item: any) => item.results
      .filter((result: any) => result.status === 'success')
      .map((result: any) => result.serviceId),
  }),
}));

vi.mock('../../../../composables/useThumbCache', () => ({
  getThumbnailCandidates: (item: any) => [item.generatedLink],
}));

vi.mock('../../../../composables/history/useHistoryTableData', () => ({
  isSkeleton: (data: any) => data?._skeleton === true,
  useHistoryTableData: () => mockState.tableState,
}));

vi.mock('../../../../composables/history/useTableInteractions', () => ({
  useTableInteractions: () => mockState.interactions,
}));

const DashboardStripStub = defineComponent({
  name: 'DashboardStrip',
  props: ['viewMode', 'filter', 'totalCount', 'serviceCounts'],
  emits: ['update:viewMode', 'update:filter', 'update:searchTerm'],
  template: `
    <section data-testid="dashboard" :data-mode="viewMode" :data-filter="filter" :data-total="totalCount">
      <button class="search-cats" @click="$emit('update:searchTerm', 'cats')">search</button>
      <button class="filter-r2" @click="$emit('update:filter', 'r2')">filter</button>
      <button class="show-timeline" @click="$emit('update:viewMode', 'timeline')">timeline</button>
      <button class="show-favorites" @click="$emit('update:viewMode', 'favorites')">favorites</button>
    </section>
  `,
});

const HistoryTableViewStub = defineComponent({
  name: 'HistoryTableView',
  props: ['visible', 'filter', 'searchTerm'],
  emits: ['update:totalCount'],
  template: `
    <section data-testid="table-view" :data-visible="String(visible)" :data-filter="filter" :data-search="searchTerm">
      <button class="emit-total" @click="$emit('update:totalCount', 42)">total</button>
    </section>
  `,
});

const TimelineViewStub = defineComponent({
  name: 'TimelineView',
  props: ['visible', 'filter', 'searchTerm'],
  emits: ['update:totalCount'],
  template: '<section data-testid="timeline-view" :data-visible="String(visible)" :data-filter="filter" :data-search="searchTerm" />',
});

const FavoritesViewStub = defineComponent({
  name: 'FavoritesView',
  props: ['visible', 'filter', 'searchTerm'],
  emits: ['update:totalCount'],
  template: '<section data-testid="favorites-view" :data-visible="String(visible)" :data-filter="filter" :data-search="searchTerm" />',
});

const CheckboxStub = defineComponent({
  name: 'Checkbox',
  props: ['modelValue', 'indeterminate'],
  emits: ['update:modelValue'],
  template: `
    <button
      class="checkbox-stub"
      :data-checked="String(modelValue)"
      :data-indeterminate="String(!!indeterminate)"
      @click="$emit('update:modelValue', !modelValue)"
    />
  `,
});

const SkeletonStub = defineComponent({
  name: 'Skeleton',
  template: '<span class="skeleton-stub" />',
});

const PopoverStub = defineComponent({
  name: 'Popover',
  expose: ['toggle'],
  methods: {
    toggle: vi.fn(),
  },
  template: '<section data-testid="service-popover"><slot /></section>',
});

const EmptyStateStub = defineComponent({
  name: 'EmptyState',
  props: ['icon', 'title', 'description'],
  template: '<section data-testid="empty-state" :data-icon="icon" :data-title="title">{{ title }}</section>',
});

const ThumbnailImageStub = defineComponent({
  name: 'ThumbnailImage',
  props: ['srcs', 'alt', 'imageClass'],
  template: '<img class="thumb-img-stub" :alt="alt" :src="srcs?.[0] || \'\'" />',
});

const HistoryLightboxStub = defineComponent({
  name: 'HistoryLightbox',
  props: ['visible', 'item', 'hasPrev', 'hasNext'],
  emits: ['update:visible', 'delete', 'navigate', 'toggleFavorite'],
  template: `
    <section v-if="visible" data-testid="history-lightbox">
      <span class="lightbox-name">{{ item?.localFileName }}</span>
      <button class="lightbox-delete" @click="$emit('delete', item)">delete</button>
      <button class="lightbox-next" @click="$emit('navigate', 'next')">next</button>
    </section>
  `,
});

const FloatingActionBarStub = defineComponent({
  name: 'FloatingActionBar',
  props: ['selectedCount', 'visible', 'availableServices', 'favoriteState'],
  emits: ['copy', 'export', 'delete', 'clearSelection', 'batchFavorite'],
  template: `
    <section v-if="visible" data-testid="floating-actions" :data-selected-count="selectedCount" :data-favorite-state="favoriteState">
      <button class="fab-copy" @click="$emit('copy', 'markdown')">copy</button>
      <button class="fab-copy-service" @click="$emit('copy', 'url', 'jd')">copy service</button>
      <button class="fab-export" @click="$emit('export')">export</button>
      <button class="fab-delete" @click="$emit('delete')">delete</button>
      <button class="fab-clear" @click="$emit('clearSelection')">clear</button>
      <button class="fab-favorite" @click="$emit('batchFavorite', true)">favorite</button>
      <button class="fab-unfavorite" @click="$emit('batchFavorite', false)">unfavorite</button>
    </section>
  `,
});

function makeViewState(selected: string[] = []) {
  const selectedIds = shallowRef(new Set(selected));
  const selectedIdList = computed(() => Array.from(selectedIds.value));
  const hasSelection = computed(() => selectedIds.value.size > 0);

  function update(next: Set<string>) {
    selectedIds.value = next;
  }

  const viewState = {
    selectedIds,
    hasSelection,
    selectedIdList,
    isSelected: (id: string) => selectedIds.value.has(id),
    select: vi.fn((id: string) => update(new Set([...selectedIds.value, id]))),
    deselect: vi.fn((id: string) => {
      const next = new Set(selectedIds.value);
      next.delete(id);
      update(next);
    }),
    clearSelection: mockState.clearSelection.mockImplementation(() => update(new Set())),
    handleSelectClick: mockState.handleSelectClick.mockImplementation((id: string) => {
      const next = new Set(selectedIds.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      update(next);
    }),
    bulkCopyFormatted: mockState.bulkCopyFormatted,
    bulkExport: mockState.bulkExport,
    bulkDelete: mockState.bulkDelete.mockImplementation(async () => update(new Set())),
    reset: vi.fn(() => update(new Set())),
    deleteHistoryItem: vi.fn(),
  };

  return viewState;
}

function makeTableState(rows = historyRows) {
  const currentPageData = ref(rows);
  const totalRecords = ref(rows.length);
  const isLoadingPage = ref(false);
  const hasLoadedPage = ref(true);
  const selectAll = ref(false);

  return {
    currentPageData,
    currentPage: ref(1),
    pageSize: ref(50),
    totalRecords,
    totalPages: computed(() => Math.max(1, Math.ceil(totalRecords.value / 50))),
    isLoadingPage,
    hasLoadedPage,
    first: ref(0),
    selectAll,
    skeletonData: computed(() => Array.from({ length: 3 }, (_, index) => ({ id: `skeleton-${index}`, _skeleton: true }))),
    formatTime: () => '2024-01-01 10:00',
    onPageChange: vi.fn(),
    goToPage: vi.fn(),
    peekPage: vi.fn(),
    handleHeaderCheckboxChange: mockState.handleHeaderCheckboxChange.mockImplementation((checked: boolean) => {
      selectAll.value = checked;
      rows.forEach((row) => checked ? mockState.viewState.select(row.id) : mockState.viewState.deselect(row.id));
    }),
    getSuccessfulServices: (item: any) => item.results
      .filter((result: any) => result.status === 'success')
      .map((result: any) => result.serviceId),
    selectedAvailableServices: computed(() => [{ serviceId: 'jd', count: 1 }]),
  };
}

function makeInteractions() {
  const lightboxVisible = ref(false);
  const lightboxItem = ref<any>(null);

  return {
    lightboxVisible,
    lightboxItem,
    lightboxHasPrev: ref(false),
    lightboxHasNext: ref(true),
    openLightbox: mockState.openLightbox.mockImplementation((item: any) => {
      lightboxItem.value = item;
      lightboxVisible.value = true;
    }),
    handleLightboxDelete: mockState.handleLightboxDelete,
    handleLightboxNavigate: mockState.handleLightboxNavigate,
    handleToggleFavorite: mockState.handleToggleFavorite,
    resolveLightboxCloseTargetMode: vi.fn(() => 'fade'),
    popoverServices: ref(['jd']),
    openServicePopover: vi.fn(),
    handlePopoverCopyLink: vi.fn(),
    handleCopyServiceLink: mockState.handleCopyServiceLink,
    copiedServiceKey: ref(''),
    getServiceCopyKey: (historyId: string, serviceId: string) => `${historyId}:${serviceId}`,
    isPopoverServiceCopied: vi.fn(() => false),
    hoverPreview: ref({ visible: false, closing: false, url: '', alt: '', itemId: '', style: {} }),
    handlePreviewEnter: vi.fn(),
    handlePreviewLeave: vi.fn(),
  };
}

function mountHistoryTable(props = {}) {
  return mountWithDefaults(HistoryTableView, {
    props: {
      filter: 'all',
      searchTerm: '',
      visible: true,
      ...props,
    },
    global: {
      mocks: {
        $primevue: {
          config: {
            locale: {
              aria: {
                firstPageLabel: 'first',
                prevPageLabel: 'previous',
                nextPageLabel: 'next',
                lastPageLabel: 'last',
                pageLabel: 'page',
              },
            },
          },
        },
      },
      stubs: {
        Checkbox: CheckboxStub,
        Skeleton: SkeletonStub,
        Popover: PopoverStub,
        EmptyState: EmptyStateStub,
        ThumbnailImage: ThumbnailImageStub,
        HistoryLightbox: HistoryLightboxStub,
        FloatingActionBar: FloatingActionBarStub,
      },
    },
  });
}

beforeEach(() => {
  resetTauriMocks();
  vi.clearAllMocks();

  mockState.historyManager = {
    totalCount: ref(historyRows.length),
    serviceCounts: ref({ jd: 2, r2: 1 }),
    favoriteSet: ref(new Set<string>()),
    isStatsLoaded: ref(true),
    loadStats: mockState.loadStats.mockResolvedValue(undefined),
    batchSetFavorite: mockState.batchSetFavorite.mockResolvedValue(undefined),
  };
  mockState.viewState = makeViewState();
  mockState.tableState = makeTableState();
  mockState.interactions = makeInteractions();
  mockState.visibleServiceCount = 4;
});

describe('HistoryView page shell', () => {
  it('does not mount child views while stats bootstrap is still pending', async () => {
    const statsLoad = createDeferred();
    mockState.historyManager.isStatsLoaded.value = false;
    mockState.historyManager.totalCount.value = 0;
    mockState.loadStats.mockReturnValueOnce(statsLoad.promise);

    const wrapper = mountWithDefaults(HistoryView, {
      global: {
        stubs: {
          DashboardStrip: DashboardStripStub,
          HistoryTableView: HistoryTableViewStub,
          TimelineView: TimelineViewStub,
          FavoritesView: FavoritesViewStub,
          EmptyState: EmptyStateStub,
        },
      },
    });

    expect(wrapper.find('[data-testid="table-view"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="timeline-view"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="favorites-view"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(false);
    expect(mockState.loadStats).toHaveBeenCalledTimes(1);

    mockState.historyManager.isStatsLoaded.value = true;
    mockState.historyManager.totalCount.value = historyRows.length;
    statsLoad.resolve();
    await flushPromisesAndTicks(1);

    expect(wrapper.get('[data-testid="table-view"]').attributes('data-visible')).toBe('true');
  });

  it('renders the parent empty state and skips child views when stats confirm no history', async () => {
    const statsLoad = createDeferred();
    mockState.historyManager.isStatsLoaded.value = false;
    mockState.historyManager.totalCount.value = 0;
    mockState.loadStats.mockReturnValueOnce(statsLoad.promise);

    const wrapper = mountWithDefaults(HistoryView, {
      global: {
        stubs: {
          DashboardStrip: DashboardStripStub,
          HistoryTableView: HistoryTableViewStub,
          TimelineView: TimelineViewStub,
          FavoritesView: FavoritesViewStub,
          EmptyState: EmptyStateStub,
        },
      },
    });

    mockState.historyManager.isStatsLoaded.value = true;
    mockState.historyManager.totalCount.value = 0;
    statsLoad.resolve();
    await flushPromisesAndTicks(1);

    expect(wrapper.get('[data-testid="empty-state"]').attributes('data-title')).toBe('暂无上传记录');
    expect(wrapper.find('[data-testid="table-view"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="timeline-view"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="favorites-view"]').exists()).toBe(false);

    await wrapper.get('.show-favorites').trigger('click');
    expect(wrapper.get('[data-testid="empty-state"]').attributes('data-title')).toBe('暂无收藏');
    expect(wrapper.find('[data-testid="favorites-view"]').exists()).toBe(false);
  });

  it('mounts the active child view when stats confirm existing history', async () => {
    const statsLoad = createDeferred();
    mockState.historyManager.isStatsLoaded.value = false;
    mockState.historyManager.totalCount.value = 0;
    mockState.loadStats.mockReturnValueOnce(statsLoad.promise);

    const wrapper = mountWithDefaults(HistoryView, {
      global: {
        stubs: {
          DashboardStrip: DashboardStripStub,
          HistoryTableView: HistoryTableViewStub,
          TimelineView: TimelineViewStub,
          FavoritesView: FavoritesViewStub,
          EmptyState: EmptyStateStub,
        },
      },
    });

    mockState.historyManager.isStatsLoaded.value = true;
    mockState.historyManager.totalCount.value = historyRows.length;
    statsLoad.resolve();
    await flushPromisesAndTicks(1);

    expect(wrapper.get('[data-testid="table-view"]').attributes('data-visible')).toBe('true');
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(false);
  });

  it('falls back to mounting child views when stats bootstrap fails', async () => {
    mockState.historyManager.isStatsLoaded.value = false;
    mockState.historyManager.totalCount.value = 0;
    mockState.loadStats.mockRejectedValueOnce(new Error('stats failed'));

    const wrapper = mountWithDefaults(HistoryView, {
      global: {
        stubs: {
          DashboardStrip: DashboardStripStub,
          HistoryTableView: HistoryTableViewStub,
          TimelineView: TimelineViewStub,
          FavoritesView: FavoritesViewStub,
          EmptyState: EmptyStateStub,
        },
      },
    });

    await flushPromisesAndTicks(1);

    expect(wrapper.get('[data-testid="table-view"]').attributes('data-visible')).toBe('true');
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(false);
  });

  it('wires search, service filter, view mode switching, and total count updates', async () => {
    const wrapper = mountWithDefaults(HistoryView, {
      global: {
        stubs: {
          DashboardStrip: DashboardStripStub,
          HistoryTableView: HistoryTableViewStub,
          TimelineView: TimelineViewStub,
          FavoritesView: FavoritesViewStub,
          EmptyState: EmptyStateStub,
        },
      },
    });

    expect(wrapper.get('[data-testid="table-view"]').attributes('data-visible')).toBe('true');
    expect(wrapper.get('[data-testid="table-view"]').attributes('data-filter')).toBe('all');

    await wrapper.get('.search-cats').trigger('click');
    expect(wrapper.get('[data-testid="table-view"]').attributes('data-search')).toBe('cats');

    await wrapper.get('.filter-r2').trigger('click');
    expect(wrapper.get('[data-testid="table-view"]').attributes('data-filter')).toBe('r2');

    await wrapper.get('.emit-total').trigger('click');
    expect(wrapper.get('[data-testid="dashboard"]').attributes('data-total')).toBe('42');

    await wrapper.get('.show-timeline').trigger('click');
    expect(wrapper.get('[data-testid="timeline-view"]').attributes('data-visible')).toBe('true');
    expect(wrapper.get('[data-testid="table-view"]').attributes('data-visible')).toBe('false');

    await wrapper.get('.show-favorites').trigger('click');
    expect(wrapper.get('[data-testid="favorites-view"]').attributes('data-visible')).toBe('true');
  });
});

describe('HistoryTableView page interactions', () => {
  it('shows loading skeletons and empty fallback states from table data state', async () => {
    mockState.tableState = makeTableState([]);
    mockState.tableState.isLoadingPage.value = true;
    mockState.tableState.totalRecords.value = 0;

    const loadingWrapper = mountHistoryTable();
    expect(loadingWrapper.find('.skeleton-stub').exists()).toBe(true);
    expect(loadingWrapper.find('[data-testid="empty-state"]').exists()).toBe(false);

    loadingWrapper.unmount();
    mockState.tableState = makeTableState([]);
    mockState.tableState.isLoadingPage.value = false;
    mockState.tableState.totalRecords.value = 0;

    const emptyDefaultWrapper = mountHistoryTable();
    expect(emptyDefaultWrapper.get('[data-testid="empty-state"]').attributes('data-icon')).toBe('pi pi-table');
    emptyDefaultWrapper.unmount();

    const emptyWrapper = mountHistoryTable({ searchTerm: 'missing' });
    expect(emptyWrapper.get('[data-testid="empty-state"]').attributes('data-icon')).toBe('pi pi-search');
  });

  it('shows the empty table state directly when stats confirm there are no records', async () => {
    mockState.historyManager.totalCount.value = 0;
    mockState.historyManager.isStatsLoaded.value = true;
    mockState.tableState = makeTableState([]);
    mockState.tableState.hasLoadedPage.value = false;
    mockState.tableState.isLoadingPage.value = true;
    mockState.tableState.totalRecords.value = 0;

    const wrapper = mountHistoryTable();

    expect(wrapper.get('[data-testid="empty-state"]').attributes('data-icon')).toBe('pi pi-table');
    expect(wrapper.find('.skeleton-stub').exists()).toBe(false);
  });

  it('selects rows, exposes selected actions, copies, deletes, and clears the batch selection', async () => {
    const wrapper = mountHistoryTable();
    await flushPromisesAndTicks(2);

    const checkboxes = wrapper.findAll('.checkbox-stub');
    expect(checkboxes.length).toBeGreaterThan(1);

    await checkboxes[1].trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.handleSelectClick).toHaveBeenCalledWith(
      historyRows[0].id,
      expect.objectContaining({ shiftKey: false }),
      historyRows.map(row => row.id),
    );
    expect(wrapper.get('[data-testid="floating-actions"]').attributes('data-selected-count')).toBe('1');

    await wrapper.get('.fab-copy').trigger('click');
    expect(mockState.bulkCopyFormatted).toHaveBeenCalledWith('markdown');

    await wrapper.get('.fab-copy-service').trigger('click');
    expect(mockState.bulkCopyFormatted).toHaveBeenCalledWith('url', 'jd');

    await wrapper.get('.fab-favorite').trigger('click');
    expect(mockState.batchSetFavorite).toHaveBeenCalledWith([historyRows[0].id], true);

    await wrapper.get('.fab-delete').trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.bulkDelete).toHaveBeenCalled();
    expect(wrapper.find('[data-testid="floating-actions"]').exists()).toBe(false);

    await checkboxes[0].trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.handleHeaderCheckboxChange).toHaveBeenCalledWith(true);
    expect(wrapper.get('[data-testid="floating-actions"]').attributes('data-selected-count')).toBe(String(historyRows.length));

    await wrapper.get('.fab-clear').trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.clearSelection).toHaveBeenCalled();
  });

  it('requests batch unfavorite when every selected row is already favorited', async () => {
    mockState.viewState = makeViewState([historyRows[0].id]);
    mockState.historyManager.favoriteSet = ref(new Set([historyRows[0].id]));

    const wrapper = mountHistoryTable();
    await flushPromisesAndTicks(2);

    expect(wrapper.get('[data-testid="floating-actions"]').attributes('data-favorite-state')).toBe('all');

    await wrapper.get('.fab-unfavorite').trigger('click');

    expect(mockState.batchSetFavorite).toHaveBeenCalledWith([historyRows[0].id], false);
  });

  it('copies a service badge, opens the lightbox, and forwards lightbox actions', async () => {
    const wrapper = mountHistoryTable();
    await flushPromisesAndTicks(2);

    await wrapper.get('.service-badge-icon').trigger('click');
    expect(mockState.handleCopyServiceLink).toHaveBeenCalledWith(historyRows[0], 'jd');

    await wrapper.get('.thumb-box').trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.openLightbox).toHaveBeenCalledWith(historyRows[0], expect.any(MouseEvent));
    expect(wrapper.get('[data-testid="history-lightbox"]').text()).toContain(historyRows[0].localFileName);

    await wrapper.get('.lightbox-delete').trigger('click');
    expect(mockState.handleLightboxDelete).toHaveBeenCalledWith(historyRows[0]);

    await wrapper.get('.lightbox-next').trigger('click');
    expect(mockState.handleLightboxNavigate).toHaveBeenCalledWith('next');
  });

  it('opens the overflow popover with only hidden service badges', async () => {
    const serviceIds = ['bilibili', 'chaoxing', 'jd', 'weibo'] as const;
    const overflowRow = createHistoryItem({
      id: 'hist-overflow-services',
      results: serviceIds.map((serviceId) => createHistoryResult({
        serviceId,
        result: {
          serviceId,
          fileKey: `${serviceId}-key`,
          url: `https://cdn.example.com/${serviceId}.jpg`,
          size: 2048,
        },
      })),
    });
    mockState.visibleServiceCount = 2;
    mockState.tableState = makeTableState([overflowRow]);

    const wrapper = mountHistoryTable();
    await flushPromisesAndTicks(2);

    expect(wrapper.findAll('.service-badge-icon')).toHaveLength(2);
    expect(wrapper.get('.service-badge-more').text()).toBe('+2');

    await wrapper.get('.service-badge-more').trigger('click');

    expect(mockState.interactions.openServicePopover).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      overflowRow,
      ['jd', 'weibo'],
    );
  });

  it('keeps selected and error-fallback visual states deterministic', async () => {
    mockState.viewState = makeViewState([historyRows[0].id]);
    const selectedWrapper = mountHistoryTable();
    await flushPromisesAndTicks(2);
    expect(selectedWrapper.get('[data-testid="floating-actions"]').attributes('data-selected-count')).toBe('1');
    selectedWrapper.unmount();

    mockState.viewState = makeViewState();
    mockState.tableState = makeTableState([]);
    mockState.tableState.totalRecords.value = 0;
    mockState.tableState.isLoadingPage.value = false;

    const fallbackWrapper = mountHistoryTable({ filter: 'r2', searchTerm: 'failed-load' });
    expect(fallbackWrapper.get('[data-testid="empty-state"]').attributes('data-icon')).toBe('pi pi-search');
  });
});
