import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

const {
  loadPageByNumberMock,
  searchHistoryMock,
  toastErrorMock,
  onCacheEventTypeMock,
  getSuccessfulServicesMock,
  eventHandlers,
  unlistenUpdatedMock,
  unlistenDeletedMock,
  unlistenClearedMock,
  historyStatsLoaded,
  historyTotalCount,
} = vi.hoisted(() => ({
  loadPageByNumberMock: vi.fn(),
  searchHistoryMock: vi.fn(),
  toastErrorMock: vi.fn(),
  onCacheEventTypeMock: vi.fn(),
  getSuccessfulServicesMock: vi.fn(),
  eventHandlers: {} as Record<string, () => void>,
  unlistenUpdatedMock: vi.fn(),
  unlistenDeletedMock: vi.fn(),
  unlistenClearedMock: vi.fn(),
  historyStatsLoaded: { value: false },
  historyTotalCount: { value: 0 },
}));

vi.mock('../../../../composables/useHistory', () => ({
  useHistoryManager: () => ({
    loadPageByNumber: loadPageByNumberMock,
    searchHistory: searchHistoryMock,
    isStatsLoaded: historyStatsLoaded,
    totalCount: historyTotalCount,
  }),
}));

vi.mock('../../../../composables/useHistoryViewState', () => ({
  useHistoryViewState: () => ({
    selectedIdList: ref([]),
    clearSelection: vi.fn(),
    isSelected: () => false,
    select: vi.fn(),
    deselect: vi.fn(),
  }),
}));

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({
    error: toastErrorMock,
  }),
}));

vi.mock('../../../../events/cacheEvents', () => ({
  onCacheEventType: onCacheEventTypeMock,
}));

