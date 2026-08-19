import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useImageLoadManager } from '@/composables/useImageLoadManager';
import type { VisibleItem } from '@/composables/useVirtualTimeline';

type ImageLoadManagerApi = ReturnType<typeof useImageLoadManager>;

interface Harness {
  api: ImageLoadManagerApi;
  visibleItems: Ref<VisibleItem[]>;
  wrapper: VueWrapper;
}

interface MockImageTarget extends HTMLImageElement {
  assignedSrc: string[];
}

const mountedWrappers: VueWrapper[] = [];

function makeVisibleItem(id: string): VisibleItem {
  return {
    meta: { id },
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    groupId: 'group-1',
  } as VisibleItem;
}

function mountManager(
  options: Parameters<typeof useImageLoadManager>[1] = {},
  initialVisible: VisibleItem[] = [],
): Harness {
  const visibleItems = ref<VisibleItem[]>(initialVisible);
  let api!: ImageLoadManagerApi;
  const HarnessComponent = defineComponent({
    setup() {
      api = useImageLoadManager(visibleItems, options);
      return () => null;
    },
  });
  const wrapper = mount(HarnessComponent);
  mountedWrappers.push(wrapper);
  return { api, visibleItems, wrapper };
}

function makeImageTarget(src: string, isConnected = true): MockImageTarget {
  let currentSrc = src;
  const assignedSrc: string[] = [];
  return {
    get src() {
      return currentSrc;
    },
    set src(value: string) {
      assignedSrc.push(value);
      currentSrc = value;
    },
    get isConnected() {
      return isConnected;
    },
    assignedSrc,
  } as MockImageTarget;
}

function makeImageEvent(target: HTMLImageElement): Event {
  const event = new Event('error');
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
});

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount();
  }
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useImageLoadManager', () => {
  it('onImageLoad 标记图片已加载，并按 LRU 淘汰最老的非可见项', () => {
    const h = mountManager({ maxCache: 2 });

    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    h.api.onImageLoad('old-1');
    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    h.api.onImageLoad('old-2');
    h.visibleItems.value = [makeVisibleItem('current')];
    vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));
    h.api.onImageLoad('current');

    expect(h.api.isImageLoaded('old-1')).toBe(false);
    expect(h.api.isImageLoaded('old-2')).toBe(true);
    expect(h.api.isImageLoaded('current')).toBe(true);
  });

  it('cleanupExpiredImages 删除超过 destroyDelay 的非可见图片，并保留当前可见图片', () => {
    const h = mountManager({ destroyDelay: 100 });

    h.visibleItems.value = [makeVisibleItem('visible')];
    h.api.onImageLoad('visible');
    h.api.onImageLoad('gone');

    vi.setSystemTime(new Date('2026-01-01T00:00:00.101Z'));
    h.api.cleanupExpiredImages();

    expect(h.api.isImageLoaded('visible')).toBe(true);
    expect(h.api.isImageLoaded('gone')).toBe(false);
  });

  it('onImageError 先按 maxRetry 重试，超过次数后标记失败', async () => {
    const h = mountManager({ maxRetry: 1 });
    const img = makeImageTarget('https://example.com/a.jpg');
    const event = makeImageEvent(img);

    h.api.onImageError(event, 'img-1');
    expect(h.api.isImageFailed('img-1')).toBe(false);

    await vi.advanceTimersByTimeAsync(500);
    expect(img.assignedSrc).toEqual(['', 'https://example.com/a.jpg']);

    h.api.onImageError(event, 'img-1');
    expect(h.api.isImageFailed('img-1')).toBe(true);
  });

  // 回归：候选链的超时兜底、以及候选被安全过滤清空这两条路径都没有真实的 `<img>`
  // error 事件。没做防护时 `event.target` 会当场抛 TypeError，整格卡在骨架屏上。
  // 也没有可重设 src 的元素，所以重试无从谈起，必须直接判失败。
  it('onImageError 收到空 event 时直接判失败，不尝试重试', async () => {
    const h = mountManager({ maxRetry: 1 });

    h.api.onImageError(undefined, 'no-event');

    expect(h.api.isImageFailed('no-event')).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.api.isImageFailed('no-event')).toBe(true);
  });

  // 用户确认明文 HTTP 域名后要撤销失败态：判失败的前提变了，之前判死的图得给第二次机会。
  it('clearFailed 撤销失败态并还原重试额度，但不动已加载缓存', async () => {
    const h = mountManager({ maxRetry: 1 });
    const img = makeImageTarget('https://example.com/a.jpg');

    h.api.onImageLoad('ok');
    h.api.onImageError(makeImageEvent(img), 'bad');
    await vi.advanceTimersByTimeAsync(500);
    h.api.onImageError(makeImageEvent(img), 'bad');
    expect(h.api.isImageFailed('bad')).toBe(true);

    h.api.clearFailed();

    expect(h.api.isImageFailed('bad')).toBe(false);
    // 已加载的没必要跟着重来
    expect(h.api.isImageLoaded('ok')).toBe(true);
    // 重试额度也回来了：不还原的话刚放回来再失败一次就直接判死
    h.api.onImageError(makeImageEvent(img), 'bad');
    expect(h.api.isImageFailed('bad')).toBe(false);
  });

  it('clearAll 清空 loaded/failed 状态，并取消未触发的重试定时器', async () => {
    const h = mountManager({ maxRetry: 1 });
    const img = makeImageTarget('https://example.com/b.jpg');

    h.api.onImageLoad('loaded');
    h.api.onImageError(makeImageEvent(img), 'retrying');
    h.api.clearAll();
    await vi.advanceTimersByTimeAsync(500);

    expect(h.api.loadedImages.value.size).toBe(0);
    expect(h.api.failedImages.value.size).toBe(0);
    expect(img.assignedSrc).toEqual([]);
  });

  it('组件卸载时停止清理定时器并清空加载状态', async () => {
    const h = mountManager({ maxRetry: 1 });
    const img = makeImageTarget('https://example.com/c.jpg');

    h.api.onImageLoad('loaded-before-unmount');
    h.api.onImageError(makeImageEvent(img), 'retry-before-unmount');
    h.wrapper.unmount();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(h.api.loadedImages.value.size).toBe(0);
    expect(h.api.failedImages.value.size).toBe(0);
    expect(img.assignedSrc).toEqual([]);
  });
});
