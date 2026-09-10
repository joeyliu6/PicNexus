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
  /**
   * 复刻真实 opener 的开场闸门：isOpen 要等开场动画结束才为 true，在此之前
   * close() 静默 return（photoswipe.esm.js 的 `if (!this.opener.isOpen …) return`）。
   * 不模拟这一条，就测不出"开场期间关闭被吞掉"那个缺陷。
   */
  opener = { isOpen: false };
  closeCalls = 0;
  destroyCalls = 0;
  private handlers = new Map<string, PswpHandler[]>();

  constructor(options: { dataSource?: unknown }) {
    this.options = options;
    pswpInstances.push(this);
  }

  /** 开场动画播完：解除闸门并派发 openingAnimationEnd */
  finishOpeningAnimation(): void {
    this.opener.isOpen = true;
    this.emit('openingAnimationEnd', {});
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

  close(): void {
    this.closeCalls += 1;
    // 真实实现：开场动画未结束时直接 return，'close' 事件根本不派发
    if (!this.opener.isOpen) return;
    this.emit('close', {});
  }

  destroy(): void {
    this.destroyCalls += 1;
    this.close();
  }

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

  it('resolves the same element, rect and crop semantics on open and on close', async () => {
    // 这是「大图收回时跳一下」的判据：FLIP 起点和终点必须是同一个矩形。
    // 开场经 dataSource[0].element 量一次，关场经 thumbEl filter 再量一次，
    // 两次结果只要有任何一项对不上，屏幕上就会看到位移或缩放的突变。
    const thumb = document.createElement('div');
    thumb.className = 'thumb-box';
    thumb.dataset.lightboxId = 'item-1';
    mockRect(thumb, { width: 36, height: 36, right: 36, bottom: 36 });
    document.body.appendChild(thumb);

    const preview = document.createElement('div');
    preview.className = 'global-thumb-hover-preview';
    preview.dataset.lightboxId = 'item-1';
    mockRect(preview, { left: 44, top: 10, width: 300, height: 200, right: 344, bottom: 210 });
    document.body.appendChild(preview);

    // 鼠标仍停在源缩略图上 → 收回目标就是那张悬浮预览卡片
    const harness = mountHarness({ resolveCloseTargetMode: () => 'preview' });
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const pswp = pswpInstances[0];
    const slide = (pswp.options.dataSource as Array<Record<string, unknown>>)[0];
    const openEl = slide.element as HTMLElement;
    const openRect = openEl.getBoundingClientRect();
    expect(openEl).toBe(preview);
    expect(slide.thumbCropped).toBe(false);

    pswp.emit('close', {});
    const closeData: { thumbCropped?: boolean } = { thumbCropped: false };
    const closeEl = pswp.filters.get('thumbEl')![0](undefined, closeData, 0) as HTMLElement;

    expect(closeEl).toBe(openEl);
    expect(closeEl.getBoundingClientRect()).toEqual(openRect);
    // contain → cover 的语义翻转会让 PhotoSwipe 按裁剪重算 innerRect，
    // 长宽比悬殊的图会在收回末端明显偏移
    expect(closeData.thumbCropped).toBe(false);

    harness.wrapper.unmount();
  });

  it('degrades to fade rather than shrinking the image into a 36px thumbnail', async () => {
    // 表格里的缩略图只有 36px。从全屏收进去是 30 多倍缩放，眼睛跟不住，
    // 而且 thumbCropped 会从 contain 翻成 cover，长宽比悬殊的图末端还会偏移。
    const thumb = document.createElement('div');
    thumb.className = 'thumb-box';
    thumb.dataset.lightboxId = 'item-1';
    mockRect(thumb, { width: 36, height: 36, right: 36, bottom: 36 });
    document.body.appendChild(thumb);

    const preview = document.createElement('div');
    preview.className = 'global-thumb-hover-preview';
    preview.dataset.lightboxId = 'item-1';
    mockRect(preview, { width: 300, height: 200, right: 300, bottom: 200 });
    document.body.appendChild(preview);

    const harness = mountHarness({ resolveCloseTargetMode: () => 'thumb' });
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const pswp = pswpInstances[0];
    pswp.emit('close', {});
    expect(pswp.filters.get('thumbEl')![0](undefined, {}, 0)).toBeUndefined();
    // 降级的补偿样式由 close 回调按实际动画类型挂上
    expect(pswp.element.classList.contains('is-pswp-closing--fade')).toBe(true);

    harness.wrapper.unmount();
  });

  it('keeps the FLIP animation for grid tiles that clear the size threshold', async () => {
    // 收藏 / 时间轴视图的 .photo-item 是大方格，不传 resolveCloseTargetMode
    // （closeTargetMode 恒为 'auto'）。上面那条降级规则绝不能波及它们 ——
    // 它们的开合动画本来就是对称的，必须保持"从方格长出来、原路收回去"。
    const tile = document.createElement('div');
    tile.className = 'photo-item';
    tile.dataset.lightboxId = 'item-1';
    mockRect(tile, { width: 180, height: 180, right: 180, bottom: 180 });
    document.body.appendChild(tile);

    const harness = mountHarness();
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const pswp = pswpInstances[0];
    expect(pswp.options).toMatchObject({ showHideAnimationType: 'zoom' });

    pswp.emit('close', {});
    expect(pswp.filters.get('thumbEl')![0](undefined, {}, 0)).toBe(tile);
    expect(pswp.element.classList.contains('is-pswp-closing--fade')).toBe(false);

    harness.wrapper.unmount();
  });

  it('defers a close requested mid-opening instead of losing it, and can reopen afterwards', async () => {
    /*
     * PhotoSwipe 拒绝在开场动画播完前关闭，而且是静默 return —— 'close' 事件
     * 不派发，桥接层的实例引用就永远清不掉，之后每次打开都会被开头的
     * `if (pswp) return` 挡住，灯箱从此打不开。触发路径真实存在：灯箱里的
     * 删除按钮直接把 visible 置 false，开场 300ms 内点得到。
     */
    const harness = mountHarness();
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const first = pswpInstances[0];
    expect(first.opener.isOpen).toBe(false);

    // 开场动画还没播完就要求关闭
    harness.visible.value = false;
    await nextTick();

    // 此刻不该硬闯（闯了也是白闯，而且浏览器不擅长中途反转 transition）
    expect(first.closeCalls).toBe(0);

    // 开场动画结束 → 补上那次关闭
    first.finishOpeningAnimation();
    expect(first.closeCalls).toBe(1);
    expect(harness.api().pswpEl.value).toBeNull();

    // 关键回归点：实例引用已清干净，灯箱还能再打开
    harness.visible.value = true;
    await nextTick();
    await nextTick();
    expect(pswpInstances).toHaveLength(2);

    harness.wrapper.unmount();
  });

  it('tears the root out of the DOM when unmounted mid-opening', async () => {
    // destroy() 同样撞在那道闸门上（内部转调 close）。组件正在卸载，没有
    // "等动画播完"的余地，根元素必须当场摘掉，否则会赖在 body 上挡住交互。
    const harness = mountHarness();
    harness.visible.value = true;
    await nextTick();
    await nextTick();

    const pswp = pswpInstances[0];
    document.body.appendChild(pswp.element);
    expect(pswp.element.isConnected).toBe(true);

    harness.wrapper.unmount();

    expect(pswp.element.isConnected).toBe(false);
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
