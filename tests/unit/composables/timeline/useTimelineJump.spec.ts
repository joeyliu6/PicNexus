import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { PhotoGroup } from '@/composables/timeline/types';
import { createImageMeta, createPhotoGroup, resetTimelineFactorySequence } from '../../factories';

/**
 * 单测目标：useTimelineJump —— 图库刻度条点击 / 拖动跳到某年某月。
 *
 * 时间控制：跳转路径里有两个定时器窗口（ensureDaysLoaded 超时 2000ms、layout settled 超时 500ms），
 * 全程用 fake timers 驱动。
 */

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { useTimelineJump } = await import('@/composables/timeline/useTimelineJump');

// ─── 测试夹具 ────────────────────────────────────────────

interface GroupLayoutInfo {
  groupId: string;
  headerY: number;
  contentY: number;
  contentHeight: number;
}

function makeLayout(groupId: string, headerY: number, contentHeight = 300): GroupLayoutInfo {
  return { groupId, headerY, contentY: headerY + 36, contentHeight };
}

function makeScrollContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/**
 * 会把 scrollTop 夹到上限的容器——真实浏览器就是这么干的：内容还没撑够高度时
 * 写进去的 scrollTop 会被截断。happy-dom 默认原样接受，模拟不出这个行为，
 * 而跳转路径里那段「写完发现没写进去就再写一次」的兜底正是为它准备的。
 */
function makeClampingScrollContainer(maxScrollTop: number): HTMLElement {
  const el = makeScrollContainer();
  let current = 0;
  Object.defineProperty(el, 'scrollTop', {
    get: () => current,
    set: (value: number) => { current = Math.min(value, maxScrollTop); },
    configurable: true,
  });
  return el;
}

interface HarnessOverrides {
  scrollContainer?: HTMLElement | null;
  groups?: PhotoGroup[];
  isCalculating?: boolean;
  totalHeight?: number;
  viewportHeight?: number;
  layoutResult?: { groupLayouts: GroupLayoutInfo[] } | null;
  timePeriodStats?: Array<{ year: number; month: number }>;
  loadedDayKeys?: Set<string>;
  isFullyPreloaded?: boolean;
  hasLoadedStats?: boolean;
  /** 传 false 可省略这对可选回调，验证「调用方没传也不炸」 */
  withScrollAnchor?: boolean;
}

function mountHarness(overrides: HarnessOverrides = {}) {
  const scrollContainer = ref<HTMLElement | null>(
    overrides.scrollContainer === undefined ? makeScrollContainer() : overrides.scrollContainer,
  );
  const groupsRef = ref<PhotoGroup[]>(overrides.groups ?? []);
  const isCalculating = ref(overrides.isCalculating ?? false);
  const totalHeight = ref(overrides.totalHeight ?? 5000);
  const viewportHeight = ref(overrides.viewportHeight ?? 800);
  const layoutResult = ref<{ groupLayouts: GroupLayoutInfo[] } | null>(
    overrides.layoutResult === undefined ? { groupLayouts: [] } : overrides.layoutResult,
  );
  const statsRef = ref(overrides.timePeriodStats ?? []);
  const loadedDayKeys = ref(overrides.loadedDayKeys ?? new Set<string>());
  const isFullyPreloaded = ref(overrides.isFullyPreloaded ?? true);
  const hasLoadedStats = ref(overrides.hasLoadedStats ?? true);

  const fns = {
    scrollToProgress: vi.fn(),
    scrollToItem: vi.fn(),
    forceUpdateVisibleArea: vi.fn(),
    jumpToMonth: vi.fn().mockResolvedValue(true),
    ensureDaysLoaded: vi.fn().mockResolvedValue(undefined),
    prefetchDayAspectRatios: vi.fn().mockResolvedValue(undefined),
    forceNormalMode: vi.fn(),
    suspendScrollAnchor: vi.fn(),
    resumeScrollAnchor: vi.fn(),
  };

  const withAnchor = overrides.withScrollAnchor ?? true;

  let api!: ReturnType<typeof useTimelineJump>;
  const Harness = defineComponent({
    setup() {
      api = useTimelineJump({
        scrollContainer,
        groups: computed(() => groupsRef.value),
        isCalculating,
        totalHeight,
        viewportHeight,
        layoutResult: layoutResult as Ref<{ groupLayouts: GroupLayoutInfo[] } | null>,
        timePeriodStats: computed(() => statsRef.value),
        scrollToProgress: fns.scrollToProgress,
        scrollToItem: fns.scrollToItem,
        forceUpdateVisibleArea: fns.forceUpdateVisibleArea,
        jumpToMonth: fns.jumpToMonth,
        ensureDaysLoaded: fns.ensureDaysLoaded,
        prefetchDayAspectRatios: fns.prefetchDayAspectRatios,
        loadedDayKeys,
        isFullyPreloaded,
        hasLoadedStats,
        forceNormalMode: fns.forceNormalMode,
        suspendScrollAnchor: withAnchor ? fns.suspendScrollAnchor : undefined,
        resumeScrollAnchor: withAnchor ? fns.resumeScrollAnchor : undefined,
      });
      return () => h('div');
    },
  });

  mount(Harness);

  return {
    api: () => api,
    scrollContainer,
    isCalculating,
    fns,
  };
}

