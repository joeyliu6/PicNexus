import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

type PswpEvent = {
  content?: unknown;
  isError?: boolean;
  originalEvent?: Event;
  preventDefault?: () => void;
};
type PswpHandler = (event: PswpEvent) => void;
type PswpFilter = (thumbEl: unknown, data: { thumbCropped?: boolean }, index: number) => unknown;

const { pswpInstances } = vi.hoisted(() => ({
  pswpInstances: [] as MockPhotoSwipe[],
}));

class MockPhotoSwipe {
  options: { dataSource?: unknown };
  element = document.createElement('div');
  currSlide?: { content?: unknown };
  refreshSlideContent = vi.fn();
  filters = new Map<string, PswpFilter[]>();
  private handlers = new Map<string, PswpHandler[]>();

  constructor(options: { dataSource?: unknown }) {
    this.options = options;
    pswpInstances.push(this);
  }

  on(eventName: string, handler: PswpHandler): void {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }

  addFilter(name: string, filter: PswpFilter): void {
    const filters = this.filters.get(name) ?? [];
    filters.push(filter);
    this.filters.set(name, filters);
  }

  init(): void {}

  close(): void {}

  destroy(): void {}

  emit(eventName: string, event: PswpEvent): void {
    for (const handler of this.handlers.get(eventName) ?? []) {
      handler(event);
    }
  }
}

vi.mock('photoswipe', () => ({
  default: MockPhotoSwipe,
}));

vi.mock('@/utils/reducedMotion', () => ({
  prefersReducedMotion: () => false,
  prefersReducedVisualEffects: () => false,
  motionDuration: (duration: number) => duration,
}));

const { usePhotoSwipeBridge } = await import('@/composables/history/usePhotoSwipeBridge');

function mountHarness(options: {
  visible?: boolean;
  hasPrev?: boolean;
  hasNext?: boolean;
  mediumSrc?: string;
  resolveCloseTargetMode?: () => 'auto' | 'preview' | 'thumb' | 'fade';
  onNavigate?: (direction: 'prev' | 'next') => void;
  onLoadError?: () => void;
  onLoadSuccess?: () => void;
} = {}) {
  const visible = ref(options.visible ?? false);
  const hasPrev = ref(options.hasPrev ?? false);
  const hasNext = ref(options.hasNext ?? false);
  const itemId = ref('item-1');
  const imageSrc = ref('https://example.com/a.jpg');
  let api: ReturnType<typeof usePhotoSwipeBridge> | null = null;

  const Harness = defineComponent({
    setup() {
      api = usePhotoSwipeBridge({
        visible,
        imageSrc: computed(() => imageSrc.value),
        mediumSrc: computed(() => options.mediumSrc ?? ''),
        itemId: computed(() => itemId.value),
        imageWidth: computed(() => 1200),
        imageHeight: computed(() => 800),
        hasPrev,
        hasNext,
        onClose: vi.fn(),
        onNavigate: options.onNavigate ?? vi.fn(),
        onLoadError: options.onLoadError,
        onLoadSuccess: options.onLoadSuccess,
        resolveCloseTargetMode: options.resolveCloseTargetMode,
      });
      return () => h('div');
    },
  });

  return {
    wrapper: mount(Harness),
    visible,
    hasPrev,
    hasNext,
    itemId,
    imageSrc,
    api: () => api!,
  };
}

