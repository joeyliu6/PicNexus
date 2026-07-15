import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref, type Ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { mountWithDefaults } from '../../helpers/vueMount';
import { flushPromisesAndTicks } from '../../helpers/wait';
import type { ImageMeta } from '@/types/image-meta';
import type { ServiceType } from '@/config/types';
import type { DayStats } from '@/services/HistoryDatabase';

const historyDbMock = vi.hoisted(() => ({
  getDayStats: vi.fn(),
  getItemsByDayRange: vi.fn(),
  getDayAspectRatiosByRange: vi.fn(),
  getAllAspectRatios: vi.fn(),
}));

const cacheEventMock = vi.hoisted(() => ({
  onCacheEventType: vi.fn(),
}));

vi.mock('@/services/HistoryDatabase', () => ({
  historyDB: historyDbMock,
}));

vi.mock('@/events/cacheEvents', () => ({
  onCacheEventType: cacheEventMock.onCacheEventType,
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { useTimelineDayPagination } from '@/composables/timeline/useTimelineDayPagination';

const mountedWrappers: VueWrapper[] = [];

function localTs(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month, day, hour, 0, 0, 0).getTime();
}

function dayStat(
  year: number,
  month: number,
  day: number,
  count: number,
  overrides: Partial<DayStats> = {},
): DayStats {
  return {
    year,
    month,
    day,
    count,
    aspectRatioSum: count * 1.5,
    minTimestamp: localTs(year, month, day, 8),
    maxTimestamp: localTs(year, month, day, 20),
    ...overrides,
  };
}

function makeMeta(id: string, timestamp: number, overrides: Partial<ImageMeta> = {}): ImageMeta {
  return {
    id,
    timestamp,
    localFileName: `${id}.jpg`,
    aspectRatio: 1.5,
    primaryService: 'jd' as ServiceType,
    primaryUrl: `https://img.example.com/${id}.jpg`,
    ...overrides,
  };
}

function mountPagination(overrides: {
  filter?: Ref<ServiceType | 'all'>;
  searchTerm?: Ref<string>;
  favoritesOnly?: Ref<boolean>;
  visible?: Ref<boolean>;
} = {}) {
  const filter: Ref<ServiceType | 'all'> = overrides.filter ?? ref<ServiceType | 'all'>('all');
  const searchTerm: Ref<string> = overrides.searchTerm ?? ref('');
  const favoritesOnly: Ref<boolean> = overrides.favoritesOnly ?? ref(false);
  const visible: Ref<boolean> = overrides.visible ?? ref(true);
  let api!: ReturnType<typeof useTimelineDayPagination>;

  const Harness = defineComponent({
    setup() {
      api = useTimelineDayPagination({ filter, searchTerm, favoritesOnly, visible });
      return () => null;
    },
  });

  mountedWrappers.push(mountWithDefaults(Harness));
  return { api, filter, searchTerm, favoritesOnly, visible };
}

beforeEach(() => {
  historyDbMock.getDayStats.mockResolvedValue([]);
  historyDbMock.getItemsByDayRange.mockResolvedValue([]);
  historyDbMock.getDayAspectRatiosByRange.mockResolvedValue([]);
  historyDbMock.getAllAspectRatios.mockResolvedValue([]);
  cacheEventMock.onCacheEventType.mockResolvedValue(vi.fn());
});

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount();
  }
  vi.clearAllMocks();
});