/**
 * 把跳转 Promise 跑完。
 * 跳转链路里最长的等待是 ensureDaysWithTimeout 的 2000ms，默认推 3000ms 足够覆盖；
 * advanceTimersByTimeAsync 会在每个定时器之间冲微任务队列。
 */
async function settle(promise: Promise<void>, ms = 3000): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await promise;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetTimelineFactorySequence();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── handleJumpToPeriod ──────────────────────────────────

describe('useTimelineJump - handleJumpToPeriod', () => {
  function jumpHarness(overrides: HarnessOverrides = {}) {
    return mountHarness({
      groups: [
        createPhotoGroup({ year: 2024, month: 2, day: 20 }),
        createPhotoGroup({ year: 2024, month: 2, day: 10 }),
        createPhotoGroup({ year: 2024, month: 1, day: 5 }),
      ],
      layoutResult: {
        groupLayouts: [
          makeLayout('2024-2-20', 0),
          makeLayout('2024-2-10', 500),
          makeLayout('2024-1-5', 1000),
        ],
      },
      ...overrides,
    });
  }

  it('does nothing before the day stats have loaded', async () => {
    const h = jumpHarness({ hasLoadedStats: false });

    await settle(h.api().handleJumpToPeriod(2024, 2));

    expect(h.fns.jumpToMonth).not.toHaveBeenCalled();
    expect(h.api().isJumping.value).toBe(false);
  });

  // 回归：图库刻度条拖动时一路经过的每个月都会请求跳转，跳转中来的请求曾被直接丢掉——
  // 松手停在的那个月若恰好赶上上一次还没落地，画面就停在半路的月份
  it('lands on the last month requested while a jump was running', async () => {
    const h = jumpHarness({ isFullyPreloaded: true });

    const first = h.api().handleJumpToPeriod(2024, 2);
    const passed = h.api().handleJumpToPeriod(2024, 2, 10);
    const last = h.api().handleJumpToPeriod(2024, 1);
    await settle(Promise.all([first, passed, last]).then(() => undefined));

    expect(h.fns.jumpToMonth.mock.calls).toEqual([[2024, 2], [2024, 1]]);
    expect(h.scrollContainer.value!.scrollTop).toBe(1000);
  });

  // 拖出去又拖回起点：最后要去的就是刚落地的位置，不再跳第二次
  it('does not jump again when the last request is where it just landed', async () => {
    const h = jumpHarness({ isFullyPreloaded: true });

    const first = h.api().handleJumpToPeriod(2024, 2);
    const away = h.api().handleJumpToPeriod(2024, 1);
    const back = h.api().handleJumpToPeriod(2024, 2);
    await settle(Promise.all([first, away, back]).then(() => undefined));

    expect(h.fns.jumpToMonth).toHaveBeenCalledTimes(1);
    expect(h.api().isJumping.value).toBe(false);
  });

  // 目标月不存在时 try 里提前 return，接着跳的那一步也不能被跳过
  it('still follows up with the last request when the running jump finds no month', async () => {
    const h = jumpHarness({ isFullyPreloaded: true });
    h.fns.jumpToMonth.mockResolvedValueOnce(false);

    const missing = h.api().handleJumpToPeriod(2025, 0);
    const last = h.api().handleJumpToPeriod(2024, 1);
    await settle(Promise.all([missing, last]).then(() => undefined));

    expect(h.fns.jumpToMonth.mock.calls).toEqual([[2025, 0], [2024, 1]]);
    expect(h.scrollContainer.value!.scrollTop).toBe(1000);
  });

  it('suspends the scroll anchor and forces normal mode before touching scrollTop', async () => {
    const h = jumpHarness();

    await settle(h.api().handleJumpToPeriod(2024, 2));

    expect(h.fns.suspendScrollAnchor).toHaveBeenCalled();
    expect(h.fns.forceNormalMode).toHaveBeenCalled();
    expect(h.fns.resumeScrollAnchor).toHaveBeenCalled();
    expect(h.api().isJumping.value).toBe(false);
  });

  it('still clears the jumping flag when the target month does not exist', async () => {
    const h = jumpHarness();
    h.fns.jumpToMonth.mockResolvedValue(false);

    await settle(h.api().handleJumpToPeriod(2025, 0));

    expect(h.api().isJumping.value).toBe(false);
    expect(h.fns.resumeScrollAnchor).toHaveBeenCalled();
    expect(h.fns.ensureDaysLoaded).not.toHaveBeenCalled();
  });

  // filter 把目标月整个滤掉时滚到顶，而不是停在原地让用户以为没点中
  it('scrolls to the top when the target month is filtered out of the groups', async () => {
    const h = jumpHarness({ groups: [createPhotoGroup({ year: 2024, month: 1, day: 5 })] });
    h.scrollContainer.value!.scrollTop = 1234;

    await settle(h.api().handleJumpToPeriod(2024, 2));

    expect(h.scrollContainer.value!.scrollTop).toBe(0);
  });

  it('lands directly on the target header when everything is preloaded', async () => {
    const h = jumpHarness({ isFullyPreloaded: true });

    await settle(h.api().handleJumpToPeriod(2024, 2));

    // 未传 day → 取月最新一天 2024-2-20，其 headerY = 0
    expect(h.scrollContainer.value!.scrollTop).toBe(0);
    expect(h.fns.forceUpdateVisibleArea).toHaveBeenCalled();
    expect(h.fns.ensureDaysLoaded).toHaveBeenCalled();
    // 精准落点路径不需要预取 aspectRatios
    expect(h.fns.prefetchDayAspectRatios).not.toHaveBeenCalled();
  });

  it('picks the day closest to the requested one', async () => {
    const h = jumpHarness({ isFullyPreloaded: true });

    await settle(h.api().handleJumpToPeriod(2024, 2, 11));

    // |10-11| < |20-11| → 落到 2024-2-10，其 headerY = 500
    expect(h.scrollContainer.value!.scrollTop).toBe(500);
  });

  // 与上一条方向相反：这次更近的是已经握在手里的那个候选，reduce 必须保留 best 而不是换成 g
  it('keeps the running best when the later day is further away', async () => {
    const h = jumpHarness({ isFullyPreloaded: true });

    await settle(h.api().handleJumpToPeriod(2024, 2, 19));

    // |20-19| < |10-19| → 仍是 2024-2-20，其 headerY = 0
    expect(h.scrollContainer.value!.scrollTop).toBe(0);
  });

  // 真实浏览器在内容还没撑够高度时会把 scrollTop 截断，落点会偏；
  // 这段兜底就是「写完发现没写进去，等一帧再写一次」，不然跳转会停在半路
  it('retries the scroll write when the browser clamps scrollTop', async () => {
    const container = makeClampingScrollContainer(0);
    const h = jumpHarness({ isFullyPreloaded: false, scrollContainer: container });

    await settle(h.api().handleJumpToPeriod(2024, 2, 11));

    // 被夹住写不进去，但流程不能因此卡死或抛错
    expect(container.scrollTop).toBe(0);
    expect(h.api().isJumping.value).toBe(false);
    expect(h.fns.forceNormalMode).toHaveBeenCalled();
  });

  it('leaves scrollTop alone when the target group has no layout entry yet', async () => {
    const h = jumpHarness({ isFullyPreloaded: true, layoutResult: { groupLayouts: [] } });
    h.scrollContainer.value!.scrollTop = 777;

    await settle(h.api().handleJumpToPeriod(2024, 2));

    expect(h.scrollContainer.value!.scrollTop).toBe(777);
  });

  it('prefetches aspect ratios on the downgrade path when the month is not cached', async () => {
    const h = jumpHarness({ isFullyPreloaded: false });

    await settle(h.api().handleJumpToPeriod(2024, 2));

    expect(h.fns.prefetchDayAspectRatios).toHaveBeenCalled();
    expect(h.fns.ensureDaysLoaded).toHaveBeenCalled();
    expect(h.scrollContainer.value!.scrollTop).toBe(0);
  });

  // 缓存已命中就别再花一次预取的等待，否则每次跳转都白等一轮
  it('skips the prefetch when every day of the target month is already cached', async () => {
    const h = jumpHarness({
      isFullyPreloaded: false,
      loadedDayKeys: new Set(['2024-2-20', '2024-2-10']),
    });

    await settle(h.api().handleJumpToPeriod(2024, 2));

    expect(h.fns.prefetchDayAspectRatios).not.toHaveBeenCalled();
    expect(h.fns.ensureDaysLoaded).toHaveBeenCalled();
  });

  it('only loads days within one month of the target', async () => {
    const h = jumpHarness({ isFullyPreloaded: true });

    await settle(h.api().handleJumpToPeriod(2024, 2));

    const keys = h.fns.ensureDaysLoaded.mock.calls[0][0] as string[];
    expect(keys).toEqual(['2024-2-20', '2024-2-10', '2024-1-5']);
  });

  it('falls back to the top when the downgrade path finds no layout for the target', async () => {
    const h = jumpHarness({ isFullyPreloaded: false, layoutResult: { groupLayouts: [] } });
    h.scrollContainer.value!.scrollTop = 999;

    await settle(h.api().handleJumpToPeriod(2024, 2));

    expect(h.scrollContainer.value!.scrollTop).toBe(0);
  });

  // 慢 IO 时 ensureDaysLoaded 可能永远不 resolve，2s 超时兜底必须让跳转照常收尾
  it('gives up waiting on a hung ensureDaysLoaded instead of hanging the jump', async () => {
    const h = jumpHarness({ isFullyPreloaded: true });
    h.fns.ensureDaysLoaded.mockReturnValue(new Promise(() => { /* 永不 resolve */ }));

    await settle(h.api().handleJumpToPeriod(2024, 2));

    expect(h.api().isJumping.value).toBe(false);
    expect(h.fns.resumeScrollAnchor).toHaveBeenCalled();
  });

  it('waits for an in-flight layout recalculation before landing', async () => {
    const h = jumpHarness({ isFullyPreloaded: false, isCalculating: true });

    const promise = h.api().handleJumpToPeriod(2024, 2);
    // 推进到 waitLayoutSettled 已注册 watch，再放行
    await vi.advanceTimersByTimeAsync(10);
    h.isCalculating.value = false;
    await settle(promise);

    expect(h.api().isJumping.value).toBe(false);
    expect(h.scrollContainer.value!.scrollTop).toBe(0);
  });

  // layout 永远算不完时靠 500ms 超时兜底，不能把跳转卡死
  it('stops waiting on the layout after the settle timeout', async () => {
    const h = jumpHarness({ isFullyPreloaded: false, isCalculating: true });

    await settle(h.api().handleJumpToPeriod(2024, 2));

    expect(h.api().isJumping.value).toBe(false);
  });

  it('survives a missing scroll container on both paths', async () => {
    const preloaded = mountHarness({ scrollContainer: null, isFullyPreloaded: true, groups: [createPhotoGroup({ year: 2024, month: 2, day: 20 })] });
    await settle(preloaded.api().handleJumpToPeriod(2024, 2));
    expect(preloaded.api().isJumping.value).toBe(false);

    const downgraded = mountHarness({ scrollContainer: null, isFullyPreloaded: false, groups: [createPhotoGroup({ year: 2024, month: 2, day: 20 })] });
    await settle(downgraded.api().handleJumpToPeriod(2024, 2));
    expect(downgraded.api().isJumping.value).toBe(false);
  });

  // suspend/resume 是可选参数，调用方可能不传
  it('does not require the optional scroll anchor callbacks', async () => {
    const h = jumpHarness({ withScrollAnchor: false });

    await settle(h.api().handleJumpToPeriod(2024, 2));

    expect(h.api().isJumping.value).toBe(false);
  });
});

