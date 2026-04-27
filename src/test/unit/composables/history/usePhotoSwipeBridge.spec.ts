import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

type PswpEvent = { content?: unknown; isError?: boolean };
type PswpHandler = (event: PswpEvent) => void;

const { pswpInstances } = vi.hoisted(() => ({
  pswpInstances: [] as MockPhotoSwipe[],
}));

class MockPhotoSwipe {
  options: { dataSource?: unknown };
  element = document.createElement('div');
  currSlide?: { content?: unknown };
  refreshSlideContent = vi.fn();
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

  addFilter(): void {}

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

vi.mock('../../../../utils/reducedMotion', () => ({
  prefersReducedMotion: () => false,
  motionDuration: (duration: number) => duration,
}));

const { usePhotoSwipeBridge } = await import('../../../../composables/history/usePhotoSwipeBridge');

function mountHarness(options: {
  visible?: boolean;
  onLoadError?: () => void;
  onLoadSuccess?: () => void;
} = {}) {
  const visible = ref(options.visible ?? false);
  const itemId = ref('item-1');
  const imageSrc = ref('https://example.com/a.jpg');

  const Harness = defineComponent({
    setup() {
      usePhotoSwipeBridge({
        visible,
        imageSrc: computed(() => imageSrc.value),
        mediumSrc: computed(() => ''),
        itemId: computed(() => itemId.value),
        imageWidth: computed(() => 1200),
        imageHeight: computed(() => 800),
        hasPrev: ref(false),
        hasNext: ref(false),
        onClose: vi.fn(),
        onNavigate: vi.fn(),
        onLoadError: options.onLoadError,
        onLoadSuccess: options.onLoadSuccess,
      });
      return () => h('div');
    },
  });

  return {
    wrapper: mount(Harness),
    visible,
    itemId,
    imageSrc,
  };
}

describe('usePhotoSwipeBridge image loading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pswpInstances.length = 0;
    document.body.innerHTML = '';
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
});
