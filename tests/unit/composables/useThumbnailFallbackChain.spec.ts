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
/** 云元数据地址：任何放行策略下都必须拦掉，用户确认过也不行 */
const CLOUD_META = 'http://169.254.169.254/latest/meta-data/img.png';
/** 只有明文 HTTP 的图床域名（又拍云免费测试域名就是这个形态） */
const HTTP_HOST = 'img-ypyp.test.upcdn.net';
const PUBLIC_HTTP = `http://${HTTP_HOST}/a.png`;

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
  hosts: Ref<Set<string> | undefined>;
  exhausted: ReturnType<typeof vi.fn>;
}

function mountChain(
  initialUrls: string[],
  withElementRef = true,
  initialHosts?: Set<string>,
): Harness {
  let api!: Harness;
  const Comp = defineComponent({
    setup() {
      const urls = ref(initialUrls);
      const waiting = ref(true);
      const hosts = ref<Set<string> | undefined>(initialHosts);
      const exhausted = vi.fn();
      const el = ref<HTMLElement | null>(document.createElement('div'));
      const chain = useThumbnailFallbackChain({
        urls: () => urls.value,
        isWaiting: () => waiting.value,
        onExhausted: exhausted,
        confirmedHttpHosts: () => hosts.value,
        ...(withElementRef ? { elementRef: el } : {}),
      });
      api = {
        currentSrc: () => chain.currentSrc.value,
        handleError: chain.handleError,
        handleLoad: chain.handleLoad,
        urls,
        waiting,
        hosts,
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

// ─── URL 安全过滤 ────────────────────────────────────────────────────────────
//
// 2026-08-19 给 CSP 的 `img-src` 放开 `http:` 之前，CSP 是收藏页 / 时间轴唯一的图片闸门
// （这两个视图不像 ThumbnailImage 那样过 safeImageUrl）。放开之后它们一道闸都没有，
// 链路本地 / 云元数据地址能被直接塞进 `<img>`。本组断言这道闸确实装上了。

describe('URL 安全过滤', () => {
  it('云元数据地址不会进 currentSrc，直接落到后面的安全候选', () => {
    const h = mountChain([CLOUD_META, ORIGIN]);

    expect(h.currentSrc()).toBe(ORIGIN);
  });

  it('未经确认的公网明文 HTTP 候选被剔除', () => {
    const h = mountChain([PUBLIC_HTTP, ORIGIN]);

    expect(h.currentSrc()).toBe(ORIGIN);
  });

  it('用户已确认的明文 HTTP 域名照常放行（又拍云那类只有 HTTP 的图床）', () => {
    const h = mountChain([PUBLIC_HTTP, ORIGIN], true, new Set([HTTP_HOST]));

    expect(h.currentSrc()).toBe(PUBLIC_HTTP);
  });

  it('已确认也救不了云元数据地址（确认的是图床域名，不是这个）', () => {
    const h = mountChain([CLOUD_META, ORIGIN], true, new Set(['169.254.169.254']));

    expect(h.currentSrc()).toBe(ORIGIN);
  });

  it('正常 https 候选完全不受影响', () => {
    const h = mountChain([PROXY, ORIGIN]);

    expect(h.currentSrc()).toBe(PROXY);
  });

  it('被过滤的候选不占位：翻页时直接跳过它', () => {
    const h = mountChain([PROXY, CLOUD_META, ORIGIN]);
    expect(h.currentSrc()).toBe(PROXY);

    h.handleError();

    expect(h.currentSrc()).toBe(ORIGIN);
  });

  // 被过滤的候选压根没发出过请求，不能当失败证据——否则会在下一条加载成功时
  // 套用「前一条挂、这一条通」的判据，把无辜的服务判死、整个会话降级成原图直连。
  it('被过滤的候选不算失败证据，不会误判服务不可用', () => {
    const h = mountChain([CLOUD_META, PROXY]);

    h.handleLoad();

    expect(reportFailedMock).not.toHaveBeenCalled();
    expect(reportLoadedMock).toHaveBeenCalledWith(PROXY);
  });

  it('候选全被过滤 → 走 onExhausted，不能卡在骨架屏', () => {
    const h = mountChain([CLOUD_META, PUBLIC_HTTP]);

    expect(h.currentSrc()).toBe('');
    expect(h.exhausted).toHaveBeenCalledTimes(1);
  });

  // 反向判据：原始候选就是空表示上游还没算出候选，那是改动前就有的行为，
  // 报失败会把还没轮到的格子提前判死。
  it('原始候选本来就是空 → 不报失败', () => {
    const h = mountChain([]);

    expect(h.exhausted).not.toHaveBeenCalled();
  });

  it('候选中途换成全不安全的一批也会收尾', async () => {
    const h = mountChain([ORIGIN]);
    expect(h.exhausted).not.toHaveBeenCalled();

    h.urls.value = [CLOUD_META];
    await nextTick();

    expect(h.currentSrc()).toBe('');
    expect(h.exhausted).toHaveBeenCalledTimes(1);
  });

  it('用户在设置页确认域名后，同会话内的候选立刻重新纳入', async () => {
    const h = mountChain([PUBLIC_HTTP, ORIGIN]);
    expect(h.currentSrc()).toBe(ORIGIN);

    h.hosts.value = new Set([HTTP_HOST]);
    await nextTick();

    expect(h.currentSrc()).toBe(PUBLIC_HTTP);
  });

  // 超时兜底的「后面还有候选」判据必须按过滤后的链长算，否则会为一条永远轮不到的
  // 候选掐断当前这张，把「慢但最终能成」变成「直接失败」。
  it('超时兜底以过滤后的链长为准：过滤后只剩一条时不掐断', async () => {
    const h = mountChain([ORIGIN, CLOUD_META]);
    enterViewport();
    await nextTick();

    vi.advanceTimersByTime(THUMB_LOAD_TIMEOUT_MS * 3);

    expect(h.currentSrc()).toBe(ORIGIN);
    expect(h.exhausted).not.toHaveBeenCalled();
  });
});
