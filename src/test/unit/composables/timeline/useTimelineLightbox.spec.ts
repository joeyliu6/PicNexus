import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { mountWithDefaults } from '../../../helpers/vueMount';
import { createHistoryItem } from '../../../factories/historyFactory';
import { useTimelineLightbox } from '../../../../composables/timeline/useTimelineLightbox';
import type { ImageMeta } from '../../../../types/image-meta';
import type { HistoryItem, ServiceType, UserConfig } from '../../../../config/types';

const warmImagesMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../composables/useLightboxPreloader', () => ({
  useLightboxPreloader: vi.fn(),
}));

vi.mock('../../../../utils/imagePreload', () => ({
  warmImages: warmImagesMock,
}));

vi.mock('../../../../utils/imageUrl', () => ({
  getPrimaryImageUrl: (item: HistoryItem) => item.generatedLink,
}));

vi.mock('../../../../composables/useThumbCache', () => ({
  getMetaThumbnailUrl: (meta: ImageMeta) => `https://thumb.example.com/${meta.id}.jpg`,
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mountedWrappers: VueWrapper[] = [];

function localTs(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month, day, hour, 0, 0, 0).getTime();
}

function makeMeta(id: string, timestamp: number): ImageMeta {
  return {
    id,
    timestamp,
    localFileName: `${id}.jpg`,
    aspectRatio: 1.5,
    primaryService: 'jd' as ServiceType,
    primaryUrl: `https://img.example.com/${id}.jpg`,
  };
}

function makeDetail(id: string): HistoryItem {
  return createHistoryItem({
    id,
    localFileName: `${id}.jpg`,
    generatedLink: `https://large.example.com/${id}.jpg`,
  });
}

function mountLightbox(overrides: Partial<Parameters<typeof useTimelineLightbox>[0]> = {}) {
  const dayOneKey = '2024-0-2';
  const dayTwoKey = '2024-0-1';
  const dayOneItems = [
    makeMeta('day-one-new', localTs(2024, 0, 2, 18)),
    makeMeta('day-one-old', localTs(2024, 0, 2, 8)),
  ];
  const dayTwoItems = [
    makeMeta('day-two-new', localTs(2024, 0, 1, 18)),
  ];
  const dayMetaCache = new Map<string, ImageMeta[]>([
    [dayOneKey, dayOneItems],
    [dayTwoKey, dayTwoItems],
  ]);
  const loadedDayKeys = ref(new Set<string>([dayOneKey]));
  const detailCache = {
    getDetail: vi.fn(async (id: string) => makeDetail(id)),
  };
  const ensureDaysLoaded = vi.fn(async (dayKeys: string[]) => {
    loadedDayKeys.value = new Set([...loadedDayKeys.value, ...dayKeys]);
  });
  const scrollToItem = vi.fn();
  const deleteHistoryItem = vi.fn().mockResolvedValue(true);
  const toast = { success: vi.fn(), error: vi.fn() };

  let api!: ReturnType<typeof useTimelineLightbox>;
  const Harness = defineComponent({
    setup() {
      api = useTimelineLightbox({
        dayMetaCache,
        loadedDayKeys,
        ensureDaysLoaded,
        findDayBefore: (key: string) => (key === dayOneKey ? dayTwoKey : null),
        findDayAfter: (key: string) => (key === dayTwoKey ? dayOneKey : null),
        detailCache,
        config: ref({} as UserConfig),
        deleteHistoryItem,
        scrollToItem,
        toast,
        ...overrides,
      });
      return () => null;
    },
  });

  mountedWrappers.push(mountWithDefaults(Harness));
  return {
    api,
    dayOneKey,
    dayTwoKey,
    dayOneItems,
    dayTwoItems,
    dayMetaCache,
    loadedDayKeys,
    detailCache,
    ensureDaysLoaded,
    scrollToItem,
    deleteHistoryItem,
    toast,
  };
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount();
  }
  vi.clearAllMocks();
});

describe('useTimelineLightbox', () => {
  it('opens a meta item, loads detail, and warms thumbnail plus primary image urls', async () => {
    const { api, dayOneItems, detailCache } = mountLightbox();

    await api.openLightbox(dayOneItems[0]);

    expect(detailCache.getDetail).toHaveBeenCalledWith('day-one-new');
    expect(api.lightboxVisible.value).toBe(true);
    expect(api.lightboxItem.value?.id).toBe('day-one-new');
    expect(api.lightboxHasPrev.value).toBe(false);
    expect(api.lightboxHasNext.value).toBe(true);
    expect(warmImagesMock).toHaveBeenCalledWith([
      'https://thumb.example.com/day-one-new.jpg',
      'https://large.example.com/day-one-new.jpg',
    ]);
  });

  it('navigates within a loaded day before requesting the older day', async () => {
    const { api, dayOneItems, detailCache, scrollToItem } = mountLightbox();
    await api.openLightbox(dayOneItems[0]);

    await api.handleLightboxNavigate('next');

    expect(api.lightboxItem.value?.id).toBe('day-one-old');
    expect(detailCache.getDetail).toHaveBeenLastCalledWith('day-one-old');
    expect(scrollToItem).toHaveBeenLastCalledWith('day-one-old');
    expect(api.lightboxHasPrev.value).toBe(true);
    expect(api.lightboxHasNext.value).toBe(true);
  });

  it('loads the next older day when navigating past the end of the current day', async () => {
    const { api, dayOneItems, ensureDaysLoaded, scrollToItem, loadedDayKeys } = mountLightbox();
    await api.openLightbox(dayOneItems[1]);

    await api.handleLightboxNavigate('next');

    expect(ensureDaysLoaded).toHaveBeenCalledWith(['2024-0-1']);
    expect(loadedDayKeys.value.has('2024-0-1')).toBe(true);
    expect(api.lightboxItem.value?.id).toBe('day-two-new');
    expect(scrollToItem).toHaveBeenLastCalledWith('day-two-new');
    expect(api.lightboxHasPrev.value).toBe(true);
    expect(api.lightboxHasNext.value).toBe(false);
  });

  it('navigates back to the newest loaded day when moving prev across days', async () => {
    const { api, dayTwoItems, loadedDayKeys, scrollToItem } = mountLightbox();
    loadedDayKeys.value = new Set(['2024-0-2', '2024-0-1']);
    await api.openLightbox(dayTwoItems[0]);

    await api.handleLightboxNavigate('prev');

    expect(api.lightboxItem.value?.id).toBe('day-one-old');
    expect(scrollToItem).toHaveBeenLastCalledWith('day-one-old');
    expect(api.lightboxHasPrev.value).toBe(true);
    expect(api.lightboxHasNext.value).toBe(true);
  });

  it('delegates deletion to the shared lightbox core', async () => {
    const { api, dayOneItems, deleteHistoryItem, toast } = mountLightbox();
    await api.openLightbox(dayOneItems[0]);

    await api.handleLightboxDelete(makeDetail('day-one-new'));

    expect(deleteHistoryItem).toHaveBeenCalledWith('day-one-new');
    expect(api.lightboxVisible.value).toBe(false);
    expect(toast.success).toHaveBeenCalled();
  });
});
