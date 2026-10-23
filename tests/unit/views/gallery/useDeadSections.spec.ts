import { describe, expect, it, vi, beforeEach } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import type { DayStatsFilter } from '@/services/database/types';
import type { ImageMeta } from '@/types/image-meta';
import { mountWithDefaults } from '../../helpers/vueMount';

const m = vi.hoisted(() => ({
  getItemsByDayRange: vi.fn(),
  handlers: new Map<string, () => void>(),
}));
vi.mock('@/services/database', () => ({ historyDB: { getItemsByDayRange: m.getItemsByDayRange } }));
vi.mock('@/events/cacheEvents', () => ({
  onCacheEventType: async (type: string, handler: () => void) => { m.handlers.set(type, handler); return () => {}; },
}));
vi.mock('@/utils/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const { isDeadOnly, useDeadSections } = await import('@/views/gallery/useDeadSections');

const meta = (id: string) => ({ id, timestamp: 1, localFileName: `${id}.png`, aspectRatio: 1 }) as ImageMeta;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function mountSections(filter: DayStatsFilter, backups: Record<'available' | 'none', ImageMeta[]>) {
  m.getItemsByDayRange.mockImplementation(async (_from: number, _to: number, f: DayStatsFilter) => backups[f.backup!]);
  const filterRef = ref(filter);
  const enabled = ref(true);
  let api!: ReturnType<typeof useDeadSections>;
  mountWithDefaults(defineComponent({
    setup() {
      api = useDeadSections(filterRef, enabled);
      return () => null;
    },
  }));
  return { api, filterRef, enabled };
}

beforeEach(() => {
  m.getItemsByDayRange.mockReset();
  m.handlers.clear();
});

// 待拍板 ①（选 B）+ GalleryScreen.dc.html G06 / G07：按「失效」筛选时不按天分，
// 分「失效 · 有可用备份」「失效 · 无可用备份」两组，组名旁写张数
describe('dead sections', () => {
  it('only takes over when 失效 is the one status picked', () => {
    expect(isDeadOnly({ statusFilter: ['dead'], hostFilter: 'weibo' })).toBe(true);
    expect(isDeadOnly({ statusFilter: ['dead', 'limited'] })).toBe(false);
    expect(isDeadOnly({ statusFilter: [] })).toBe(false);
    expect(isDeadOnly({})).toBe(false);
  });

  it('groups the dead images by whether a backup is usable, keeping the other filters', async () => {
    const { api } = mountSections({ statusFilter: ['dead'], hostFilter: 'weibo' }, {
      available: [meta('a'), meta('b')],
      none: [meta('c')],
    });
    await flush();

    expect(m.getItemsByDayRange).toHaveBeenCalledWith(0, Number.MAX_SAFE_INTEGER, { statusFilter: ['dead'], hostFilter: 'weibo', backup: 'available' });
    expect(api.groups.value.map((g) => [g.heading, g.items.map((i) => i.id)])).toEqual([
      [{ title: '失效 · 有可用备份', sub: '2 张' }, ['a', 'b']],
      [{ title: '失效 · 无可用备份', sub: '1 张' }, ['c']],
    ]);
    expect(api.items.value.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(api.total.value).toBe(3);
    expect(api.hasLoaded.value).toBe(true);
  });

  it('leaves out a group with nothing in it and writes big counts with separators', async () => {
    const many = Array.from({ length: 1206 }, (_, i) => meta(`x${i}`));
    const { api } = mountSections({ statusFilter: ['dead'] }, { available: [], none: many });
    await flush();
    expect(api.groups.value.map((g) => g.heading)).toEqual([{ title: '失效 · 无可用备份', sub: '1,206 张' }]);
  });

  // 换筛选时网格留着眼前这两组，直到按新筛选读好才换（只认按眼前这份筛选读出来的）
  it('is ready only with the groups read for the current filter', async () => {
    const { api, filterRef } = mountSections({ statusFilter: ['dead'] }, { available: [meta('a')], none: [] });
    expect(api.isReady.value).toBe(false);
    await flush();
    expect(api.isReady.value).toBe(true);

    filterRef.value = { statusFilter: ['dead'], favoritesOnly: true };
    expect(api.isReady.value).toBe(false);
    expect(api.groups.value.map((g) => g.items.map((i) => i.id))).toEqual([['a']]);
    await flush();
    expect(api.isReady.value).toBe(true);
  });

  it('reads again when the records change, and stays idle while another filter is on', async () => {
    const { api, enabled } = mountSections({ statusFilter: ['dead'] }, { available: [meta('a')], none: [] });
    await flush();
    expect(m.getItemsByDayRange).toHaveBeenCalledTimes(2);

    m.getItemsByDayRange.mockImplementation(async () => []);
    m.handlers.get('history-updated')!();
    await flush();
    expect(api.groups.value).toEqual([]);

    enabled.value = false;
    await nextTick();
    m.getItemsByDayRange.mockClear();
    m.handlers.get('history-updated')!();
    await flush();
    expect(m.getItemsByDayRange).not.toHaveBeenCalled();
    expect(api.hasLoaded.value).toBe(false);
  });
});
