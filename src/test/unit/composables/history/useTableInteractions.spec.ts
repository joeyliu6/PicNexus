import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { HistoryItem } from '../../../../config/types';

const {
  warmImagesMock,
  toggleFavoriteMock,
  loadStatsMock,
  deleteHistoryItemMock,
} = vi.hoisted(() => ({
  warmImagesMock: vi.fn(),
  toggleFavoriteMock: vi.fn(),
  loadStatsMock: vi.fn(),
  deleteHistoryItemMock: vi.fn(),
}));

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    silent: vi.fn(),
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

function appendSourceThumb(itemId: string) {
  const wrapper = document.createElement('div');
  wrapper.className = 'thumb-preview-wrapper';
  mockRect(wrapper, { left: 0, top: 0, right: 36, bottom: 36, width: 36, height: 36 });

  const thumb = document.createElement('div');
  thumb.className = 'thumb-box';
  thumb.dataset.lightboxId = itemId;
  wrapper.appendChild(thumb);
  document.body.appendChild(wrapper);
  return wrapper;
}

function mountHarness(item = makeItem()) {
  let api: ReturnType<typeof useTableInteractions> | null = null;
  const currentPageData = ref([item]) as Ref<HistoryItem[]>;

  const Harness = defineComponent({
    setup() {
      api = useTableInteractions({
        currentPageData,
        currentPage: ref(1),
        totalPages: ref(1),
        goToPage: vi.fn().mockResolvedValue(undefined),
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
