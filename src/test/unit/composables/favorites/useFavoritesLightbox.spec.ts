import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { ServiceType } from '../../../../config/types';

const {
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
  }),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { useFavoritesLightbox } = await import('../../../../composables/favorites/useFavoritesLightbox');

function makeMeta(id: string) {
  return {
    id,
    timestamp: 1000,
    localFileName: `${id}.png`,
    aspectRatio: 1,
    primaryService: 'weibo' as ServiceType,
    primaryUrl: `https://img.example.com/${id}.png`,
  };
}

function makeDetail(id: string) {
  return {
    id,
    timestamp: 1000,
    localFileName: `${id}.png`,
    primaryService: 'weibo' as ServiceType,
    results: [],
    generatedLink: `https://img.example.com/${id}.png`,
  };
}

describe('useFavoritesLightbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the lightbox with the resolved item detail and exposes navigation state', async () => {
    const favoriteMetas = ref([makeMeta('alpha'), makeMeta('beta')]);
    const getDetail = vi.fn().mockResolvedValue(makeDetail('alpha'));
    const lightbox = useFavoritesLightbox({
      favoriteMetas,
      getDetail,
      deleteHistoryItem: vi.fn(),
    });

    await lightbox.openLightbox(favoriteMetas.value[0] as never);

    expect(getDetail).toHaveBeenCalledWith('alpha');
    expect(lightbox.lightboxVisible.value).toBe(true);
    expect(lightbox.lightboxItem.value?.id).toBe('alpha');
    expect(lightbox.lightboxHasPrev.value).toBe(false);
    expect(lightbox.lightboxHasNext.value).toBe(true);
  });

  it('shows an error toast when opening the lightbox detail fails', async () => {
    const favoriteMetas = ref([makeMeta('alpha')]);
    const getDetail = vi.fn().mockRejectedValue(new Error('missing'));
    const lightbox = useFavoritesLightbox({
      favoriteMetas,
      getDetail,
      deleteHistoryItem: vi.fn(),
    });

    await lightbox.openLightbox(favoriteMetas.value[0] as never);

    expect(lightbox.lightboxVisible.value).toBe(false);
    expect(lightbox.lightboxItem.value).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith('加载失败', 'Error: missing');
  });

  it('prefetches near the end while still navigating to the next already-loaded item', async () => {
    const favoriteMetas = ref([makeMeta('alpha'), makeMeta('beta'), makeMeta('gamma'), makeMeta('delta')]);
    const getDetail = vi.fn()
      .mockResolvedValueOnce(makeDetail('beta'))
      .mockResolvedValueOnce(makeDetail('gamma'));
    const loadNext = vi.fn().mockResolvedValue(undefined);

    const lightbox = useFavoritesLightbox({
      favoriteMetas,
      getDetail,
      deleteHistoryItem: vi.fn(),
      hasMore: ref(true),
      loadNext,
    });

    await lightbox.openLightbox(favoriteMetas.value[1] as never);
    await lightbox.handleLightboxNavigate('next');

    expect(loadNext).toHaveBeenCalledTimes(1);
    expect(getDetail).toHaveBeenLastCalledWith('gamma');
    expect(lightbox.lightboxItem.value?.id).toBe('gamma');
  });

  it('loads the next page before navigating when the next favorite has not been loaded yet', async () => {
    const favoriteMetas = ref([makeMeta('alpha')]);
    const hasMore = ref(true);
    const getDetail = vi.fn()
      .mockResolvedValueOnce(makeDetail('alpha'))
      .mockResolvedValueOnce(makeDetail('beta'));
    const loadNext = vi.fn(async () => {
      favoriteMetas.value = [...favoriteMetas.value, makeMeta('beta')];
      hasMore.value = false;
    });

    const lightbox = useFavoritesLightbox({
      favoriteMetas,
      getDetail,
      deleteHistoryItem: vi.fn(),
      hasMore,
      loadNext,
    });

    await lightbox.openLightbox(favoriteMetas.value[0] as never);
    expect(lightbox.lightboxHasNext.value).toBe(true);

    await lightbox.handleLightboxNavigate('next');

    expect(loadNext).toHaveBeenCalledTimes(1);
    expect(getDetail).toHaveBeenLastCalledWith('beta');
    expect(lightbox.lightboxItem.value?.id).toBe('beta');
  });

  it('deletes the current item, closes the lightbox and shows a success toast', async () => {
    const favoriteMetas = ref([makeMeta('alpha')]);
    const deleteHistoryItem = vi.fn().mockResolvedValue(true);
    const lightbox = useFavoritesLightbox({
      favoriteMetas,
      getDetail: vi.fn().mockResolvedValue(makeDetail('alpha')),
      deleteHistoryItem,
    });

    await lightbox.openLightbox(favoriteMetas.value[0] as never);
    await lightbox.handleLightboxDelete(lightbox.lightboxItem.value! as never);

    expect(deleteHistoryItem).toHaveBeenCalledWith('alpha');
    expect(lightbox.lightboxVisible.value).toBe(false);
    expect(toastSuccessMock).toHaveBeenCalledWith('已删除');
  });

  it('keeps the lightbox open and skips success feedback when deletion is cancelled', async () => {
    const favoriteMetas = ref([makeMeta('alpha')]);
    const deleteHistoryItem = vi.fn().mockResolvedValue(false);
    const lightbox = useFavoritesLightbox({
      favoriteMetas,
      getDetail: vi.fn().mockResolvedValue(makeDetail('alpha')),
      deleteHistoryItem,
    });

    await lightbox.openLightbox(favoriteMetas.value[0] as never);
    await lightbox.handleLightboxDelete(lightbox.lightboxItem.value! as never);

    expect(deleteHistoryItem).toHaveBeenCalledWith('alpha');
    expect(lightbox.lightboxVisible.value).toBe(true);
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
