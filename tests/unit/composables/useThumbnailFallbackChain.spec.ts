import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, ref, nextTick, type Ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { mountWithDefaults } from '../helpers/vueMount';

const { reportFailedMock, reportLoadedMock } = vi.hoisted(() => ({
  reportFailedMock: vi.fn(),
  reportLoadedMock: vi.fn(),
}));

vi.mock('@/composables/useThumbCache', () => ({
  reportThumbnailUrlFailed: reportFailedMock,
  reportThumbnailUrlLoaded: reportLoadedMock,
}));

import {
  useThumbnailFallbackChain,
  THUMB_LOAD_TIMEOUT_MS,
} from '@/composables/useThumbnailFallbackChain';

const PROXY = 'https://wsrv.nl/?url=https%3A%2F%2Fcdn.example.com%2Fa.png&w=75';
const ORIGIN = 'https://cdn.example.com/a.png';

const mountedWrappers: VueWrapper[] = [];

/** 手控的 IntersectionObserver：不主动触发就等于「元素一直在视口外」 */
const observerCallbacks: IntersectionObserverCallback[] = [];
class MockIntersectionObserver {
  constructor(cb: IntersectionObserverCallback) {
    observerCallbacks.push(cb);
  }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = '';
  thresholds = [];
}

function enterViewport(): void {
  for (const cb of observerCallbacks) {
    cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  }
}

interface Harness {
  currentSrc: () => string;
  handleError: (e?: Event) => void;
  handleLoad: () => void;
  urls: Ref<string[]>;
  waiting: Ref<boolean>;
  exhausted: ReturnType<typeof vi.fn>;
}

function mountChain(initialUrls: string[], withElementRef = true): Harness {
  let api!: Harness;
  const Comp = defineComponent({
    setup() {
      const urls = ref(initialUrls);
      const waiting = ref(true);
      const exhausted = vi.fn();
      const el = ref<HTMLElement | null>(document.createElement('div'));
      const chain = useThumbnailFallbackChain({
        urls: () => urls.value,
        isWaiting: () => waiting.value,
        onExhausted: exhausted,
        ...(withElementRef ? { elementRef: el } : {}),
      });
      api = {
        currentSrc: () => chain.currentSrc.value,
        handleError: chain.handleError,
        handleLoad: chain.handleLoad,
        urls,
        waiting,
        exhausted,
      };
      return () => null;
    },
  });
  mountedWrappers.push(mountWithDefaults(Comp));
  return api;
}

beforeEach(() => {
  observerCallbacks.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── 失败定性：区分「代理不通」与「这张图没了」 ──────────────────────────────
//
// reportThumbnailUrlFailed 会把整个会话降级成原图直连，代价不小。而单看一条候选失败
// 分不清是代理挂了还是代理背后那张图被删了——用户在桶里删对象是常规操作。
// 候选链天然提供了区分手段：前一条失败、后一条成功，才说明问题出在前一条那个服务上。

describe('失败定性', () => {
  it('代理失败但原图成功 → 上报代理失败（确实是代理不可达）', () => {
    const h = mountChain([PROXY, ORIGIN]);

    h.handleError();
    expect(h.currentSrc()).toBe(ORIGIN);
    // 此刻还不能定性，必须等下一条出结果
    expect(reportFailedMock).not.toHaveBeenCalled();

    h.handleLoad();
    expect(reportFailedMock).toHaveBeenCalledWith(PROXY);
  });

  it('候选全部失败 → 不上报（是这张图没了，不能赖代理）', () => {
    const h = mountChain([PROXY, ORIGIN]);

    h.handleError();
    h.handleError();

    expect(reportFailedMock).not.toHaveBeenCalled();
    expect(h.exhausted).toHaveBeenCalledTimes(1);
  });

  it('首条直接成功 → 只上报成功', () => {
    const h = mountChain([PROXY, ORIGIN]);

    h.handleLoad();

    expect(reportFailedMock).not.toHaveBeenCalled();
    expect(reportLoadedMock).toHaveBeenCalledWith(PROXY);
  });

  it('候选列表换新后清掉未定性的失败，不会张冠李戴', async () => {
    const h = mountChain([PROXY, ORIGIN]);
    h.handleError();

    h.urls.value = ['https://other.example.com/b.png'];
    await nextTick();
    h.handleLoad();

    expect(reportFailedMock).not.toHaveBeenCalled();
  });
});

// ─── 超时兜底 ────────────────────────────────────────────────────────────────

describe('超时兜底', () => {
  it('进入视口后超时会翻到下一条', async () => {
    const h = mountChain([PROXY, ORIGIN]);
    enterViewport();
    await nextTick();

    vi.advanceTimersByTime(THUMB_LOAD_TIMEOUT_MS);

    expect(h.currentSrc()).toBe(ORIGIN);
  });

  // 回归：懒加载的图在视口外浏览器压根不发请求。收藏页一次渲染 80 格且无虚拟化，
  // 少了这层守卫就会让视口外那 60 多张在 5 秒后集体「超时」，把通着的代理判死。
  it('没进视口不计时（懒加载图根本没开始下载）', async () => {
    const h = mountChain([PROXY, ORIGIN]);
    await nextTick();

    vi.advanceTimersByTime(THUMB_LOAD_TIMEOUT_MS * 3);

    expect(h.currentSrc()).toBe(PROXY);
    expect(reportFailedMock).not.toHaveBeenCalled();
  });

  it('最后一条不掐断（翻不动了，掐断只会把「慢但能成」变成「直接失败」）', async () => {
    const h = mountChain([ORIGIN]);
    enterViewport();
    await nextTick();

    vi.advanceTimersByTime(THUMB_LOAD_TIMEOUT_MS * 3);

    expect(h.currentSrc()).toBe(ORIGIN);
    expect(h.exhausted).not.toHaveBeenCalled();
  });

  it('已经不在等待状态就不计时', async () => {
    const h = mountChain([PROXY, ORIGIN]);
    enterViewport();
    h.waiting.value = false;
    await nextTick();

    vi.advanceTimersByTime(THUMB_LOAD_TIMEOUT_MS * 2);

    expect(h.currentSrc()).toBe(PROXY);
  });

  it('超时翻页同样走「等下一条出结果」的定性流程', async () => {
    const h = mountChain([PROXY, ORIGIN]);
    enterViewport();
    await nextTick();

    vi.advanceTimersByTime(THUMB_LOAD_TIMEOUT_MS);
    expect(reportFailedMock).not.toHaveBeenCalled();

    h.handleLoad();
    expect(reportFailedMock).toHaveBeenCalledWith(PROXY);
  });

  it('不传 elementRef 时视为总在视口内（虚拟列表场景）', async () => {
    const h = mountChain([PROXY, ORIGIN], false);
    await nextTick();

    vi.advanceTimersByTime(THUMB_LOAD_TIMEOUT_MS);

    expect(h.currentSrc()).toBe(ORIGIN);
  });
});
