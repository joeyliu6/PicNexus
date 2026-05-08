import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import type PopoverType from 'primevue/popover';
import { getClipboardMocks } from '../../../helpers/tauriMock';
import type { HistoryItem } from '../../../../config/types';

const {
  warmImagesMock,
  toggleFavoriteMock,
  loadStatsMock,
  deleteHistoryItemMock,
  toastSuccessMock,
  toastWarnMock,
  toastErrorMock,
  toastSilentMock,
  lightboxPreloaderMock,
  isStatsLoadedRef,
} = vi.hoisted(() => ({
  warmImagesMock: vi.fn(),
  toggleFavoriteMock: vi.fn(),
  loadStatsMock: vi.fn(),
  deleteHistoryItemMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastWarnMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSilentMock: vi.fn(),
  lightboxPreloaderMock: vi.fn(),
  isStatsLoadedRef: { value: true },
}));
const writeTextMock = getClipboardMocks().writeText;
type ServicePopoverRef = Ref<InstanceType<typeof PopoverType> | null>;

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    warn: toastWarnMock,
    error: toastErrorMock,
    silent: toastSilentMock,
  }),
}));

vi.mock('../../../../composables/useConfig', () => ({
  useConfigManager: () => ({
    config: ref({}),
    getActivePrefix: vi.fn(),
  }),
}));

vi.mock('../../../../composables/useHistory', () => ({
  useHistoryManager: () => ({
    favoriteSet: ref(new Set<string>()),
    isStatsLoaded: isStatsLoadedRef,
    loadStats: loadStatsMock,
    toggleFavorite: toggleFavoriteMock,
  }),
}));

vi.mock('../../../../composables/useHistoryViewState', () => ({
  useHistoryViewState: () => ({
    deleteHistoryItem: deleteHistoryItemMock,
  }),
}));

vi.mock('../../../../composables/useThumbCache', () => ({
  useThumbCache: () => ({
    getMediumImageUrl: () => 'https://example.com/medium.jpg',
  }),
}));

vi.mock('../../../../composables/useLightboxPreloader', () => ({
  useLightboxPreloader: lightboxPreloaderMock,
}));

vi.mock('../../../../utils/imageUrl', () => ({
  getPrimaryImageUrl: () => 'https://example.com/full.jpg',
}));

vi.mock('../../../../utils/imagePreload', () => ({
  warmImages: warmImagesMock,
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
  }),
}));

const { useTableInteractions } = await import('../../../../composables/history/useTableInteractions');

beforeEach(() => {
  writeTextMock.mockReset();
  writeTextMock.mockResolvedValue(undefined);
  isStatsLoadedRef.value = true;
});

function makeItem(id = 'item-1'): HistoryItem {
  return {
    id,
    timestamp: 1710000000000,
    localFileName: 'demo.jpg',
    filePath: '/tmp/demo.jpg',
    primaryService: 'jd',
    generatedLink: 'https://example.com/full.jpg',
    results: [],
    width: 1200,
    height: 800,
    aspectRatio: 1.5,
    fileSize: 1024,
    format: 'jpg',
  };
}

function mockRect(el: HTMLElement, rect: Partial<DOMRect>) {
  const fullRect = {
    left: 0,
    top: 0,
    right: 36,
    bottom: 36,
    width: 36,
    height: 36,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect;
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => fullRect,
  });
}

function appendSourceThumb(itemId: string, parent: HTMLElement = document.body) {
  const wrapper = document.createElement('div');
  wrapper.className = 'thumb-preview-wrapper';
  mockRect(wrapper, { left: 0, top: 0, right: 36, bottom: 36, width: 36, height: 36 });

  const thumb = document.createElement('div');
  thumb.className = 'thumb-box';
  thumb.dataset.lightboxId = itemId;
  wrapper.appendChild(thumb);
  parent.appendChild(wrapper);
  return wrapper;
}

