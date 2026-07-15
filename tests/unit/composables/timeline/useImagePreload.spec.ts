import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { defineComponent, ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { mountWithDefaults } from '../../helpers/vueMount';
import { flushPromisesAndTicks } from '../../helpers/wait';
import type { ImageMeta } from '@/types/image-meta';
import type { VisibleItem } from '@/composables/useVirtualTimeline';

import { useImagePreload } from '@/composables/timeline/useImagePreload';

function makeMeta(id: string): ImageMeta {
  return {
    id,
    timestamp: Date.now(),
    localFileName: `${id}.jpg`,
    aspectRatio: 1.5,
    primaryService: 'r2' as import('@/config/types').ServiceType,
    primaryUrl: `https://r2.example.com/${id}.jpg`,
  };
}

function makeVisibleItem(id: string): VisibleItem {
  return {
    meta: makeMeta(id),
    x: 0, y: 0, width: 200, height: 150,
    groupId: 'g1',
  };
}

const mountedWrappers: VueWrapper[] = [];
const createdImages: MockImage[] = [];

class MockImage {
  onload: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private currentSrc = '';

  set src(value: string) {
    this.currentSrc = value;
    createdImages.push(this);
  }

  get src(): string {
    return this.currentSrc;
  }
}

function createPreloadContext(overrides: Partial<Parameters<typeof useImagePreload>[0]> = {}) {
  const visibleItems = ref<VisibleItem[]>([]);
  const allMetas = ref<ImageMeta[]>([]);
  const displayMode = ref<'fast' | 'normal'>('normal');
  const scrollDirection = ref<'up' | 'down' | null>(null);
  const getThumbnailUrl = vi.fn().mockReturnValue('https://thumb.example.com/img.jpg');
  const isImageLoaded = vi.fn().mockReturnValue(false);
  const onImageLoad = vi.fn();
  const onImageError = vi.fn();

  return {
    visibleItems, allMetas, displayMode, scrollDirection,
    getThumbnailUrl, isImageLoaded, onImageLoad, onImageError,
    ...useImagePreload({ visibleItems, allMetas, displayMode, scrollDirection, getThumbnailUrl, isImageLoaded, onImageLoad, onImageError, ...overrides }),
  };
}

function makePreload(overrides: Partial<Parameters<typeof useImagePreload>[0]> = {}) {
  let ctx!: ReturnType<typeof createPreloadContext>;
  const Harness = defineComponent({
    setup() {
      ctx = createPreloadContext(overrides);
      return () => null;
    },
  });

  mountedWrappers.push(mountWithDefaults(Harness));
  return ctx;
}

beforeEach(() => {
  createdImages.length = 0;
  vi.stubGlobal('Image', MockImage);
});

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount();
  }
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── preloadNextScreen 跳过条件 ───────────────────────────────────────────────

describe('preloadNextScreen — 跳过条件', () => {
  it('displayMode = fast 时跳过预加载', () => {
    const ctx = makePreload();
    ctx.displayMode.value = 'fast';
    ctx.scrollDirection.value = 'down';
    ctx.allMetas.value = [makeMeta('a'), makeMeta('b'), makeMeta('c')];
    ctx.visibleItems.value = [makeVisibleItem('a')];
    ctx.preloadNextScreen();
    // 快速模式下不创建 Image，getThumbnailUrl 不应被调用
    expect(ctx.getThumbnailUrl).not.toHaveBeenCalled();
  });

  it('scrollDirection = null 时跳过预加载', () => {
    const ctx = makePreload();
    ctx.scrollDirection.value = null;
    ctx.allMetas.value = [makeMeta('a'), makeMeta('b')];
    ctx.visibleItems.value = [makeVisibleItem('a')];
    ctx.preloadNextScreen();
    expect(ctx.getThumbnailUrl).not.toHaveBeenCalled();
  });

  it('可见列表为空时跳过预加载（firstId 或 lastId 找不到）', () => {
    const ctx = makePreload();
    ctx.scrollDirection.value = 'down';
    ctx.allMetas.value = [makeMeta('a')];
    ctx.visibleItems.value = []; // 空
    ctx.preloadNextScreen();
    expect(ctx.getThumbnailUrl).not.toHaveBeenCalled();
  });
});

// ─── preloadNextScreen 向下预加载 ────────────────────────────────────────────