// ─── handleJumpToYear ────────────────────────────────────

describe('useTimelineJump - handleJumpToYear', () => {
  it('scrolls to the first item of the earliest loaded group of that year', async () => {
    const meta = createImageMeta({ id: 'img-early' });
    const h = mountHarness({
      groups: [
        createPhotoGroup({ year: 2024, month: 5, day: 9, items: [createImageMeta()] }),
        createPhotoGroup({ year: 2024, month: 0, day: 1, items: [meta] }),
      ],
    });

    await settle(h.api().handleJumpToYear(2024));

    // groups 按时间降序，年内最早的一天是数组末尾那个
    expect(h.fns.scrollToItem).toHaveBeenCalledWith('img-early');
    expect(h.api().isJumping.value).toBe(false);
  });

  // 骨架天没有 items，只能按布局位置换算进度滚过去
  it('scrolls by layout progress when the earliest group is still a skeleton', async () => {
    const h = mountHarness({
      groups: [createPhotoGroup({ year: 2024, month: 0, day: 1 })],
      totalHeight: 5000,
      viewportHeight: 1000,
      layoutResult: { groupLayouts: [makeLayout('2024-0-1', 2000)] },
    });

    await settle(h.api().handleJumpToYear(2024));

    expect(h.fns.scrollToItem).not.toHaveBeenCalled();
    expect(h.fns.scrollToProgress).toHaveBeenCalledWith(2000 / 4000, true);
  });

  it('does not scroll by progress when everything already fits on screen', async () => {
    const h = mountHarness({
      groups: [createPhotoGroup({ year: 2024, month: 0, day: 1 })],
      totalHeight: 500,
      viewportHeight: 1000,
      layoutResult: { groupLayouts: [makeLayout('2024-0-1', 100)] },
    });

    await settle(h.api().handleJumpToYear(2024));

    expect(h.fns.scrollToProgress).not.toHaveBeenCalled();
  });

  it('clears the jumping flag even when there is no layout to aim at', async () => {
    const h = mountHarness({
      groups: [createPhotoGroup({ year: 2024, month: 0, day: 1 })],
      layoutResult: null,
    });

    await settle(h.api().handleJumpToYear(2024));

    expect(h.fns.scrollToProgress).not.toHaveBeenCalled();
    expect(h.api().isJumping.value).toBe(false);
  });

  // 跨年跳到尚未加载的区域时转交 handleJumpToPeriod
  it('delegates to the period jump when the year has no loaded groups', async () => {
    const h = mountHarness({
      groups: [createPhotoGroup({ year: 2024, month: 0, day: 1 })],
      timePeriodStats: [
        { year: 2022, month: 8 },
        { year: 2022, month: 3 },
      ],
      layoutResult: { groupLayouts: [] },
    });

    await settle(h.api().handleJumpToYear(2022));

    // stats 按时间降序，该年最早的月份在末尾
    expect(h.fns.jumpToMonth).toHaveBeenCalledWith(2022, 3);
  });

  it('does nothing when the year is absent from the period stats too', async () => {
    const h = mountHarness({ groups: [], timePeriodStats: [{ year: 2024, month: 0 }] });

    await settle(h.api().handleJumpToYear(2019));

    expect(h.fns.jumpToMonth).not.toHaveBeenCalled();
    expect(h.fns.scrollToItem).not.toHaveBeenCalled();
  });

  // 月份跳转还没落地时拖到了年份刻度：等它落地再跳那一年
  it('runs a year request made during a month jump after it lands', async () => {
    const meta = createImageMeta({ id: 'img-2023' });
    const h = mountHarness({
      groups: [
        createPhotoGroup({ year: 2024, month: 0, day: 1, items: [createImageMeta()] }),
        createPhotoGroup({ year: 2023, month: 5, day: 1, items: [meta] }),
      ],
      layoutResult: { groupLayouts: [makeLayout('2024-0-1', 0), makeLayout('2023-5-1', 600)] },
    });

    const month = h.api().handleJumpToPeriod(2024, 0);
    const yearJump = h.api().handleJumpToYear(2023);
    expect(h.fns.scrollToItem).not.toHaveBeenCalled();

    await settle(Promise.all([month, yearJump]).then(() => undefined));
    expect(h.fns.scrollToItem).toHaveBeenCalledWith('img-2023');
  });
});