function mountHarness(
  item = makeItem(),
  options: {
    currentPageData?: Ref<HistoryItem[]>;
    currentPage?: Ref<number>;
    totalPages?: Ref<number>;
    goToPage?: (pageNumber: number) => Promise<void>;
    peekPage?: (pageNumber: number) => Promise<{ items: HistoryItem[]; total: number }>;
    servicePopoverRef?: ServicePopoverRef;
  } = {},
) {
  let api: ReturnType<typeof useTableInteractions> | null = null;
  const currentPageData = options.currentPageData ?? ref([item]) as Ref<HistoryItem[]>;
  const currentPage = options.currentPage ?? ref(1);
  const totalPages = options.totalPages ?? ref(1);
  const goToPage = options.goToPage ?? vi.fn().mockResolvedValue(undefined);
  const peekPage = options.peekPage ?? vi.fn(async () => ({
    items: currentPageData.value,
    total: currentPageData.value.length,
  }));
  const servicePopoverRef = options.servicePopoverRef ?? ref(null) as ServicePopoverRef;

  const Harness = defineComponent({
    setup() {
      api = useTableInteractions({
        currentPageData,
        currentPage,
        totalPages,
        goToPage,
        peekPage,
        servicePopoverRef,
      });
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  return {
    wrapper,
    api: () => api!,
  };
}

describe('useTableInteractions lightbox close preview motion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  it('starts the close preview state immediately and removes the preview after the overlapped close window', async () => {
    const item = makeItem();
    const source = appendSourceThumb(item.id);
    const harness = mountHarness(item);

    harness.api().handlePreviewEnter({ currentTarget: source } as unknown as MouseEvent, item);
    expect(harness.api().hoverPreview.value.visible).toBe(true);

    harness.api().openLightbox(item, { clientX: 200, clientY: 200 } as MouseEvent);
    await nextTick();
    expect(harness.api().resolveLightboxCloseTargetMode()).toBe('thumb');
    expect(harness.api().hoverPreview.value.closing).toBe(true);

    harness.api().lightboxVisible.value = false;
    await nextTick();

    expect(harness.api().hoverPreview.value.closing).toBe(true);
    expect(harness.api().hoverPreview.value.visible).toBe(true);

    await vi.advanceTimersByTimeAsync(299);
    expect(harness.api().hoverPreview.value.visible).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.api().hoverPreview.value.visible).toBe(false);
  });

  it('keeps the preview DOM for close bounds but hides it when the mouse is still over the source thumb', async () => {
    const item = makeItem();
    const source = appendSourceThumb(item.id);
    const harness = mountHarness(item);

    harness.api().handlePreviewEnter({ currentTarget: source } as unknown as MouseEvent, item);
    harness.api().openLightbox(item, { clientX: 12, clientY: 12 } as MouseEvent);
    await nextTick();
    expect(harness.api().resolveLightboxCloseTargetMode()).toBe('preview');
    expect(harness.api().hoverPreview.value.closing).toBe(true);

    harness.api().lightboxVisible.value = false;
    await nextTick();

    expect(harness.api().hoverPreview.value.closing).toBe(true);
    expect(harness.api().hoverPreview.value.visible).toBe(true);

    await vi.advanceTimersByTimeAsync(300);
    expect(harness.api().hoverPreview.value.visible).toBe(true);
    expect(harness.api().hoverPreview.value.closing).toBe(false);

    harness.api().handlePreviewLeave();
    expect(harness.api().hoverPreview.value.visible).toBe(false);
  });

  it('dismisses the retained preview when the pointer leaves during the close handoff', async () => {
    const item = makeItem();
    const source = appendSourceThumb(item.id);
    const harness = mountHarness(item);

    harness.api().handlePreviewEnter({ currentTarget: source } as unknown as MouseEvent, item);
    harness.api().openLightbox(item, { clientX: 12, clientY: 12 } as MouseEvent);
    await nextTick();
    expect(harness.api().resolveLightboxCloseTargetMode()).toBe('preview');

    harness.api().lightboxVisible.value = false;
    await nextTick();
    expect(harness.api().hoverPreview.value.visible).toBe(true);
    expect(harness.api().hoverPreview.value.closing).toBe(true);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200 }));

    expect(harness.api().hoverPreview.value.visible).toBe(true);
    expect(harness.api().hoverPreview.value.closing).toBe(true);

    await vi.advanceTimersByTimeAsync(300);
    expect(harness.api().hoverPreview.value.visible).toBe(false);
  });
});

