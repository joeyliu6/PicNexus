import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS, countText, filterButtons, filterChips, toQueryFilter, type GalleryFilters,
} from '@/views/gallery/galleryFilters';

// 交接说明 8.2 + GalleryScreen.dc.html：条件显示为可单独移除的小标签 +「清除全部」；
// 生效的筛选按钮变实底并写出取值；计数从「共 12,483 张」变「找到 4 张」。

const names = (id: string) => ({ weibo: '微博', jd: '京东' }[id] ?? id);
const NOW = new Date(2026, 9, 16, 10, 30).getTime();

const filtered: GalleryFilters = {
  ...EMPTY_FILTERS,
  host: 'weibo',
  favoritesOnly: true,
  status: ['dead', 'limited'],
};

describe('gallery filters', () => {
  it('writes each active filter as a removable chip, in the design order', () => {
    expect(filterChips(filtered, names).map((chip) => chip.label)).toEqual(['图床：微博', '收藏', '状态：失效、可能受限']);
    expect(filterChips({ ...EMPTY_FILTERS, search: '发布会-2019', time: 'week' }, names).map((chip) => chip.label))
      .toEqual(['「发布会-2019」', '时间：最近 7 天']);
  });

  it('removes exactly the filter behind a chip', () => {
    const chips = filterChips(filtered, names);
    expect(chips[2].remove(filtered)).toEqual({ ...filtered, status: [] });
    expect(chips[0].remove(filtered)).toEqual({ ...filtered, host: null });
  });

  it('names the value on an active button and keeps idle ones plain', () => {
    expect(filterButtons(filtered, names)).toEqual([
      { key: 'host', label: '图床 · 微博', active: true },
      { key: 'favorites', label: '★ 收藏', active: true },
      { key: 'status', label: '状态 · 2 项', active: true },
      { key: 'time', label: '时间', active: false },
    ]);
    expect(filterButtons({ ...EMPTY_FILTERS, status: ['dead'] }, names)[2].label).toBe('状态 · 失效');
  });

  it('counts all images until something filters them', () => {
    expect(countText(EMPTY_FILTERS, 12483, false)).toBe('共 12,483 张');
    expect(countText(filtered, 4, false)).toBe('找到 4 张');
    expect(countText(filtered, 4, true)).toBe('正在读取…');
  });

  it('turns the picks into a database filter, the time presets counted from now', () => {
    expect(toQueryFilter(filtered, NOW)).toEqual({
      hostFilter: 'weibo', favoritesOnly: true, statusFilter: ['dead', 'limited'], since: undefined, searchTerm: '',
    });
    expect(toQueryFilter({ ...EMPTY_FILTERS, time: 'week' }, NOW).since).toBe(NOW - 7 * 86_400_000);
    expect(toQueryFilter({ ...EMPTY_FILTERS, time: 'year' }, NOW).since).toBe(new Date(2026, 0, 1).getTime());
  });
});