function mockRect(el: HTMLElement, rect: Partial<DOMRect>) {
  const fullRect = {
    left: 0,
    top: 0,
    right: 120,
    bottom: 120,
    width: 120,
    height: 120,
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

describe('usePhotoSwipeBridge image loading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pswpInstances.length = 0;
    document.body.innerHTML = '';
  });

  it('opens from the largest visible source and keeps the medium image as blur placeholder', async () => {
    const smallThumb = document.createElement('div');
    smallThumb.className = 'thumb-box';
    smallThumb.dataset.lightboxId = 'item-1';
    mockRect(smallThumb, { width: 80, height: 80, right: 80, bottom: 80 });
    document.body.appendChild(smallThumb);

    const largePreview = document.createElement('div');
    largePreview.className = 'global-thumb-hover-preview';
    largePreview.dataset.lightboxId = 'item-1';
    mockRect(largePreview, { width: 240, height: 160, right: 240, bottom: 160 });
    document.body.appendChild(largePreview);

    const harness = mountHarness({ mediumSrc: 'https://example.com/medium.jpg' });
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const pswp = pswpInstances[0];
    const slide = (pswp.options.dataSource as Array<Record<string, unknown>>)[0];
    expect(slide.element).toBe(largePreview);
    expect(slide.msrc).toBe('https://example.com/medium.jpg');
    expect(slide.thumbCropped).toBe(false);
    expect(pswp.options).toMatchObject({
      showHideAnimationType: 'zoom',
      mainClass: 'pswp--picnexus',
    });
    expect(harness.api().blurSrc.value).toBe('https://example.com/medium.jpg');
    expect(harness.api().pswpEl.value).toBe(pswp.element);
    harness.wrapper.unmount();
  });

  it('sets no-referrer before PhotoSwipe assigns the image src', async () => {
    const harness = mountHarness();
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const pswp = pswpInstances[0];
    const img = document.createElement('img');
    const content = { data: { id: 'item-1' }, element: img };
    pswp.currSlide = { content };

    pswp.emit('contentLoadImage', { content });

    expect(img.referrerPolicy).toBe('no-referrer');
    expect(img.decoding).toBe('async');
    harness.wrapper.unmount();
  });

  it('keeps the full image hidden until it is decoded', async () => {
    let resolveDecode: () => void = () => {};
    const decodePromise = new Promise<void>((resolve) => { resolveDecode = resolve; });
    const onLoadSuccess = vi.fn();
    const harness = mountHarness({ onLoadSuccess });
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const pswp = pswpInstances[0];
    const img = document.createElement('img');
    Object.defineProperty(img, 'decode', {
      configurable: true,
      value: vi.fn(() => decodePromise),
    });
    const content = { data: { id: 'item-1' }, element: img };
    pswp.currSlide = { content };

    pswp.emit('contentLoadImage', { content });
    expect(img.classList.contains('is-waiting-full-image')).toBe(true);

    pswp.emit('loadComplete', { content });
    await Promise.resolve();
    expect(img.classList.contains('is-waiting-full-image')).toBe(true);
    expect(onLoadSuccess).not.toHaveBeenCalled();

    resolveDecode();
    await Promise.resolve();
    await Promise.resolve();

    expect(img.classList.contains('is-waiting-full-image')).toBe(false);
    expect(img.classList.contains('is-full-image-ready')).toBe(true);
    expect(onLoadSuccess).toHaveBeenCalledTimes(1);
    harness.wrapper.unmount();
  });

  it('ignores stale load events when the same item switches to another image URL', async () => {
    const onLoadSuccess = vi.fn();
    const harness = mountHarness({ onLoadSuccess });
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const pswp = pswpInstances[0];
    const oldImg = document.createElement('img');
    const oldContent = {
      data: { id: 'item-1', src: 'https://example.com/a.jpg' },
      element: oldImg,
    };
    pswp.currSlide = { content: oldContent };

    pswp.emit('contentLoadImage', { content: oldContent });
    harness.imageSrc.value = 'https://example.com/b.jpg';
    await nextTick();
    await nextTick();

    pswp.currSlide = {
      content: {
        data: { id: 'item-1', src: 'https://example.com/b.jpg' },
        element: document.createElement('img'),
      },
    };
    pswp.emit('loadComplete', { content: oldContent });
    await Promise.resolve();

    expect(oldImg.classList.contains('is-waiting-full-image')).toBe(true);
    expect(onLoadSuccess).not.toHaveBeenCalled();
    harness.wrapper.unmount();
  });

  it('retries one transient load error before notifying the caller', async () => {
    const onLoadError = vi.fn();
    const harness = mountHarness({ onLoadError });
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const pswp = pswpInstances[0];
    const content = { data: { id: 'item-1' }, element: document.createElement('img') };
    pswp.currSlide = { content };

    pswp.emit('loadComplete', { content, isError: true });
    expect(onLoadError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(pswp.refreshSlideContent).toHaveBeenCalledWith(0);

    pswp.emit('loadComplete', { content, isError: true });
    expect(onLoadError).toHaveBeenCalledTimes(1);
    harness.wrapper.unmount();
  });

  it('shows and clears the delayed loading indicator around a successful load without an image element', async () => {
    const harness = mountHarness();
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const pswp = pswpInstances[0];
    const content = { data: { id: 'item-1' } };
    pswp.currSlide = { content };

    pswp.emit('contentLoad', { content });
    await vi.advanceTimersByTimeAsync(199);
    expect(harness.api().isLoading.value).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.api().isLoading.value).toBe(true);

    pswp.emit('loadComplete', { content });
    expect(harness.api().isLoading.value).toBe(false);
    harness.wrapper.unmount();
  });
});