describe('useTableInteractions lightbox cross-page tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('resolves adjacent preload URLs within the page, across pages, and at boundaries', async () => {
    const prevItem = makeItem('page-1-last');
    const firstItem = makeItem('page-2-first');
    const secondItem = makeItem('page-2-second');
    const nextItem = makeItem('page-3-first');
    const currentPageData = ref([firstItem, secondItem]) as Ref<HistoryItem[]>;
    const currentPage = ref(2);
    const peekPage = vi.fn(async (pageNumber: number) => ({
      items: pageNumber === 1 ? [prevItem] : [nextItem],
      total: 1,
    }));
    const harness = mountHarness(firstItem, {
      currentPageData,
      currentPage,
      totalPages: ref(3),
      peekPage,
    });
    const preloaderOptions = lightboxPreloaderMock.mock.calls.at(-1)![0] as {
      resolveAdjacentUrl: (direction: 'prev' | 'next') => Promise<string | null>;
    };

    harness.api().openLightbox(firstItem);
    expect(await preloaderOptions.resolveAdjacentUrl('next')).toBe('https://example.com/full.jpg');
    expect(peekPage).not.toHaveBeenCalled();

    expect(await preloaderOptions.resolveAdjacentUrl('prev')).toBe('https://example.com/full.jpg');
    expect(peekPage).toHaveBeenCalledWith(1);

    harness.api().openLightbox(secondItem);
    expect(await preloaderOptions.resolveAdjacentUrl('next')).toBe('https://example.com/full.jpg');
    expect(peekPage).toHaveBeenCalledWith(3);

    currentPage.value = 1;
    currentPageData.value = [firstItem];
    harness.api().openLightbox(firstItem);
    expect(await preloaderOptions.resolveAdjacentUrl('prev')).toBeNull();

    currentPage.value = 3;
    harness.api().openLightbox(firstItem);
    expect(await preloaderOptions.resolveAdjacentUrl('next')).toBeNull();
  });

  it('moves to the previous item and keeps the current item when the crossed page is empty', async () => {
    const firstItem = makeItem('page-2-first');
    const secondItem = makeItem('page-2-second');
    const peekPage = vi.fn().mockResolvedValue({
      items: [],
      total: 0,
    });
    const harness = mountHarness(secondItem, {
      currentPageData: ref([firstItem, secondItem]) as Ref<HistoryItem[]>,
      currentPage: ref(2),
      totalPages: ref(2),
      peekPage,
    });

    harness.api().openLightbox(secondItem);
    expect(harness.api().lightboxHasPrev.value).toBe(true);
    expect(harness.api().lightboxHasNext.value).toBe(false);

    await harness.api().handleLightboxNavigate('prev');
    expect(harness.api().lightboxItem.value?.id).toBe(firstItem.id);
    expect(peekPage).not.toHaveBeenCalled();

    await harness.api().handleLightboxNavigate('prev');
    expect(peekPage).toHaveBeenCalledWith(1);
    expect(harness.api().lightboxItem.value?.id).toBe(firstItem.id);
  });

  it('lands on a prefetched crossed-page item before syncing the table page', async () => {
    const lastItem = makeItem('page-1-last');
    const nextItem = makeItem('page-2-first');
    const currentPageData = ref([lastItem]) as Ref<HistoryItem[]>;
    const currentPage = ref(1);
    const goToPage = vi.fn(async (pageNumber: number) => {
      currentPage.value = pageNumber;
      currentPageData.value = [nextItem];
    });
    const targetWrapper = appendSourceThumb(nextItem.id);
    const scrollIntoView = vi.fn();
    Object.defineProperty(targetWrapper, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const peekPage = vi.fn().mockResolvedValue({
      items: [nextItem],
      total: 2,
    });
    const harness = mountHarness(lastItem, {
      currentPageData,
      currentPage,
      totalPages: ref(2),
      goToPage,
      peekPage,
    });

    harness.api().openLightbox(lastItem);
    await harness.api().handleLightboxNavigate('next');

    expect(peekPage).toHaveBeenCalledWith(2);
    expect(goToPage).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(harness.api().lightboxItem.value?.id).toBe(nextItem.id);
  });

  it('uses the history scroll container instead of document scrolling when available', async () => {
    const firstItem = makeItem('page-item-1');
    const secondItem = makeItem('page-item-2');
    const historyContainer = document.createElement('div');
    historyContainer.className = 'history-container';
    mockRect(historyContainer, {
      left: 0,
      right: 640,
      top: 100,
      bottom: 500,
      width: 640,
      height: 400,
    });
    Object.defineProperty(historyContainer, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(historyContainer, 'scrollHeight', { configurable: true, value: 1000 });
    historyContainer.scrollTop = 0;
    document.body.appendChild(historyContainer);

    const targetWrapper = appendSourceThumb(secondItem.id, historyContainer);
    mockRect(targetWrapper, {
      left: 0,
      right: 36,
      top: 520,
      bottom: 556,
      width: 36,
      height: 36,
    });
    const scrollIntoView = vi.fn();
    Object.defineProperty(targetWrapper, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const harness = mountHarness(firstItem, {
      currentPageData: ref([firstItem, secondItem]) as Ref<HistoryItem[]>,
    });

    harness.api().openLightbox(firstItem);
    await harness.api().handleLightboxNavigate('next');

    expect(historyContainer.scrollTop).toBe(238);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(harness.api().lightboxItem.value?.id).toBe(secondItem.id);
  });

  it('does not move the history scroll container when the target thumb is already visible', async () => {
    const firstItem = makeItem('visible-item-1');
    const secondItem = makeItem('visible-item-2');
    const historyContainer = document.createElement('div');
    historyContainer.className = 'history-container';
    mockRect(historyContainer, {
      left: 0,
      right: 640,
      top: 100,
      bottom: 500,
      width: 640,
      height: 400,
    });
    Object.defineProperty(historyContainer, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(historyContainer, 'scrollHeight', { configurable: true, value: 1000 });
    historyContainer.scrollTop = 123;
    document.body.appendChild(historyContainer);

    const targetWrapper = appendSourceThumb(secondItem.id, historyContainer);
    mockRect(targetWrapper, {
      left: 0,
      right: 36,
      top: 200,
      bottom: 236,
      width: 36,
      height: 36,
    });
    const harness = mountHarness(firstItem, {
      currentPageData: ref([firstItem, secondItem]) as Ref<HistoryItem[]>,
    });

    harness.api().openLightbox(firstItem);
    await harness.api().handleLightboxNavigate('next');

    expect(historyContainer.scrollTop).toBe(123);
    expect(harness.api().lightboxItem.value?.id).toBe(secondItem.id);
  });

  it('centers the target in the nearest scrollable parent when no history container exists', async () => {
    const firstItem = makeItem('scroll-parent-1');
    const secondItem = makeItem('scroll-parent-2');
    const scrollParent = document.createElement('div');
    scrollParent.style.overflowY = 'auto';
    mockRect(scrollParent, {
      left: 0,
      right: 640,
      top: 100,
      bottom: 500,
      width: 640,
      height: 400,
    });
    Object.defineProperty(scrollParent, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(scrollParent, 'scrollHeight', { configurable: true, value: 1000 });
    scrollParent.scrollTop = 0;
    document.body.appendChild(scrollParent);

    const targetWrapper = appendSourceThumb(secondItem.id, scrollParent);
    mockRect(targetWrapper, {
      left: 0,
      right: 36,
      top: 520,
      bottom: 556,
      width: 36,
      height: 36,
    });
    const scrollIntoView = vi.fn();
    Object.defineProperty(targetWrapper, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const harness = mountHarness(firstItem, {
      currentPageData: ref([firstItem, secondItem]) as Ref<HistoryItem[]>,
    });

    harness.api().openLightbox(firstItem);
    await harness.api().handleLightboxNavigate('next');

    expect(scrollParent.scrollTop).toBe(238);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(harness.api().lightboxItem.value?.id).toBe(secondItem.id);
  });
});

describe('useTableInteractions lightbox delete result handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    document.body.innerHTML = '';
    deleteHistoryItemMock.mockResolvedValue(true);
  });

  it('keeps the lightbox open and does not show success when deletion returns false', async () => {
    deleteHistoryItemMock.mockResolvedValueOnce(false);
    const item = makeItem('delete-failed');
    const harness = mountHarness(item);

    harness.api().openLightbox(item);
    await harness.api().handleLightboxDelete(item);

    expect(deleteHistoryItemMock).toHaveBeenCalledWith('delete-failed');
    expect(harness.api().lightboxVisible.value).toBe(true);
    expect(toastSuccessMock).not.toHaveBeenCalled();

    harness.wrapper.unmount();
  });

  it('loads stats before toggling favorites when stats are not ready', async () => {
    isStatsLoadedRef.value = false;
    loadStatsMock.mockResolvedValueOnce(undefined);
    const item = makeItem('favorite-lazy-stats');
    const harness = mountHarness(item);

    await harness.api().handleToggleFavorite(item);

    expect(loadStatsMock).toHaveBeenCalledTimes(1);
    expect(toggleFavoriteMock).toHaveBeenCalledWith('favorite-lazy-stats');
    harness.wrapper.unmount();
  });

  it('swallows favorite toggle errors because the history manager owns the toast', async () => {
    toggleFavoriteMock.mockRejectedValueOnce(new Error('favorite failed'));
    const item = makeItem('favorite-error');
    const harness = mountHarness(item);

    await expect(harness.api().handleToggleFavorite(item)).resolves.toBeUndefined();

    expect(toggleFavoriteMock).toHaveBeenCalledWith('favorite-error');
    harness.wrapper.unmount();
  });
});

describe('useTableInteractions service badge copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('writes the service URL and marks only that badge as copied on success', async () => {
    const item = makeItem('copy-success');
    item.results = [{
      serviceId: 'jd',
      status: 'success',
      result: { serviceId: 'jd', fileKey: 'jd-copy', url: 'https://cdn.example.com/jd-copy.jpg' },
    }];
    const harness = mountHarness(item);

    await harness.api().handleCopyServiceLink(item, 'jd');

    const copiedKey = harness.api().getServiceCopyKey('copy-success', 'jd');
    expect(writeTextMock).toHaveBeenCalledWith('https://cdn.example.com/jd-copy.jpg');
    expect(harness.api().copiedServiceKey.value).toBe(copiedKey);
    expect(harness.api().isPopoverServiceCopied('jd')).toBe(false);
    expect(toastSilentMock).toHaveBeenCalledTimes(1);

    harness.wrapper.unmount();
  });

  it('does not mark a service badge copied when clipboard write fails', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('clipboard denied'));
    const item = makeItem('copy-failed');
    item.results = [{
      serviceId: 'jd',
      status: 'success',
      result: { serviceId: 'jd', fileKey: 'jd-fail', url: 'https://cdn.example.com/jd-fail.jpg' },
    }];
    const harness = mountHarness(item);

    await harness.api().handleCopyServiceLink(item, 'jd');

    expect(harness.api().copiedServiceKey.value).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith('复制失败', expect.stringContaining('clipboard denied'));

    harness.wrapper.unmount();
  });

  it('opens the service popover and warns when the selected service has no copyable link', async () => {
    const item = makeItem('popover-no-link');
    item.results = [{
      serviceId: 'jd',
      status: 'failed',
      error: 'upload failed',
    }];
    const toggle = vi.fn();
    const harness = mountHarness(item, {
      servicePopoverRef: ref({ toggle } as unknown as InstanceType<typeof PopoverType>),
    });

    harness.api().handlePopoverCopyLink('jd');
    expect(toastWarnMock).not.toHaveBeenCalled();

    const event = new Event('click');
    harness.api().openServicePopover(event, item, ['jd', 'weibo']);
    expect(toggle).toHaveBeenCalledWith(event);
    expect(harness.api().popoverServices.value).toEqual(['jd', 'weibo']);
    expect(harness.api().isPopoverServiceCopied('jd')).toBe(false);

    harness.api().handlePopoverCopyLink('jd');
    await Promise.resolve();

    expect(toastWarnMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).not.toHaveBeenCalled();
    harness.wrapper.unmount();
  });

  it('opens the service popover with only hidden overflow services', () => {
    const item = makeItem('popover-overflow-only');
    item.results = ['bilibili', 'chaoxing', 'jd', 'weibo'].map((serviceId) => ({
      serviceId,
      status: 'success' as const,
      result: {
        serviceId,
        fileKey: `${serviceId}-key`,
        url: `https://cdn.example.com/${serviceId}.jpg`,
      },
    }));
    const toggle = vi.fn();
    const harness = mountHarness(item, {
      servicePopoverRef: ref({ toggle } as unknown as InstanceType<typeof PopoverType>),
    });

    const event = new Event('click');
    harness.api().openServicePopover(event, item, ['jd', 'weibo']);

    expect(toggle).toHaveBeenCalledWith(event);
    expect(harness.api().popoverServices.value).toEqual(['jd', 'weibo']);
    harness.wrapper.unmount();
  });
});