describe('preloadNextScreen — 向下预加载', () => {
  it('向下滚动时预加载可见区域后面的图片', () => {
    const metas = [makeMeta('a'), makeMeta('b'), makeMeta('c'), makeMeta('d')];
    const ctx = makePreload();
    ctx.allMetas.value = metas;
    ctx.visibleItems.value = [makeVisibleItem('a'), makeVisibleItem('b')]; // a, b 可见
    ctx.scrollDirection.value = 'down';
    ctx.preloadNextScreen();
    // 应预加载 c, d（可见区域后面的图片）
    expect(ctx.getThumbnailUrl).toHaveBeenCalled();
  });

  it('已加载的图片不重复预加载', () => {
    const isImageLoaded = vi.fn().mockImplementation((id: string) => id === 'c');
    const metas = [makeMeta('a'), makeMeta('b'), makeMeta('c'), makeMeta('d')];
    const ctx = makePreload({ isImageLoaded });
    ctx.allMetas.value = metas;
    ctx.visibleItems.value = [makeVisibleItem('a'), makeVisibleItem('b')];
    ctx.scrollDirection.value = 'down';
    ctx.preloadNextScreen();
    // c 已加载，不应调用 getThumbnailUrl('c')
    const calledMetas = (ctx.getThumbnailUrl as ReturnType<typeof vi.fn>).mock.calls
      .map((call: unknown[]) => (call[0] as ImageMeta).id);
    expect(calledMetas).not.toContain('c');
  });

  it('creates background Image objects and reports successful preloads', () => {
    const metas = [makeMeta('a'), makeMeta('b')];
    const ctx = makePreload();
    ctx.allMetas.value = metas;
    ctx.visibleItems.value = [makeVisibleItem('a')];
    ctx.scrollDirection.value = 'down';

    ctx.preloadNextScreen();

    expect(createdImages).toHaveLength(1);
    expect(createdImages[0].src).toBe('https://thumb.example.com/img.jpg');

    createdImages[0].onload?.(new Event('load'));

    expect(ctx.onImageLoad).toHaveBeenCalledWith('b');
  });

  it('forwards background Image errors to the provided error handler', () => {
    const metas = [makeMeta('a'), makeMeta('b')];
    const ctx = makePreload();
    ctx.allMetas.value = metas;
    ctx.visibleItems.value = [makeVisibleItem('a')];
    ctx.scrollDirection.value = 'down';

    ctx.preloadNextScreen();
    const errorEvent = new Event('error');
    createdImages[0].onerror?.(errorEvent);

    expect(ctx.onImageError).toHaveBeenCalledWith(errorEvent, 'b');
  });
});

// ─── preloadNextScreen 向上预加载 ────────────────────────────────────────────

describe('preloadNextScreen — 向上预加载', () => {
  it('向上滚动时预加载可见区域前面的图片', () => {
    const metas = [makeMeta('a'), makeMeta('b'), makeMeta('c'), makeMeta('d')];
    const ctx = makePreload();
    ctx.allMetas.value = metas;
    ctx.visibleItems.value = [makeVisibleItem('c'), makeVisibleItem('d')]; // c, d 可见
    ctx.scrollDirection.value = 'up';
    ctx.preloadNextScreen();
    // 应预加载 a, b（可见区域前面的图片）
    expect(ctx.getThumbnailUrl).toHaveBeenCalled();
  });
});

// ─── cleanup ─────────────────────────────────────────────────────────────────

describe('cleanup', () => {
  it('cleanup 方法可被调用而不抛出', () => {
    const ctx = makePreload();
    expect(() => ctx.cleanup()).not.toThrow();
  });

  it('cancels the debounced preload timer', async () => {
    vi.useFakeTimers();
    const ctx = makePreload();
    ctx.allMetas.value = [makeMeta('a'), makeMeta('b')];
    ctx.visibleItems.value = [makeVisibleItem('a')];
    ctx.scrollDirection.value = 'down';

    ctx.displayMode.value = 'fast';
    await flushPromisesAndTicks(1);
    ctx.displayMode.value = 'normal';
    await flushPromisesAndTicks(1);
    ctx.cleanup();
    await vi.advanceTimersByTimeAsync(300);

    expect(ctx.getThumbnailUrl).not.toHaveBeenCalled();
  });
});