describe('usePhotoSwipeBridge navigation and source filters', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pswpInstances.length = 0;
    document.body.innerHTML = '';
  });

  it('routes keyboard and wheel navigation only when the direction is available', async () => {
    const onNavigate = vi.fn();
    const harness = mountHarness({
      hasPrev: true,
      hasNext: true,
      onNavigate,
    });
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(onNavigate).toHaveBeenNthCalledWith(1, 'prev');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'next');

    const pswp = pswpInstances[0];
    const preventDefault = vi.fn();
    pswp.emit('wheel', {
      originalEvent: new WheelEvent('wheel', { deltaY: 120 }),
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenLastCalledWith('next');

    pswp.emit('wheel', {
      originalEvent: new WheelEvent('wheel', { deltaY: 120 }),
      preventDefault: vi.fn(),
    });
    expect(onNavigate).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(200);
    pswp.emit('wheel', {
      originalEvent: new WheelEvent('wheel', { deltaY: -120 }),
      preventDefault: vi.fn(),
    });
    expect(onNavigate).toHaveBeenLastCalledWith('prev');

    const ctrlPreventDefault = vi.fn();
    pswp.emit('wheel', {
      originalEvent: { ctrlKey: true, deltaY: 120 } as unknown as Event,
      preventDefault: ctrlPreventDefault,
    });
    expect(ctrlPreventDefault).not.toHaveBeenCalled();
    harness.wrapper.unmount();
  });

  it('uses the close target mode when resolving PhotoSwipe thumb filters', async () => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb-box';
    thumb.dataset.lightboxId = 'item-1';
    mockRect(thumb, { width: 120, height: 90, right: 120, bottom: 90 });
    document.body.appendChild(thumb);

    const preview = document.createElement('div');
    preview.className = 'global-thumb-hover-preview';
    preview.dataset.lightboxId = 'item-1';
    mockRect(preview, { width: 240, height: 180, right: 240, bottom: 180 });
    document.body.appendChild(preview);

    let closeMode: 'auto' | 'preview' | 'thumb' | 'fade' = 'preview';
    const harness = mountHarness({
      resolveCloseTargetMode: () => closeMode,
    });
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const pswp = pswpInstances[0];
    const filter = pswp.filters.get('thumbEl')![0];
    const autoData: { thumbCropped?: boolean } = {};
    expect(filter(undefined, autoData, 0)).toBe(preview);
    expect(autoData.thumbCropped).toBe(false);

    closeMode = 'thumb';
    pswp.emit('close', {});
    const thumbData: { thumbCropped?: boolean } = {};
    expect(filter(undefined, thumbData, 0)).toBe(thumb);
    expect(thumbData.thumbCropped).toBe(true);

    harness.wrapper.unmount();
  });

  it('falls back to fade when close mode asks for no source thumbnail', async () => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb-box';
    thumb.dataset.lightboxId = 'item-1';
    mockRect(thumb, { width: 120, height: 90, right: 120, bottom: 90 });
    document.body.appendChild(thumb);

    const harness = mountHarness({
      resolveCloseTargetMode: () => 'fade',
    });
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const pswp = pswpInstances[0];
    const filter = pswp.filters.get('thumbEl')![0];
    pswp.emit('close', {});
    expect(filter(undefined, {}, 0)).toBeUndefined();
    harness.wrapper.unmount();
  });

  it('marks switched-in content and placeholder elements after the first activation', async () => {
    const harness = mountHarness();
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const pswp = pswpInstances[0];
    const first = document.createElement('img');
    pswp.emit('contentActivate', { content: { element: first } });
    expect(first.classList.contains('is-switching-in')).toBe(false);

    harness.api().setSwitchDirection('next');
    const next = document.createElement('img');
    const placeholder = document.createElement('div');
    pswp.emit('contentActivate', {
      content: {
        element: next,
        placeholder: { element: placeholder },
      },
    });

    expect(next.dataset.switchDir).toBe('next');
    expect(next.classList.contains('is-switching-in')).toBe(true);
    expect(placeholder.classList.contains('is-switching-in')).toBe(true);

    pswp.emit('contentActivate', { content: { element: {} } });
    harness.wrapper.unmount();
  });
});