vi.mock('../../../../utils/formatters', () => ({
  formatTime: vi.fn((value: number) => `time:${value}`),
  getSuccessfulServices: getSuccessfulServicesMock,
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { useHistoryTableData } = await import('../../../../composables/history/useHistoryTableData');

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeViewState(initialSelectedIds: string[] = []) {
  const selectedIds = shallowRef(new Set(initialSelectedIds));
  const clearSelection = vi.fn(() => {
    selectedIds.value = new Set();
  });
  const select = vi.fn((id: string) => {
    const next = new Set(selectedIds.value);
    next.add(id);
    selectedIds.value = next;
  });
  const deselect = vi.fn((id: string) => {
    const next = new Set(selectedIds.value);
    next.delete(id);
    selectedIds.value = next;
  });

  return {
    selectedIdList: computed(() => Array.from(selectedIds.value)),
    clearSelection,
    select,
    deselect,
    isSelected: (id: string) => selectedIds.value.has(id),
  } as unknown as ReturnType<typeof import('../../../../composables/useHistoryViewState').useHistoryViewState>;
}

function mountHarness(options: Parameters<typeof useHistoryTableData>[0]) {
  let api: ReturnType<typeof useHistoryTableData> | null = null;

  const Harness = defineComponent({
    setup() {
      api = useHistoryTableData(options);
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  return {
    wrapper,
    api: () => api!,
  };
}

describe('useHistoryTableData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(eventHandlers).forEach(key => delete eventHandlers[key]);
    getSuccessfulServicesMock.mockImplementation((item: { services?: string[] }) => item.services ?? []);
    loadPageByNumberMock.mockResolvedValue({
      items: [],
      total: 0,
    });
    historyStatsLoaded.value = false;
    historyTotalCount.value = 0;
    searchHistoryMock.mockResolvedValue({
      items: [],
      total: 0,
    });
    onCacheEventTypeMock.mockImplementation(async (type: string, handler: () => void) => {
      eventHandlers[type] = handler;
      if (type === 'history-updated') return unlistenUpdatedMock;
      if (type === 'history-deleted') return unlistenDeletedMock;
      return unlistenClearedMock;
    });
  });

  it('loads the first page on mount and exposes the returned data', async () => {
    loadPageByNumberMock.mockResolvedValueOnce({
      items: [{ id: 'a', services: ['weibo'] }],
      total: 1,
    });
    const onPageLoaded = vi.fn();

    const harness = mountHarness({
      filter: ref('all'),
      searchTerm: ref(''),
      onPageLoaded,
      viewState: makeViewState(),
    });
    await flushPromises();

    expect(loadPageByNumberMock).toHaveBeenCalledWith(1, 50, 'all');
    expect(harness.api().currentPageData.value).toEqual([{ id: 'a', services: ['weibo'] }]);
    expect(harness.api().totalRecords.value).toBe(1);
    expect(harness.api().isLoadingPage.value).toBe(false);
    expect(onPageLoaded).toHaveBeenCalledTimes(1);
  });

  it('enters the empty state directly when stats already confirm there are no records', async () => {
    historyStatsLoaded.value = true;
    historyTotalCount.value = 0;

    const harness = mountHarness({
      filter: ref('all'),
      searchTerm: ref(''),
      viewState: makeViewState(),
    });
    await flushPromises();

    expect(loadPageByNumberMock).not.toHaveBeenCalled();
    expect(harness.api().currentPageData.value).toEqual([]);
    expect(harness.api().totalRecords.value).toBe(0);
    expect(harness.api().isLoadingPage.value).toBe(false);
    expect(harness.api().hasLoadedPage.value).toBe(true);
  });

  it('keeps the initial unfiltered probe loading until the first response settles', async () => {
    const firstLoad = createDeferred<{ items: Array<{ id: string }>; total: number }>();
    loadPageByNumberMock.mockReturnValueOnce(firstLoad.promise);

    const harness = mountHarness({
      filter: ref('all'),
      searchTerm: ref(''),
      viewState: makeViewState(),
    });
    await flushPromises();

    expect(harness.api().isLoadingPage.value).toBe(true);
    expect(harness.api().hasLoadedPage.value).toBe(false);

    firstLoad.resolve({ items: [], total: 0 });
    await flushPromises();

    expect(harness.api().currentPageData.value).toEqual([]);
    expect(harness.api().totalRecords.value).toBe(0);
    expect(harness.api().isLoadingPage.value).toBe(false);
    expect(harness.api().hasLoadedPage.value).toBe(true);
  });

  it('still exposes loading for an initial filtered page load', async () => {
    const firstLoad = createDeferred<{ items: Array<{ id: string }>; total: number }>();
    loadPageByNumberMock.mockReturnValueOnce(firstLoad.promise);

    const harness = mountHarness({
      filter: ref('weibo'),
      searchTerm: ref(''),
      viewState: makeViewState(),
    });
    await nextTick();
    await flushPromises();

    expect(harness.api().isLoadingPage.value).toBe(true);

    firstLoad.resolve({ items: [], total: 0 });
    await flushPromises();

    expect(harness.api().isLoadingPage.value).toBe(false);
  });

  it('switches to search mode, resets paging and clears selection when the search term changes', async () => {
    const filter = ref<'all' | 'weibo'>('all');
    const searchTerm = ref('');
    const viewState = makeViewState(['a']);

    const harness = mountHarness({
      filter,
      searchTerm,
      viewState,
    });
    await flushPromises();

    harness.api().currentPage.value = 3;
    harness.api().first.value = 100;
    searchTerm.value = 'cat';
    await nextTick();
    await flushPromises();

    expect(viewState.clearSelection).toHaveBeenCalledTimes(1);
    expect(harness.api().currentPage.value).toBe(1);
    expect(harness.api().first.value).toBe(0);
    expect(searchHistoryMock).toHaveBeenLastCalledWith('cat', {
      serviceFilter: undefined,
      limit: 50,
      offset: 0,
    });
  });

  it('ignores stale page results when a newer load finishes later', async () => {
    const firstLoad = createDeferred<{ items: Array<{ id: string }>; total: number }>();
    loadPageByNumberMock
      .mockReturnValueOnce(firstLoad.promise)
      .mockResolvedValueOnce({
        items: [{ id: 'new' }],
        total: 1,
      });

    const filter = ref<'all' | 'weibo'>('all');
    const harness = mountHarness({
      filter,
      searchTerm: ref(''),
      viewState: makeViewState(),
    });

    filter.value = 'weibo';
    await nextTick();
    await flushPromises();

    firstLoad.resolve({
      items: [{ id: 'old' }],
      total: 99,
    });
    await flushPromises();

    expect(harness.api().currentPageData.value).toEqual([{ id: 'new' }]);
    expect(harness.api().totalRecords.value).toBe(1);
  });

  it('selects and deselects the current page via the header checkbox', async () => {
    loadPageByNumberMock.mockResolvedValueOnce({
      items: [{ id: 'a' }, { id: 'b' }],
      total: 2,
    });
    const viewState = makeViewState();

    const harness = mountHarness({
      filter: ref('all'),
      searchTerm: ref(''),
      viewState,
    });
    await flushPromises();

    harness.api().handleHeaderCheckboxChange(true);
    await nextTick();

    expect(viewState.select).toHaveBeenCalledTimes(2);
    expect(viewState.select).toHaveBeenNthCalledWith(1, 'a');
    expect(viewState.select).toHaveBeenNthCalledWith(2, 'b');
    expect(harness.api().selectAll.value).toBe(true);

    harness.api().handleHeaderCheckboxChange(false);
    await nextTick();

    expect(viewState.deselect).toHaveBeenCalledTimes(2);
    expect(harness.api().selectAll.value).toBe(false);
  });

  it('counts successful services across selected items from the current and cached pages', async () => {
    loadPageByNumberMock.mockResolvedValueOnce({
      items: [
        { id: 'a', services: ['weibo', 'r2'] },
        { id: 'b', services: ['weibo'] },
      ],
      total: 2,
    });

    const harness = mountHarness({
      filter: ref('all'),
      searchTerm: ref(''),
      viewState: makeViewState(['a', 'b']),
    });
    await flushPromises();

    expect(harness.api().selectedAvailableServices.value).toEqual([
      { serviceId: 'weibo', count: 2 },
      { serviceId: 'r2', count: 1 },
    ]);
  });

  it('reloads and resets paging on a history-updated event, then cleans up listeners on unmount', async () => {
    loadPageByNumberMock.mockResolvedValue({
      items: [{ id: 'a' }],
      total: 1,
    });

    const harness = mountHarness({
      filter: ref('all'),
      searchTerm: ref(''),
      viewState: makeViewState(),
    });
    await flushPromises();

    harness.api().currentPage.value = 4;
    harness.api().first.value = 150;
    eventHandlers['history-updated']();
    await flushPromises();

    expect(harness.api().currentPage.value).toBe(1);
    expect(harness.api().first.value).toBe(0);
    expect(loadPageByNumberMock).toHaveBeenCalledTimes(2);

    harness.wrapper.unmount();

    expect(unlistenUpdatedMock).toHaveBeenCalledTimes(1);
    expect(unlistenDeletedMock).toHaveBeenCalledTimes(1);
    expect(unlistenClearedMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the last valid page when deletion makes the current page empty', async () => {
    loadPageByNumberMock
      .mockResolvedValueOnce({
        items: [{ id: 'last' }],
        total: 51,
      })
      .mockResolvedValueOnce({
        items: [],
        total: 50,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'first' }],
        total: 50,
      });

    const harness = mountHarness({
      filter: ref('all'),
      searchTerm: ref(''),
      viewState: makeViewState(),
    });
    await flushPromises();

    harness.api().currentPage.value = 2;
    harness.api().first.value = 50;
    eventHandlers['history-deleted']();
    await flushPromises();

    expect(loadPageByNumberMock).toHaveBeenNthCalledWith(2, 2, 50, 'all');
    expect(loadPageByNumberMock).toHaveBeenNthCalledWith(3, 1, 50, 'all');
    expect(harness.api().currentPage.value).toBe(1);
    expect(harness.api().first.value).toBe(0);
    expect(harness.api().currentPageData.value).toEqual([{ id: 'first' }]);
    expect(harness.api().totalRecords.value).toBe(50);
  });
});
