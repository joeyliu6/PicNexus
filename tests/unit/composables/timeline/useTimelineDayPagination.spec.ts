import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref, type Ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { mountWithDefaults } from '../../helpers/vueMount';
import { flushPromisesAndTicks } from '../../helpers/wait';
import type { ImageMeta } from '@/types/image-meta';
import type { ServiceType } from '@/config/types';
import type { DayStats, DayStatsFilter } from '@/services/database';

const historyDbMock = vi.hoisted(() => ({
  getDayStats: vi.fn(),
  getItemsByDayRange: vi.fn(),
  getDayAspectRatiosByRange: vi.fn(),
  getAllAspectRatios: vi.fn(),
}));

const cacheEventMock = vi.hoisted(() => ({
  onCacheEventType: vi.fn(),
}));

vi.mock('@/services/database', () => ({
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
  firstScreenDays?: (stats: DayStats[]) => string[];
} = {}) {
  const filter: Ref<ServiceType | 'all'> = overrides.filter ?? ref<ServiceType | 'all'>('all');
  const searchTerm: Ref<string> = overrides.searchTerm ?? ref('');
  const favoritesOnly: Ref<boolean> = overrides.favoritesOnly ?? ref(false);
  const visible: Ref<boolean> = overrides.visible ?? ref(true);
  let api!: ReturnType<typeof useTimelineDayPagination>;

  const Harness = defineComponent({
    setup() {
      const query = computed<DayStatsFilter>(() => ({ serviceFilter: filter.value, searchTerm: searchTerm.value, favoritesOnly: favoritesOnly.value }));
      api = useTimelineDayPagination({ filter: query, visible, firstScreenDays: overrides.firstScreenDays });
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
  // 连没用掉的 mockResolvedValueOnce 一起清：一条用例中途失败时，剩下的不能串到下一条
  vi.resetAllMocks();
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

  // 回归：换筛选当场把已读的天清空、按天汇总一到就换上全是骨架的分组——网格先出一帧只有日期标题，
  // 再出整屏灰块，图才出来。新结果要等第一屏那几天的图也读回来，再与按天汇总一起换上
  it('keeps the shown result while a new filter is read, then swaps in its first screen at once', async () => {
    const firstScreenDays = (stats: DayStats[]) => stats.slice(0, 1).map((s) => `${s.year}-${s.month}-${s.day}`);
    historyDbMock.getDayStats.mockResolvedValueOnce([dayStat(2024, 0, 2, 1)]);
    historyDbMock.getItemsByDayRange.mockResolvedValueOnce([makeMeta('old', localTs(2024, 0, 2, 12))]);
    const filter = ref<ServiceType | 'all'>('all');
    const { api } = mountPagination({ filter, firstScreenDays });
    await flushPromisesAndTicks(3);
    const shown = () => api.groups.value.map((g) => [g.id, g.isSkeleton, g.items.map((meta) => meta.id)]);
    expect(shown()).toEqual([['2024-0-2', false, ['old']]]);
    expect(api.isSwitching.value).toBe(false);

    let resolveStats!: (stats: DayStats[]) => void;
    let resolveItems!: (items: ImageMeta[]) => void;
    historyDbMock.getDayStats.mockReturnValueOnce(new Promise((resolve) => { resolveStats = resolve; }));
    historyDbMock.getItemsByDayRange.mockReturnValueOnce(new Promise((resolve) => { resolveItems = resolve; }));
    filter.value = 'weibo' as ServiceType;
    await flushPromisesAndTicks(2);
    expect(api.isSwitching.value).toBe(true);
    expect(shown()).toEqual([['2024-0-2', false, ['old']]]);

    const newDay = dayStat(2024, 0, 3, 2);
    resolveStats([newDay, dayStat(2024, 0, 1, 4)]);
    await flushPromisesAndTicks(2);
    expect(shown()).toEqual([['2024-0-2', false, ['old']]]);
    expect(historyDbMock.getItemsByDayRange).toHaveBeenLastCalledWith(newDay.minTimestamp, newDay.maxTimestamp, expect.objectContaining({ serviceFilter: 'weibo' }));

    resolveItems([makeMeta('new-a', localTs(2024, 0, 3, 14)), makeMeta('new-b', localTs(2024, 0, 3, 10))]);
    await flushPromisesAndTicks(2);
    expect(shown()).toEqual([['2024-0-3', false, ['new-a', 'new-b']], ['2024-0-1', true, []]]);
    expect(api.isSwitching.value).toBe(false);
  });

  // 换筛选还没读完时滚到别的天：按屏幕上这份结果的筛选读，不把新筛选的图塞进旧的天里
  it('reads days scrolled into view during a switch with the filter of the shown result', async () => {
    historyDbMock.getDayStats.mockResolvedValueOnce([dayStat(2024, 0, 2, 1), dayStat(2024, 0, 1, 1)]);
    const filter = ref<ServiceType | 'all'>('all');
    const { api } = mountPagination({ filter });
    await flushPromisesAndTicks(2);

    historyDbMock.getDayStats.mockReturnValueOnce(new Promise(() => {}));
    filter.value = 'weibo' as ServiceType;
    await flushPromisesAndTicks(2);
    historyDbMock.getItemsByDayRange.mockResolvedValueOnce([makeMeta('older', localTs(2024, 0, 1, 12))]);
    await api.ensureDaysLoaded(['2024-0-1']);

    expect(historyDbMock.getItemsByDayRange).toHaveBeenLastCalledWith(expect.any(Number), expect.any(Number), expect.objectContaining({ serviceFilter: 'all' }));
    expect(api.dayMetaCache.get('2024-0-1')?.map((meta) => meta.id)).toEqual(['older']);
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

  // 回归：改用备份 / 重新检测 / 补充备份只改那条记录、不改当天张数，reloadAll 曾按「张数没变」
  // 把整天的旧 meta 原样留着——格子上的 ⚠ 失效、花瓣、悬停「复制」的链接都还是旧的
  it('refreshes the loaded day holding an updated record in place, even when counts are unchanged', async () => {
    const dayOne = dayStat(2024, 0, 2, 1);
    const dayTwo = dayStat(2024, 0, 1, 1);
    historyDbMock.getDayStats.mockResolvedValue([dayOne, dayTwo]);
    const { api } = mountPagination();
    await flushPromisesAndTicks(2);

    historyDbMock.getItemsByDayRange.mockResolvedValueOnce([
      makeMeta('switched', localTs(2024, 0, 2, 12)),
      makeMeta('untouched', localTs(2024, 0, 1, 12)),
    ]);
    await api.ensureDaysLoaded(['2024-0-2', '2024-0-1']);

    const onUpdated = cacheEventMock.onCacheEventType.mock.calls.find(([type]) => type === 'history-updated')![1];
    historyDbMock.getItemsByDayRange.mockResolvedValueOnce([
      makeMeta('switched', localTs(2024, 0, 2, 12), { primaryService: 'r2' as ServiceType, primaryUrl: 'https://r2.example.com/switched.jpg' }),
    ]);
    onUpdated({ ids: ['switched'] });
    await flushPromisesAndTicks(4);

    expect(historyDbMock.getItemsByDayRange).toHaveBeenLastCalledWith(dayOne.minTimestamp, dayOne.maxTimestamp, expect.anything());
    expect(api.dayMetaCache.get('2024-0-2')?.[0].primaryService).toBe('r2');
    // 原地换新：那一天不退回骨架，别的天不动
    expect(api.loadedDayKeys.value.has('2024-0-2')).toBe(true);
    expect(api.dayMetaCache.get('2024-0-1')?.[0].id).toBe('untouched');
  });

  // 回归：图库开着时上传一张，今天那一天张数变了，整天先退回骨架（一整行灰块）再补读。
  // 张数变了的已读天要留着旧格子，新记录读回来再与新的按天汇总一起换上
  it('keeps a loaded day whose count changed on screen until its records are read again', async () => {
    const firstScreenDays = (stats: DayStats[]) => stats.slice(0, 1).map((s) => `${s.year}-${s.month}-${s.day}`);
    historyDbMock.getDayStats.mockResolvedValueOnce([dayStat(2024, 0, 2, 1), dayStat(2024, 0, 1, 1)]);
    historyDbMock.getItemsByDayRange.mockResolvedValueOnce([makeMeta('old', localTs(2024, 0, 2, 12))]);
    const { api } = mountPagination({ firstScreenDays });
    await flushPromisesAndTicks(3);
    const shown = () => api.groups.value.map((g) => [g.id, g.isSkeleton, g.items.map((meta) => meta.id)]);
    expect(shown()).toEqual([['2024-0-2', false, ['old']], ['2024-0-1', true, []]]);

    let resolveItems!: (items: ImageMeta[]) => void;
    historyDbMock.getDayStats.mockResolvedValueOnce([dayStat(2024, 0, 2, 2), dayStat(2024, 0, 1, 1)]);
    historyDbMock.getItemsByDayRange.mockReturnValueOnce(new Promise((resolve) => { resolveItems = resolve; }));
    const onUpdated = cacheEventMock.onCacheEventType.mock.calls.find(([type]) => type === 'history-updated')![1];
    onUpdated({ ids: ['uploaded'] });
    await flushPromisesAndTicks(3);
    expect(shown()).toEqual([['2024-0-2', false, ['old']], ['2024-0-1', true, []]]);

    resolveItems([makeMeta('uploaded', localTs(2024, 0, 2, 18)), makeMeta('old', localTs(2024, 0, 2, 12))]);
    await flushPromisesAndTicks(3);
    expect(shown()).toEqual([['2024-0-2', false, ['uploaded', 'old']], ['2024-0-1', true, []]]);
    expect(api.groups.value[0].expectedCount).toBe(2);
  });

  // 当天第一次上传：新的一天出现在最上面，读回来再换上，不先画成一行灰块
  it('reads a new day at the top of the first screen before swapping it in', async () => {
    const firstScreenDays = (stats: DayStats[]) => stats.slice(0, 2).map((s) => `${s.year}-${s.month}-${s.day}`);
    historyDbMock.getDayStats.mockResolvedValueOnce([dayStat(2024, 0, 1, 1)]);
    historyDbMock.getItemsByDayRange.mockResolvedValueOnce([makeMeta('yesterday', localTs(2024, 0, 1, 12))]);
    const { api } = mountPagination({ firstScreenDays });
    await flushPromisesAndTicks(3);

    historyDbMock.getDayStats.mockResolvedValueOnce([dayStat(2024, 0, 2, 1), dayStat(2024, 0, 1, 1)]);
    historyDbMock.getItemsByDayRange.mockResolvedValueOnce([makeMeta('today', localTs(2024, 0, 2, 9))]);
    const onUpdated = cacheEventMock.onCacheEventType.mock.calls.find(([type]) => type === 'history-updated')![1];
    onUpdated({ ids: ['today'] });
    await flushPromisesAndTicks(3);

    expect(api.groups.value.map((g) => [g.id, g.isSkeleton, g.items.map((meta) => meta.id)])).toEqual([
      ['2024-0-2', false, ['today']],
      ['2024-0-1', false, ['yesterday']],
    ]);
  });

  it('reloads when a gallery filter changes, but not for an equal filter object', async () => {
    const query = ref<DayStatsFilter>({ statusFilter: ['dead'] });
    let api!: ReturnType<typeof useTimelineDayPagination>;
    mountedWrappers.push(mountWithDefaults(defineComponent({
      setup() { api = useTimelineDayPagination({ filter: query, visible: ref(true) }); return () => null; },
    })));
    await flushPromisesAndTicks(2);
    expect(historyDbMock.getDayStats).toHaveBeenCalledTimes(1);

    query.value = { statusFilter: ['dead'] };
    await flushPromisesAndTicks(2);
    expect(historyDbMock.getDayStats).toHaveBeenCalledTimes(1);

    query.value = { statusFilter: ['dead', 'limited'], since: 1 };
    await flushPromisesAndTicks(2);
    expect(historyDbMock.getDayStats).toHaveBeenLastCalledWith({ statusFilter: ['dead', 'limited'], since: 1 });
    expect(api.hasLoadedStats.value).toBe(true);
  });
});
