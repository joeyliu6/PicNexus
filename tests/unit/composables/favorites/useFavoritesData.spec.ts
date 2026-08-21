import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { UserConfig } from '@/config/types';

const {
  getFavoritesMetaPageMock,
  onCacheEventTypeMock,
  getMetaCandidatesMock,
  eventHandlers,
  unlistenUpdatedMock,
  unlistenDeletedMock,
  unlistenClearedMock,
} = vi.hoisted(() => ({
  getFavoritesMetaPageMock: vi.fn(),
  onCacheEventTypeMock: vi.fn(),
  getMetaCandidatesMock: vi.fn(),
  eventHandlers: {} as Record<string, () => void>,
  unlistenUpdatedMock: vi.fn(),
  unlistenDeletedMock: vi.fn(),
  unlistenClearedMock: vi.fn(),
}));

vi.mock('@/services/HistoryDatabase', () => ({
  historyDB: {
    getFavoritesMetaPage: getFavoritesMetaPageMock,
  },
}));

vi.mock('@/events/cacheEvents', () => ({
  onCacheEventType: onCacheEventTypeMock,
}));

vi.mock('@/composables/useThumbCache', () => ({
  getMetaThumbnailCandidates: getMetaCandidatesMock,
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { useFavoritesData } = await import('@/composables/favorites/useFavoritesData');

function makeMeta(id: string, service = 'weibo') {
  return {
    id,
    timestamp: 1000,
    localFileName: `${id}.png`,
    aspectRatio: 1.2,
    primaryService: service,
    primaryUrl: `https://img.example.com/${id}.png`,
  };
}

function mountHarness() {
  const filter = ref<'all' | 'weibo'>('all');
  const searchTerm = ref('');
  const favoriteSet = ref(new Set<string>());
  const statsLoaded = ref(true);
  const scrollContainerRef = ref<HTMLElement | null>(null);
  const config = ref({ theme: 'light' } as unknown as UserConfig);

  let api: ReturnType<typeof useFavoritesData> | null = null;
  const Harness = defineComponent({
    setup() {
      api = useFavoritesData({
        filter,
        searchTerm,
        favoriteSet,
        statsLoaded,
        scrollContainerRef,
        config,
      });
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  return {
    wrapper,
    api: () => api!,
    filter,
    searchTerm,
    favoriteSet,
    statsLoaded,
    scrollContainerRef,
    config,
  };
}

async function settleFirstPage(loadPromise?: Promise<void>) {
  await flushPromises();
  await vi.advanceTimersByTimeAsync(150);
  if (loadPromise) await loadPromise;
  await flushPromises();
}

describe('useFavoritesData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    Object.keys(eventHandlers).forEach(key => delete eventHandlers[key]);
    getMetaCandidatesMock.mockImplementation((meta: { id: string }) => [`thumb:${meta.id}`]);
    getFavoritesMetaPageMock.mockResolvedValue({
      items: [],
      total: 0,
      hasMore: false,
    });
    onCacheEventTypeMock.mockImplementation(async (type: string, handler: () => void) => {
      eventHandlers[type] = handler;
      if (type === 'history-updated') return unlistenUpdatedMock;
      if (type === 'history-deleted') return unlistenDeletedMock;
      return unlistenClearedMock;
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads the first page once and caches thumbnail/service metadata', async () => {
    const alpha = makeMeta('alpha', 'weibo');
    const beta = {
      ...makeMeta('beta', 'r2'),
      mirrorServices: [
        { serviceId: 'r2', url: 'https://img.example.com/beta.png' },
        { serviceId: 'github', url: 'https://cdn.example.com/beta.png' },
      ],
    };
    getFavoritesMetaPageMock.mockResolvedValueOnce({
      items: [alpha, beta],
      total: 2,
      hasMore: false,
    });

    const harness = mountHarness();
    harness.favoriteSet.value = new Set(['alpha', 'beta']);

    const loadPromise = harness.api().loadFirstPage();
    await settleFirstPage(loadPromise);
    await harness.api().loadFirstPage();

    expect(getFavoritesMetaPageMock).toHaveBeenCalledTimes(1);
    expect(getFavoritesMetaPageMock).toHaveBeenCalledWith({
      offset: 0,
      limit: 80,
      serviceFilter: 'all',
      searchTerm: '',
    });
    expect(harness.api().loadedMetas.value).toEqual([alpha, beta]);
    expect(harness.api().totalCount.value).toBe(2);
    expect(harness.api().hasLoadedOnce.value).toBe(true);
    expect(harness.api().isLoading.value).toBe(false);
    expect(harness.api().getThumbnailUrls(alpha as never)).toEqual(['thumb:alpha']);
    expect(getMetaCandidatesMock).toHaveBeenCalledWith(alpha, harness.config.value);
    expect(harness.api().getItemService('beta')).toBe('r2');
    expect(harness.api().getItemServices('beta')).toEqual(['r2', 'github']);
  });

  it('shows the loaded empty state without querying when stats already have no favorites', async () => {
    const harness = mountHarness();
    harness.statsLoaded.value = true;
    harness.favoriteSet.value = new Set();

    await harness.api().loadFirstPage();
    await nextTick();

    expect(getFavoritesMetaPageMock).not.toHaveBeenCalled();
    expect(harness.api().loadedMetas.value).toEqual([]);
    expect(harness.api().totalCount.value).toBe(0);
    expect(harness.api().isLoading.value).toBe(false);
    expect(harness.api().hasLoadedOnce.value).toBe(true);
  });

  it('loads the next page when scrolling near the end of the container', async () => {
    getFavoritesMetaPageMock
      .mockResolvedValueOnce({
        items: [makeMeta('alpha')],
        total: 2,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [makeMeta('beta', 'r2')],
        total: 2,
        hasMore: false,
      });

    const harness = mountHarness();
    harness.favoriteSet.value = new Set(['alpha', 'beta']);
    await settleFirstPage(harness.api().loadFirstPage());

    harness.scrollContainerRef.value = {
      scrollHeight: 1000,
      scrollTop: 650,
      clientHeight: 100,
    } as HTMLElement;

    harness.api().onFavoritesScroll();
    await flushPromises();

    expect(getFavoritesMetaPageMock).toHaveBeenNthCalledWith(2, {
      offset: 1,
      limit: 80,
      serviceFilter: 'all',
      searchTerm: '',
    });
    expect(harness.api().loadedMetas.value.map(meta => meta.id)).toEqual(['alpha', 'beta']);
    expect(harness.api().hasMore.value).toBe(false);
    expect(harness.api().getItemService('beta')).toBe('r2');
    expect(harness.api().getItemServices('beta')).toEqual(['r2']);
  });

  it('reloads from the first page when the search term changes after the first load', async () => {
    getFavoritesMetaPageMock
      .mockResolvedValueOnce({
        items: [makeMeta('alpha')],
        total: 1,
        hasMore: false,
      })
      .mockResolvedValueOnce({
        items: [makeMeta('beta')],
        total: 1,
        hasMore: false,
      });

    const harness = mountHarness();
    harness.favoriteSet.value = new Set(['alpha', 'beta']);
    await settleFirstPage(harness.api().loadFirstPage());

    harness.searchTerm.value = 'beta';
    await nextTick();
    await settleFirstPage();

    expect(getFavoritesMetaPageMock).toHaveBeenNthCalledWith(2, {
      offset: 0,
      limit: 80,
      serviceFilter: 'all',
      searchTerm: 'beta',
    });
    expect(harness.api().loadedMetas.value.map(meta => meta.id)).toEqual(['beta']);
  });

  it('updates the current page locally when only a few favorites are removed', async () => {
    getFavoritesMetaPageMock.mockResolvedValueOnce({
      items: [makeMeta('alpha'), makeMeta('beta'), makeMeta('gamma')],
      total: 3,
      hasMore: false,
    });

    const harness = mountHarness();
    harness.favoriteSet.value = new Set(['alpha', 'beta', 'gamma']);
    await settleFirstPage(harness.api().loadFirstPage());

    harness.favoriteSet.value = new Set(['alpha', 'gamma']);
    await nextTick();

    expect(getFavoritesMetaPageMock).toHaveBeenCalledTimes(1);
    expect(harness.api().loadedMetas.value.map(meta => meta.id)).toEqual(['alpha', 'gamma']);
    expect(harness.api().totalCount.value).toBe(2);
    expect(harness.api().hasMore.value).toBe(false);
  });

  /**
   * 2026-08-20 真机验收发现：在历史页点收藏，切到收藏页看不到，得刷新才出来。
   *
   * 根因是下面那段增量逻辑只算「从当前页移走了几条」，新增时一条都没移走、
   * `removedCount === 0` 直接 return，新收藏那条永远进不来。
   */
  it('在别处新增收藏后重查列表（不能只认「移走了几条」）', async () => {
    getFavoritesMetaPageMock.mockResolvedValueOnce({
      items: [makeMeta('alpha')],
      total: 1,
      hasMore: false,
    });

    const harness = mountHarness();
    harness.favoriteSet.value = new Set(['alpha']);
    await settleFirstPage(harness.api().loadFirstPage());
    expect(getFavoritesMetaPageMock).toHaveBeenCalledTimes(1);

    // 在历史页收藏了一张当前列表里没有的图
    getFavoritesMetaPageMock.mockResolvedValueOnce({
      items: [makeMeta('beta'), makeMeta('alpha')],
      total: 2,
      hasMore: false,
    });
    harness.favoriteSet.value = new Set(['alpha', 'beta']);
    await settleFirstPage(Promise.resolve());

    expect(getFavoritesMetaPageMock).toHaveBeenCalledTimes(2);
    expect(harness.api().loadedMetas.value.map(meta => meta.id)).toEqual(['beta', 'alpha']);
  });

  it('加载在途时新增收藏不吞掉：这轮结束后补查一次', async () => {
    getFavoritesMetaPageMock.mockResolvedValueOnce({
      items: [makeMeta('alpha')],
      total: 1,
      hasMore: false,
    });

    const harness = mountHarness();
    harness.favoriteSet.value = new Set(['alpha']);
    await settleFirstPage(harness.api().loadFirstPage());
    expect(getFavoritesMetaPageMock).toHaveBeenCalledTimes(1);

    // 第二次查询挂起：模拟一轮 reload 的 SELECT 已发出、尚未返回
    let resolveInFlight!: (value: {
      items: ReturnType<typeof makeMeta>[]; total: number; hasMore: boolean;
    }) => void;
    getFavoritesMetaPageMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveInFlight = resolve; }),
    );
    harness.searchTerm.value = 'a';
    await flushPromises();
    expect(harness.api().isLoading.value).toBe(true);

    // 在途期间点了新收藏：不能立刻重查（在途 SELECT 早于写盘，查不回新收藏），也不能吞掉
    getFavoritesMetaPageMock.mockResolvedValueOnce({
      items: [makeMeta('beta'), makeMeta('alpha')],
      total: 2,
      hasMore: false,
    });
    harness.favoriteSet.value = new Set(['alpha', 'beta']);
    await nextTick();
    expect(getFavoritesMetaPageMock).toHaveBeenCalledTimes(2);

    // 在途查询返回（不含 beta）→ 这轮收尾后应自动补查到 beta
    resolveInFlight({ items: [makeMeta('alpha')], total: 1, hasMore: false });
    await settleFirstPage(Promise.resolve());
    await settleFirstPage(Promise.resolve());

    expect(getFavoritesMetaPageMock).toHaveBeenCalledTimes(3);
    expect(harness.api().loadedMetas.value.map(meta => meta.id)).toEqual(['beta', 'alpha']);
  });

  /**
   * 反向判据：内容没变、只是换了个 Set 引用，不该重查。
   *
   * 配置保存广播极其频繁，`favoriteSet` 每次都产出新 Set；按引用判断的话
   * 每存一次配置就白查一遍收藏列表。
   */
  it('favoriteSet 换了引用但内容没变时不重查', async () => {
    getFavoritesMetaPageMock.mockResolvedValueOnce({
      items: [makeMeta('alpha'), makeMeta('beta')],
      total: 2,
      hasMore: false,
    });

    const harness = mountHarness();
    harness.favoriteSet.value = new Set(['alpha', 'beta']);
    await settleFirstPage(harness.api().loadFirstPage());
    expect(getFavoritesMetaPageMock).toHaveBeenCalledTimes(1);

    // 同一批 id 重新赋值（新 Set 引用，但内容没变化）
    harness.favoriteSet.value = new Set(['alpha', 'beta']);
    await nextTick();

    expect(getFavoritesMetaPageMock).toHaveBeenCalledTimes(1);
  });

  it('clears to the empty state immediately when all favorites are removed', async () => {
    getFavoritesMetaPageMock.mockResolvedValueOnce({
      items: [makeMeta('alpha'), makeMeta('beta')],
      total: 2,
      hasMore: false,
    });

    const harness = mountHarness();
    harness.favoriteSet.value = new Set(['alpha', 'beta']);
    await settleFirstPage(harness.api().loadFirstPage());

    harness.favoriteSet.value = new Set();
    await nextTick();

    expect(getFavoritesMetaPageMock).toHaveBeenCalledTimes(1);
    expect(harness.api().loadedMetas.value).toEqual([]);
    expect(harness.api().totalCount.value).toBe(0);
    expect(harness.api().hasMore.value).toBe(false);
    expect(harness.api().isLoading.value).toBe(false);
    expect(harness.api().hasLoadedOnce.value).toBe(true);
  });

  it('reloads from the server when too many favorites are removed at once', async () => {
    getFavoritesMetaPageMock
      .mockResolvedValueOnce({
        items: ['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeMeta(id)),
        total: 6,
        hasMore: false,
      })
      .mockResolvedValueOnce({
        items: [makeMeta('survivor')],
        total: 1,
        hasMore: false,
      });

    const harness = mountHarness();
    harness.favoriteSet.value = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'survivor']);
    await settleFirstPage(harness.api().loadFirstPage());

    harness.favoriteSet.value = new Set(['survivor']);
    await nextTick();
    await settleFirstPage();

    expect(getFavoritesMetaPageMock).toHaveBeenCalledTimes(2);
    expect(harness.api().loadedMetas.value.map(meta => meta.id)).toEqual(['survivor']);
    expect(harness.api().totalCount.value).toBe(1);
  });

  it('clears to the empty state immediately on history-cleared events', async () => {
    getFavoritesMetaPageMock.mockResolvedValueOnce({
      items: [makeMeta('alpha')],
      total: 1,
      hasMore: false,
    });

    const harness = mountHarness();
    harness.favoriteSet.value = new Set(['alpha']);
    await settleFirstPage(harness.api().loadFirstPage());

    eventHandlers['history-cleared']();
    await nextTick();

    expect(getFavoritesMetaPageMock).toHaveBeenCalledTimes(1);
    expect(harness.api().loadedMetas.value).toEqual([]);
    expect(harness.api().totalCount.value).toBe(0);
    expect(harness.api().isLoading.value).toBe(false);
    expect(harness.api().hasLoadedOnce.value).toBe(true);
  });

  it('reloads on history events and cleans up listeners when unmounted', async () => {
    getFavoritesMetaPageMock
      .mockResolvedValueOnce({
        items: [makeMeta('alpha')],
        total: 1,
        hasMore: false,
      })
      .mockResolvedValueOnce({
        items: [makeMeta('beta')],
        total: 1,
        hasMore: false,
      });

    const harness = mountHarness();
    harness.favoriteSet.value = new Set(['alpha']);
    await settleFirstPage(harness.api().loadFirstPage());

    eventHandlers['history-updated']();
    await settleFirstPage();

    expect(getFavoritesMetaPageMock).toHaveBeenCalledTimes(2);
    expect(harness.api().loadedMetas.value.map(meta => meta.id)).toEqual(['beta']);

    harness.wrapper.unmount();

    expect(unlistenUpdatedMock).toHaveBeenCalledTimes(1);
    expect(unlistenDeletedMock).toHaveBeenCalledTimes(1);
    expect(unlistenClearedMock).toHaveBeenCalledTimes(1);
  });
});