describe('useTableInteractions hover preview positioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
  });

  it('centers wide short previews by their rendered height instead of a 300px square', () => {
    const item = {
      ...makeItem('wide-short'),
      width: 240,
      height: 48,
      aspectRatio: 5,
    };
    const source = document.createElement('div');
    mockRect(source, {
      left: 320,
      right: 356,
      top: 180,
      bottom: 216,
      width: 36,
      height: 36,
    });
    const harness = mountHarness(item);

    harness.api().handlePreviewEnter({ currentTarget: source } as unknown as MouseEvent, item);

    expect(harness.api().hoverPreview.value.style).toEqual({
      top: '174px',
      left: '364px',
      width: '240px',
      height: '48px',
    });
  });

  it('keeps small square previews at their original metadata size', () => {
    const item = {
      ...makeItem('small-square'),
      width: 240,
      height: 240,
      aspectRatio: 1,
    };
    const source = document.createElement('div');
    mockRect(source, {
      left: 320,
      right: 356,
      top: 180,
      bottom: 216,
      width: 36,
      height: 36,
    });
    const harness = mountHarness(item);

    harness.api().handlePreviewEnter({ currentTarget: source } as unknown as MouseEvent, item);

    expect(harness.api().hoverPreview.value.style).toEqual({
      top: '78px',
      left: '364px',
      width: '240px',
      height: '240px',
    });
  });

  it('positions portrait and unknown-size previews with aspect ratio fallbacks', () => {
    const source = document.createElement('div');
    mockRect(source, {
      left: 16,
      right: 52,
      top: 8,
      bottom: 44,
      width: 36,
      height: 36,
    });
    const portrait = {
      ...makeItem('portrait-ratio'),
      width: 0,
      height: 0,
      aspectRatio: 0.5,
    };
    const unknown = {
      ...makeItem('unknown-size'),
      width: 0,
      height: 0,
      aspectRatio: 0,
    };
    const harness = mountHarness(portrait);

    harness.api().handlePreviewEnter({ currentTarget: source } as unknown as MouseEvent, portrait);
    expect(harness.api().hoverPreview.value.style).toEqual({
      top: '8px',
      left: '60px',
      width: '150px',
      height: '300px',
    });

    harness.api().handlePreviewEnter({ currentTarget: source } as unknown as MouseEvent, unknown);
    expect(harness.api().hoverPreview.value.style).toEqual({
      top: '8px',
      left: '60px',
      width: '300px',
      height: '300px',
    });
  });
});
