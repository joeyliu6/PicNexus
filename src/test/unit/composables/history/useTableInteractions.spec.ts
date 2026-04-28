import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
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
} = vi.hoisted(() => ({
  warmImagesMock: vi.fn(),
  toggleFavoriteMock: vi.fn(),
  loadStatsMock: vi.fn(),
  deleteHistoryItemMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastWarnMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSilentMock: vi.fn(),
}));
const writeTextMock = getClipboardMocks().writeText;

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
    isStatsLoaded: ref(true),
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
  useLightboxPreloader: vi.fn(),
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

  const Harness = defineComponent({
    setup() {
      api = useTableInteractions({
        currentPageData,
        currentPage,
        totalPages,
        goToPage,
        peekPage,
        getSuccessfulServices: vi.fn(() => []),
        servicePopoverRef: ref(null),
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

  it('keeps the preview visible when the mouse is still over the source thumb', async () => {
    const item = makeItem();
    const source = appendSourceThumb(item.id);
    const harness = mountHarness(item);

    harness.api().handlePreviewEnter({ currentTarget: source } as unknown as MouseEvent, item);
    harness.api().openLightbox(item, { clientX: 12, clientY: 12 } as MouseEvent);
    await nextTick();
    expect(harness.api().resolveLightboxCloseTargetMode()).toBe('preview');

    harness.api().lightboxVisible.value = false;
    await nextTick();

    expect(harness.api().hoverPreview.value.closing).toBe(false);
    expect(harness.api().hoverPreview.value.visible).toBe(true);

    await vi.advanceTimersByTimeAsync(300);
    expect(harness.api().hoverPreview.value.visible).toBe(true);

    harness.api().handlePreviewLeave();
    expect(harness.api().hoverPreview.value.visible).toBe(false);
  });
});

describe('useTableInteractions lightbox cross-page tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
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
    });
  });
});