describe('useTimelineDayPagination', () => {
  it('loads day stats and exposes skeleton groups with preloaded aspect ratios', async () => {
    const stat = dayStat(2024, 0, 2, 2, { aspectRatioSum: 3 });
    historyDbMock.getDayStats.mockResolvedValueOnce([stat]);
    historyDbMock.getAllAspectRatios.mockResolvedValueOnce([
      { id: 'newer', timestamp: localTs(2024, 0, 2, 18), aspectRatio: 1.25 },
      { id: 'older', timestamp: localTs(2024, 0, 2, 10), aspectRatio: 1.75 },
    ]);

    const { api } = mountPagination({
      filter: ref<ServiceType | 'all'>('jd'),
      searchTerm: ref('cat'),
      favoritesOnly: ref(true),
    });

    expect(api.isLoadingStats.value).toBe(true);

    await flushPromisesAndTicks(2);

    expect(historyDbMock.getDayStats).toHaveBeenCalledWith({
      serviceFilter: 'jd',
      searchTerm: 'cat',
      favoritesOnly: true,
    });
    expect(historyDbMock.getAllAspectRatios).toHaveBeenCalledWith({
      serviceFilter: 'jd',
      searchTerm: 'cat',
      favoritesOnly: true,
    });
    expect(api.hasLoadedStats.value).toBe(true);
    expect(api.isLoadingStats.value).toBe(false);
    expect(api.isFullyPreloaded.value).toBe(true);
    expect(api.totalCount.value).toBe(2);
    expect(api.groups.value).toHaveLength(1);
    expect(api.groups.value[0]).toMatchObject({
      id: '2024-0-2',
      expectedCount: 2,
      isSkeleton: true,
      items: [],
    });
    expect(api.groups.value[0].aspectRatios).toEqual([1.25, 1.75]);
  });

  it('appends newly loaded days without dropping earlier day caches', async () => {
    const dayOne = dayStat(2024, 0, 2, 1);
    const dayTwo = dayStat(2024, 0, 1, 1);
    const metaOne = makeMeta('day-one', localTs(2024, 0, 2, 12));
    const metaTwo = makeMeta('day-two', localTs(2024, 0, 1, 12));
    historyDbMock.getDayStats.mockResolvedValueOnce([dayOne, dayTwo]);

    const { api } = mountPagination();
    await flushPromisesAndTicks(2);

    historyDbMock.getItemsByDayRange.mockResolvedValueOnce([metaOne]);
    await api.ensureDaysLoaded(['2024-0-2']);

    expect(api.dayMetaCache.get('2024-0-2')).toEqual([metaOne]);
    expect(api.loadedDayKeys.value.has('2024-0-2')).toBe(true);
    expect(api.groups.value[0].isSkeleton).toBe(false);

    historyDbMock.getItemsByDayRange.mockResolvedValueOnce([metaTwo]);
    await api.ensureDaysLoaded(['2024-0-1']);

    expect(historyDbMock.getItemsByDayRange).toHaveBeenCalledTimes(2);
    expect(api.dayMetaCache.get('2024-0-2')).toEqual([metaOne]);
    expect(api.dayMetaCache.get('2024-0-1')).toEqual([metaTwo]);
    expect([...api.loadedDayKeys.value]).toEqual(['2024-0-2', '2024-0-1']);
  });

  it('batches same-tick day loading into a single range query', async () => {
    const dayOne = dayStat(2024, 0, 2, 1);
    const dayTwo = dayStat(2024, 0, 1, 1);
    historyDbMock.getDayStats.mockResolvedValueOnce([dayOne, dayTwo]);
    historyDbMock.getItemsByDayRange.mockResolvedValueOnce([
      makeMeta('day-one', localTs(2024, 0, 2, 12)),
      makeMeta('day-two', localTs(2024, 0, 1, 12)),
    ]);

    const { api } = mountPagination();
    await flushPromisesAndTicks(2);

    const first = api.ensureDaysLoaded(['2024-0-2']);
    const second = api.ensureDaysLoaded(['2024-0-1']);
    await Promise.all([first, second]);

    const expectedStart = Math.min(dayOne.minTimestamp, dayTwo.minTimestamp);
    const expectedEnd = Math.max(dayOne.maxTimestamp, dayTwo.maxTimestamp);
    expect(historyDbMock.getItemsByDayRange).toHaveBeenCalledTimes(1);
    expect(historyDbMock.getItemsByDayRange).toHaveBeenCalledWith(expectedStart, expectedEnd, {
      serviceFilter: 'all',
      searchTerm: '',
      favoritesOnly: false,
    });
    expect(api.loadedDayKeys.value.has('2024-0-2')).toBe(true);
    expect(api.loadedDayKeys.value.has('2024-0-1')).toBe(true);
  });

  it('clears loaded day state and reloads stats when filters change', async () => {
    historyDbMock.getDayStats.mockResolvedValueOnce([dayStat(2024, 0, 2, 1)]);
    const filter = ref<ServiceType | 'all'>('all');
    const { api } = mountPagination({ filter });
    await flushPromisesAndTicks(2);

    historyDbMock.getItemsByDayRange.mockResolvedValueOnce([
      makeMeta('loaded', localTs(2024, 0, 2, 12)),
    ]);
    await api.ensureDaysLoaded(['2024-0-2']);
    expect(api.loadedDayKeys.value.size).toBe(1);

    historyDbMock.getDayStats.mockResolvedValueOnce([dayStat(2024, 0, 3, 1)]);
    filter.value = 'weibo' as ServiceType;
    await flushPromisesAndTicks(3);

    expect(historyDbMock.getDayStats).toHaveBeenLastCalledWith({
      serviceFilter: 'weibo',
      searchTerm: '',
      favoritesOnly: false,
    });
    expect(api.dayMetaCache.size).toBe(0);
    expect(api.loadedDayKeys.value.size).toBe(0);
    expect(api.groups.value[0].id).toBe('2024-0-3');
  });

  it('prefetches aspect ratios by day range only when the full preload is unavailable', async () => {
    const dayOne = dayStat(2024, 0, 2, 2);
    historyDbMock.getDayStats.mockResolvedValueOnce([dayOne]);
    historyDbMock.getDayAspectRatiosByRange.mockResolvedValueOnce([
      { id: 'a', timestamp: localTs(2024, 0, 2, 12), aspectRatio: 1.2 },
      { id: 'b', timestamp: localTs(2024, 0, 2, 11), aspectRatio: 1.8 },
    ]);

    const { api } = mountPagination();
    await flushPromisesAndTicks(2);

    api.isFullyPreloaded.value = false;
    await api.prefetchDayAspectRatios(['2024-0-2']);

    expect(historyDbMock.getDayAspectRatiosByRange).toHaveBeenCalledWith(
      dayOne.minTimestamp,
      dayOne.maxTimestamp,
      { serviceFilter: 'all', searchTerm: '', favoritesOnly: false },
    );
    expect(api.groups.value[0].aspectRatios).toEqual([1.2, 1.8]);
  });
});
