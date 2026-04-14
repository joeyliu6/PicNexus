import { describe, it, expect, vi } from 'vitest';
import { ref, computed } from 'vue';
import type { ImageMeta } from '../../../../types/image-meta';
import type { UserConfig } from '../../../../config/types';

vi.mock('../../../../composables/useThumbCache', () => ({
  getMetaThumbnailUrl: (_meta: unknown, _config: unknown) => 'https://thumb.example.com/img.jpg',
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { useTimelineData } from '../../../../composables/timeline/useTimelineData';

const EMPTY_CONFIG = ref({} as UserConfig);

function makeMeta(overrides: Partial<ImageMeta> = {}): ImageMeta {
  return {
    id: 'img-1',
    timestamp: new Date('2024-05-15').getTime(),
    localFileName: 'photo.jpg',
    aspectRatio: 1.5,
    primaryService: 'r2' as import('../../../../config/types').ServiceType,
    primaryUrl: 'https://r2.example.com/photo.jpg',
    ...overrides,
  };
}

function makeOptions(
  metas: ImageMeta[],
  overrides: Partial<Parameters<typeof useTimelineData>[0]> = {}
) {
  return {
    filteredMetas: computed(() => metas),
    favoriteSet: ref(new Set<string>()),
    favoritesOnly: computed(() => false as boolean | undefined),
    selectedIdList: computed(() => [] as string[]),
    config: EMPTY_CONFIG,
    detailCache: { getDetail: vi.fn().mockResolvedValue({}) },
    toggleFavorite: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// ─── groups 分组 ──────────────────────────────────────────────────────────────

describe('groups — 按日期分组', () => {
  it('空 filteredMetas 时返回空分组', () => {
    const { groups } = useTimelineData(makeOptions([]));
    expect(groups.value).toHaveLength(0);
  });

  it('同一天的图片归入同一分组', () => {
    const ts = new Date('2024-05-15').getTime();
    const metas = [makeMeta({ id: 'a', timestamp: ts }), makeMeta({ id: 'b', timestamp: ts + 3600_000 })];
    const { groups } = useTimelineData(makeOptions(metas));
    expect(groups.value).toHaveLength(1);
    expect(groups.value[0].items).toHaveLength(2);
  });

  it('不同天的图片各自分组', () => {
    const metas = [
      makeMeta({ id: 'a', timestamp: new Date('2024-05-15').getTime() }),
      makeMeta({ id: 'b', timestamp: new Date('2024-05-16').getTime() }),
    ];
    const { groups } = useTimelineData(makeOptions(metas));
    expect(groups.value).toHaveLength(2);
  });

  it('分组按日期降序排列（新的在前）', () => {
    const metas = [
      makeMeta({ id: 'old', timestamp: new Date('2024-01-01').getTime() }),
      makeMeta({ id: 'new', timestamp: new Date('2024-12-31').getTime() }),
    ];
    const { groups } = useTimelineData(makeOptions(metas));
    expect(groups.value[0].items[0].id).toBe('new');
    expect(groups.value[1].items[0].id).toBe('old');
  });

  it('分组 label 格式为 N年N月N日', () => {
    const metas = [makeMeta({ timestamp: new Date('2024-05-15').getTime() })];
    const { groups } = useTimelineData(makeOptions(metas));
    expect(groups.value[0].label).toContain('2024年');
    expect(groups.value[0].label).toContain('5月');
    expect(groups.value[0].label).toContain('15日');
  });

  it('favoritesOnly = true 时只显示已收藏的图片', () => {
    const metas = [
      makeMeta({ id: 'fav', timestamp: new Date('2024-05-15').getTime(), isFavorited: true }),
      makeMeta({ id: 'non', timestamp: new Date('2024-05-15').getTime(), isFavorited: false }),
    ];
    const favoriteSet = ref(new Set(['fav']));
    const { groups } = useTimelineData(makeOptions(metas, {
      favoriteSet,
      favoritesOnly: computed(() => true as boolean | undefined),
    }));
    expect(groups.value[0].items).toHaveLength(1);
    expect(groups.value[0].items[0].id).toBe('fav');
  });

  it('favoritesOnly = false 时显示全部图片', () => {
    const metas = [
      makeMeta({ id: 'fav', timestamp: new Date('2024-05-15').getTime() }),
      makeMeta({ id: 'non', timestamp: new Date('2024-05-15').getTime() }),
    ];
    const { groups } = useTimelineData(makeOptions(metas, {
      favoritesOnly: computed(() => false as boolean | undefined),
    }));
    expect(groups.value[0].items).toHaveLength(2);
  });
});

// ─── selectedAvailableServices ────────────────────────────────────────────────

describe('selectedAvailableServices', () => {
  it('无选中项时返回空数组', () => {
    const { selectedAvailableServices } = useTimelineData(makeOptions([makeMeta()]));
    expect(selectedAvailableServices.value).toHaveLength(0);
  });

  it('选中项返回其 primaryService（带 count=1）', () => {
    const metas = [
      makeMeta({ id: 'a', primaryService: 'r2' as import('../../../../config/types').ServiceType }),
    ];
    const { selectedAvailableServices } = useTimelineData(makeOptions(metas, {
      selectedIdList: computed(() => ['a']),
    }));
    expect(selectedAvailableServices.value).toEqual([{ serviceId: 'r2', count: 1 }]);
  });

  it('多个相同图床的选中项合并为一条并累加 count', () => {
    const metas = [
      makeMeta({ id: 'a', primaryService: 'r2' as import('../../../../config/types').ServiceType }),
      makeMeta({ id: 'b', primaryService: 'r2' as import('../../../../config/types').ServiceType }),
    ];
    const { selectedAvailableServices } = useTimelineData(makeOptions(metas, {
      selectedIdList: computed(() => ['a', 'b']),
    }));
    expect(selectedAvailableServices.value).toHaveLength(1);
    expect(selectedAvailableServices.value[0]).toEqual({ serviceId: 'r2', count: 2 });
  });
});

// ─── getThumbnailUrl ──────────────────────────────────────────────────────────

describe('getThumbnailUrl', () => {
  it('返回 getMetaThumbnailUrl 的结果', () => {
    const { getThumbnailUrl } = useTimelineData(makeOptions([]));
    expect(getThumbnailUrl(makeMeta())).toBe('https://thumb.example.com/img.jpg');
  });
});

// ─── handleToggleFavorite ─────────────────────────────────────────────────────

describe('handleToggleFavorite', () => {
  it('传入 id 字符串时调用 toggleFavorite', async () => {
    const toggleFavorite = vi.fn().mockResolvedValue(true);
    const { handleToggleFavorite } = useTimelineData(makeOptions([], { toggleFavorite }));
    await handleToggleFavorite('img-1');
    expect(toggleFavorite).toHaveBeenCalledWith('img-1');
  });

  it('传入 HistoryItem 对象时提取 id 并调用', async () => {
    const toggleFavorite = vi.fn().mockResolvedValue(true);
    const { handleToggleFavorite } = useTimelineData(makeOptions([], { toggleFavorite }));
    await handleToggleFavorite({ id: 'img-2' } as import('../../../../config/types').HistoryItem);
    expect(toggleFavorite).toHaveBeenCalledWith('img-2');
  });

  it('toggleFavorite 抛出异常时不冒泡', async () => {
    const toggleFavorite = vi.fn().mockRejectedValue(new Error('failed'));
    const { handleToggleFavorite } = useTimelineData(makeOptions([], { toggleFavorite }));
    await expect(handleToggleFavorite('x')).resolves.not.toThrow();
  });
});

// ─── handleImageHover ─────────────────────────────────────────────────────────

describe('handleImageHover', () => {
  it('首次悬停时调用 detailCache.getDetail', async () => {
    const getDetail = vi.fn().mockResolvedValue({ id: 'img-1' });
    const { handleImageHover, hoverDetailsMap } = useTimelineData(makeOptions([], {
      detailCache: { getDetail },
    }));
    const meta = makeMeta({ id: 'img-1' });
    await handleImageHover(meta);
    expect(getDetail).toHaveBeenCalledWith('img-1');
    expect(hoverDetailsMap.value.has('img-1')).toBe(true);
  });

  it('已有缓存时不再调用 getDetail', async () => {
    const getDetail = vi.fn().mockResolvedValue({ id: 'img-1' });
    const { handleImageHover } = useTimelineData(makeOptions([], { detailCache: { getDetail } }));
    const meta = makeMeta({ id: 'img-1' });
    await handleImageHover(meta);
    await handleImageHover(meta);
    expect(getDetail).toHaveBeenCalledOnce();
  });

  it('getDetail 失败时不抛出', async () => {
    const getDetail = vi.fn().mockRejectedValue(new Error('DB error'));
    const { handleImageHover } = useTimelineData(makeOptions([], { detailCache: { getDetail } }));
    await expect(handleImageHover(makeMeta({ id: 'x' }))).resolves.not.toThrow();
  });
});
