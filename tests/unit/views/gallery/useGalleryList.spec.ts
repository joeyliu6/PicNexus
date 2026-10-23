import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import type { DayStatsFilter } from '@/services/database/types';
import type { GalleryListRow, GalleryListSort } from '@/services/database/TimelineQueryService';
import { mountWithDefaults } from '../../helpers/vueMount';

const m = vi.hoisted(() => ({
  getListPage: vi.fn(),
  handlers: new Map<string, () => void>(),
}));
vi.mock('@/services/database', () => ({ historyDB: { getListPage: m.getListPage } }));
vi.mock('@/events/cacheEvents', () => ({
  onCacheEventType: async (type: string, handler: () => void) => { m.handlers.set(type, handler); return () => {}; },
}));
vi.mock('@/utils/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const { useGalleryList } = await import('@/views/gallery/useGalleryList');

const row = (id: string) => ({ id, localFileName: `${id}.png`, timestamp: 1 }) as unknown as GalleryListRow;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 下一次 getListPage 先挂着，返回放行的函数 */
function holdNextPage(): (rows: GalleryListRow[]) => void {
  let release!: (rows: GalleryListRow[]) => void;
  m.getListPage.mockReturnValueOnce(new Promise<GalleryListRow[]>((resolve) => { release = resolve; }));
  return release;
}

function mountList(first: GalleryListRow[]) {
  m.getListPage.mockResolvedValueOnce(first);
  const filter = ref<DayStatsFilter>({});
  const sort = ref<GalleryListSort>({ key: 'time', descending: true });
  const total = ref(first.length);
  const pending = ref(false);
  let api!: ReturnType<typeof useGalleryList>;
  mountWithDefaults(defineComponent({
    setup() {
      api = useGalleryList(filter, sort, { total, pending });
      return () => null;
    },
  }));
  const ids = () => [0, 1, 2].map((index) => api.rowAt(index)?.id ?? null);
  return { api, filter, sort, total, pending, ids };
}

beforeEach(() => {
  m.getListPage.mockReset();
  m.handlers.clear();
});

// LoadingRules ①「切换直接显示内容」：列表换排序 / 筛选、记录有变化时，屏幕上的行不先变成骨架条
describe('gallery list', () => {
  it('keeps the shown rows while a new sort is read, then swaps in its first page at once', async () => {
    const { api, sort, ids } = mountList([row('a'), row('b')]);
    await flush();
    expect(ids()).toEqual(['a', 'b', null]);
    expect(api.isSwitching.value).toBe(false);

    const release = holdNextPage();
    sort.value = { key: 'name', descending: false };
    await flush();
    expect(ids()).toEqual(['a', 'b', null]);
    expect(api.isSwitching.value).toBe(true);

    release([row('b'), row('a')]);
    await flush();
    expect(ids()).toEqual(['b', 'a', null]);
    expect(api.isSwitching.value).toBe(false);
    expect(m.getListPage).toHaveBeenLastCalledWith({}, { key: 'name', descending: false }, 0, 100);
  });

  // 换筛选：总数来自网格（同一份筛选的按天统计），网格还在读的时候新行先不换，换上时行与总数同一刻
  it('swaps in a new filter only together with its total', async () => {
    const { api, filter, total, pending, ids } = mountList([row('a'), row('b')]);
    await flush();
    expect(api.total.value).toBe(2);

    m.getListPage.mockResolvedValueOnce([row('fav')]);
    pending.value = true;
    filter.value = { favoritesOnly: true };
    await flush();
    expect(ids()).toEqual(['a', 'b', null]);
    expect(api.total.value).toBe(2);

    total.value = 1;
    pending.value = false;
    await flush();
    expect(ids()).toEqual(['fav', null, null]);
    expect(api.total.value).toBe(1);
  });

  // 上传、移除等记录变化：屏幕上的那几页留着，重读回来原地换；总数也等它们一起换
  it('re-reads the rows on screen when records change, keeping them meanwhile', async () => {
    const { api, total, ids } = mountList([row('a'), row('b')]);
    await flush();
    api.ensureVisible([0, 1]);

    const release = holdNextPage();
    total.value = 3;
    m.handlers.get('history-updated')!();
    await flush();
    expect(ids()).toEqual(['a', 'b', null]);
    expect(api.total.value).toBe(2);

    release([row('new'), row('a'), row('b')]);
    await flush();
    expect(ids()).toEqual(['new', 'a', 'b']);
    expect(api.total.value).toBe(3);
  });
});
