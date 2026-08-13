import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { PhotoGroup } from '@/composables/timeline/types';
import { createImageMeta, createPhotoGroup, resetTimelineFactorySequence } from '../../factories';

/**
 * 单测目标：useTimelineDragAndSkeleton —— 时间轴的拖拽滚动 / 跳转骨架 / 指示器定位。
 *
 * 为什么必须新开 spec：tests/unit/components/timelineComponents.spec.ts:194 把整个模块
 * vi.mock 掉了，3.8% 的 10/263 行只是 mock factory 求值的残留，functions 0/1 意味着
 * 真实函数体一次都没跑过。所以这里直连真实实现，不碰那个 spec。
 *
 * 时间控制：跳转路径里埋了 4 个定时器窗口（骨架最小显示 400ms、首屏骨架 700ms、
 * ensureDaysLoaded 超时 2000ms、layout settled 超时 500ms），全程用 fake timers 驱动，
 * 否则单个用例就要真等 400ms 起步。
 */

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { useTimelineDragAndSkeleton } = await import('@/composables/timeline/useTimelineDragAndSkeleton');

/** 与被测文件内部常量保持一致，改那边要同步改这里 */
const SKELETON_MIN_DISPLAY_MS = 400;
const FIRST_LOAD_MIN_DISPLAY_MS = 700;
const DRAG_END_DELAY_MS = 50;
const SIDEBAR_WIDTH_PX = 90;

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

/**
 * 造一个可用于 skeletonLayout 宽度计算的滚动容器。
 * happy-dom 下 clientWidth 恒为 0，padding 也要写成内联样式 getComputedStyle 才读得到。
 */
function makeScrollContainer(clientWidth = 800): HTMLElement {
  const el = document.createElement('div');
  el.style.paddingLeft = '10px';
  el.style.paddingRight = '14px';
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
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
  visible?: boolean | undefined;
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
  const visibleRef = ref<boolean | undefined>(overrides.visible ?? true);
  const isCalculating = ref(overrides.isCalculating ?? false);
  const totalHeight = ref(overrides.totalHeight ?? 5000);
  const scrollProgress = ref(0);
  const viewportHeight = ref(overrides.viewportHeight ?? 800);
  const layoutResult = ref<{ groupLayouts: GroupLayoutInfo[] } | null>(
    overrides.layoutResult === undefined ? { groupLayouts: [] } : overrides.layoutResult,
  );
  const statsRef = ref(overrides.timePeriodStats ?? []);
  const loadedDayKeys = ref(overrides.loadedDayKeys ?? new Set<string>());
  const isFullyPreloaded = ref(overrides.isFullyPreloaded ?? true);
  const hasLoadedStats = ref(overrides.hasLoadedStats ?? true);

  const fns = {
    setLastStableProgress: vi.fn(),
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

  let api!: ReturnType<typeof useTimelineDragAndSkeleton>;
  const Harness = defineComponent({
    setup() {
      api = useTimelineDragAndSkeleton({
        scrollContainer,
        groups: computed(() => groupsRef.value),
        isCalculating,
        visible: computed(() => visibleRef.value),
        totalHeight,
        scrollProgress,
        viewportHeight,
        layoutResult: layoutResult as Ref<{ groupLayouts: GroupLayoutInfo[] } | null>,
        timePeriodStats: computed(() => statsRef.value),
        setLastStableProgress: fns.setLastStableProgress,
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

  const wrapper = mount(Harness);

  return {
    wrapper,
    api: () => api,
    scrollContainer,
    groupsRef,
    visibleRef,
    isCalculating,
    totalHeight,
    viewportHeight,
    layoutResult,
    statsRef,
    loadedDayKeys,
    isFullyPreloaded,
    hasLoadedStats,
    fns,
  };
}

/**
 * 把跳转 Promise 跑完。
 * 跳转链路里最长的等待是 ensureDaysWithTimeout 的 2000ms，加上 min-display 400ms，
 * 默认推 3000ms 足够覆盖；advanceTimersByTimeAsync 会在每个定时器之间冲微任务队列。
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

// ─── ① 首屏骨架触发 ──────────────────────────────────────

describe('useTimelineDragAndSkeleton - 首屏骨架触发', () => {
  it('raises the first-load skeleton when groups go from empty to non-empty while visible', async () => {
    const h = mountHarness({ groups: [], visible: true });

    expect(h.api().isFirstLoadSkeleton.value).toBe(false);

    h.groupsRef.value = [createPhotoGroup({ year: 2024, month: 0, day: 1 })];
    await nextTick();

    expect(h.api().isFirstLoadSkeleton.value).toBe(true);

    // 到点自动撤，不需要调用方手动复位
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_MIN_DISPLAY_MS);
    expect(h.api().isFirstLoadSkeleton.value).toBe(false);
  });

  it('stays quiet when data arrives while the view is hidden', async () => {
    const h = mountHarness({ groups: [], visible: false });

    h.groupsRef.value = [createPhotoGroup()];
    await nextTick();

    expect(h.api().isFirstLoadSkeleton.value).toBe(false);
  });

  // 场景：数据在幕后加载完了，用户之后才切到时间轴——这时 groups 长度没有 0→N 的跳变，
  // 只能靠 visible 的 false→true 补触发，否则首屏没有骨架期直接硬切
  it('back-fills the skeleton when the view becomes visible after data already arrived', async () => {
    const h = mountHarness({ groups: [createPhotoGroup()], visible: false });

    h.visibleRef.value = true;
    await nextTick();

    expect(h.api().isFirstLoadSkeleton.value).toBe(true);
  });

  it('never triggers the back-fill twice', async () => {
    const h = mountHarness({ groups: [createPhotoGroup()], visible: false });

    h.visibleRef.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_MIN_DISPLAY_MS);
    expect(h.api().isFirstLoadSkeleton.value).toBe(false);

    h.visibleRef.value = false;
    await nextTick();
    h.visibleRef.value = true;
    await nextTick();

    expect(h.api().isFirstLoadSkeleton.value).toBe(false);
  });

  it('does not back-fill while there is still no data', async () => {
    const h = mountHarness({ groups: [], visible: false });

    h.visibleRef.value = true;
    await nextTick();

    expect(h.api().isFirstLoadSkeleton.value).toBe(false);
  });

  // groups N→0→N（filter 来回切）会二次触发，此时旧定时器必须被清掉，
  // 否则第一次的 700ms 到点会把第二次的骨架期提前撤掉
  it('restarts the timer instead of letting the previous one cut the window short', async () => {
    const h = mountHarness({ groups: [], visible: true });

    h.groupsRef.value = [createPhotoGroup({ day: 1 })];
    await nextTick();
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_MIN_DISPLAY_MS - 100);

    h.groupsRef.value = [];
    await nextTick();
    h.groupsRef.value = [createPhotoGroup({ day: 2 })];
    await nextTick();

    // 若旧定时器没被清，再走 100ms 就会被它撤掉
    await vi.advanceTimersByTimeAsync(150);
    expect(h.api().isFirstLoadSkeleton.value).toBe(true);

    await vi.advanceTimersByTimeAsync(FIRST_LOAD_MIN_DISPLAY_MS);
    expect(h.api().isFirstLoadSkeleton.value).toBe(false);
  });
});

// ─── ② loadedMonthsSet ───────────────────────────────────

describe('useTimelineDragAndSkeleton - loadedMonthsSet', () => {
  it('marks a month loaded only when every one of its days is loaded', () => {
    const groups = [
      createPhotoGroup({ year: 2024, month: 0, day: 1 }),
      createPhotoGroup({ year: 2024, month: 0, day: 2 }),
      createPhotoGroup({ year: 2024, month: 1, day: 3 }),
    ];
    const h = mountHarness({
      groups,
      loadedDayKeys: new Set(['2024-0-1', '2024-0-2', '2024-1-3']),
    });

    expect(h.api().loadedMonthsSet.value.has('2024-0')).toBe(true);
    expect(h.api().loadedMonthsSet.value.has('2024-1')).toBe(true);
  });

  // 半加载的月要算「未加载」，否则点击它会走本地滚动而不是 jump-to-period 预取路径
  it('treats a partially loaded month as not loaded', () => {
    const h = mountHarness({
      groups: [
        createPhotoGroup({ year: 2024, month: 0, day: 1 }),
        createPhotoGroup({ year: 2024, month: 0, day: 2 }),
      ],
      loadedDayKeys: new Set(['2024-0-1']),
    });

    expect(h.api().loadedMonthsSet.value.has('2024-0')).toBe(false);
  });

  // 与上一条的区别是「先遇到的那天」没加载：计数器初始化和后续累加是两条不同的路径
  it('treats a month as not loaded when its very first day is missing', () => {
    const h = mountHarness({
      groups: [
        createPhotoGroup({ year: 2024, month: 0, day: 1 }),
        createPhotoGroup({ year: 2024, month: 0, day: 2 }),
      ],
      loadedDayKeys: new Set(['2024-0-2']),
    });

    expect(h.api().loadedMonthsSet.value.has('2024-0')).toBe(false);
  });

  it('returns an empty set when there are no groups', () => {
    const h = mountHarness({ groups: [] });
    expect(h.api().loadedMonthsSet.value.size).toBe(0);
  });
});

// ─── ③ monthLayoutPositions ──────────────────────────────

describe('useTimelineDragAndSkeleton - monthLayoutPositions', () => {
  it('returns an empty map when the layout has not been computed yet', () => {
    const h = mountHarness({ layoutResult: null });
    expect(h.api().monthLayoutPositions.value.size).toBe(0);
  });

  it('returns an empty map when the total height is still zero', () => {
    const h = mountHarness({ totalHeight: 0, layoutResult: { groupLayouts: [makeLayout('2024-0-1', 0)] } });
    expect(h.api().monthLayoutPositions.value.size).toBe(0);
  });

  it('spans a month from its first header down to its furthest group end', () => {
    const h = mountHarness({
      groups: [
        createPhotoGroup({ year: 2024, month: 0, day: 1 }),
        createPhotoGroup({ year: 2024, month: 0, day: 2 }),
      ],
      totalHeight: 5000,
      viewportHeight: 1000,
      layoutResult: {
        groupLayouts: [
          makeLayout('2024-0-1', 0, 300),
          makeLayout('2024-0-2', 800, 400),
        ],
      },
    });

    const maxScroll = 5000 - 1000;
    const pos = h.api().monthLayoutPositions.value.get('2024-0')!;
    expect(pos.start).toBeCloseTo(0 / maxScroll);
    // end 取同月各 group 的 contentY + contentHeight 的最大值：800 + 36 + 400
    expect(pos.end).toBeCloseTo(1236 / maxScroll);
  });

  // layout 与 groups 是两个数据源，重算过程中会短暂对不齐；对不上的 groupId 必须跳过而不是崩
  it('skips layout entries whose group is no longer in the data', () => {
    const h = mountHarness({
      groups: [createPhotoGroup({ year: 2024, month: 0, day: 1 })],
      layoutResult: {
        groupLayouts: [makeLayout('2024-0-1', 0), makeLayout('stale-group', 900)],
      },
    });

    expect(h.api().monthLayoutPositions.value.size).toBe(1);
    expect(h.api().monthLayoutPositions.value.has('2024-0')).toBe(true);
  });

  it('clamps positions to 1 when a group sits past the maximum scroll', () => {
    const h = mountHarness({
      groups: [createPhotoGroup({ year: 2024, month: 0, day: 1 })],
      totalHeight: 1200,
      viewportHeight: 1000,
      layoutResult: { groupLayouts: [makeLayout('2024-0-1', 9999, 500)] },
    });

    const pos = h.api().monthLayoutPositions.value.get('2024-0')!;
    expect(pos.start).toBe(1);
    expect(pos.end).toBe(1);
  });
});

// ─── ④ visibleRatio ──────────────────────────────────────

describe('useTimelineDragAndSkeleton - visibleRatio', () => {
  it('reports a full viewport when the content fits on one screen', () => {
    const h = mountHarness({ totalHeight: 500, viewportHeight: 800 });
    expect(h.api().visibleRatio.value).toBe(1);
  });

  it('reports the viewport share of the total height otherwise', () => {
    const h = mountHarness({ totalHeight: 4000, viewportHeight: 800 });
    expect(h.api().visibleRatio.value).toBeCloseTo(0.2);
  });
});

// ─── ⑤ skeletonLayout ────────────────────────────────────

describe('useTimelineDragAndSkeleton - skeletonLayout', () => {
  it('derives the skeleton width from the scroll container minus its padding', () => {
    const h = mountHarness({ viewportHeight: 600 });
    const layout = h.api().skeletonLayout.value;

    // 容器 800 − padding 10 − 14 = 776，骨架项不应超出这个宽度
    expect(layout.items.length).toBeGreaterThan(0);
    for (const item of layout.items) {
      expect(item.x + item.width).toBeLessThanOrEqual(776 + 1);
    }
  });

  // 容器还没挂上（首帧）时用窗口宽度兜底，否则骨架宽度为 0、整屏空白
  it('falls back to the window width when the container is not mounted yet', () => {
    const h = mountHarness({ scrollContainer: null, viewportHeight: 0 });
    const layout = h.api().skeletonLayout.value;

    const fallbackWidth = window.innerWidth - SIDEBAR_WIDTH_PX;
    expect(layout.items.length).toBeGreaterThan(0);
    for (const item of layout.items) {
      expect(item.x + item.width).toBeLessThanOrEqual(fallbackWidth + 1);
    }
  });
});

// ─── ⑥ handleJumpToPeriod ────────────────────────────────

describe('useTimelineDragAndSkeleton - handleJumpToPeriod', () => {
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

  // 重入守卫：连点两次月份不能让两段跳转互相踩 isJumping
  it('ignores a second jump while one is still in flight', async () => {
    const h = jumpHarness();

    const first = h.api().handleJumpToPeriod(2024, 2);
    const second = h.api().handleJumpToPeriod(2024, 1);

    await settle(Promise.all([first, second]).then(() => undefined));

    expect(h.fns.jumpToMonth).toHaveBeenCalledTimes(1);
    expect(h.fns.jumpToMonth).toHaveBeenCalledWith(2024, 2);
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

  // 慢 IO 时 ensureDaysLoaded 可能永远不 resolve，2s 超时兜底必须让骨架期照常收尾
  it('gives up waiting on a hung ensureDaysLoaded instead of hanging the skeleton', async () => {
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

  // suspend/resume 是可选参数，Timeline 之外的调用方可能不传
  it('does not require the optional scroll anchor callbacks', async () => {
    const h = jumpHarness({ withScrollAnchor: false });

    await settle(h.api().handleJumpToPeriod(2024, 2));

    expect(h.api().isJumping.value).toBe(false);
  });

  it('holds the skeleton for the minimum display window even on a cache hit', async () => {
    const h = jumpHarness({ isFullyPreloaded: true });

    const promise = h.api().handleJumpToPeriod(2024, 2);
    await vi.advanceTimersByTimeAsync(SKELETON_MIN_DISPLAY_MS - 50);
    // 数据早就回来了，但骨架必须还盖着——否则缓存命中时会刺眼地瞬间闪一下
    expect(h.api().isJumping.value).toBe(true);

    await settle(promise);
    expect(h.api().isJumping.value).toBe(false);
  });
});

// ─── ⑦ handleJumpToYear ──────────────────────────────────

describe('useTimelineDragAndSkeleton - handleJumpToYear', () => {
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

  // 跨年跳到尚未加载的区域时转交 handleJumpToPeriod，由它负责盖骨架
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

  it('ignores a year jump while another jump is in flight', async () => {
    const h = mountHarness({
      groups: [createPhotoGroup({ year: 2024, month: 0, day: 1, items: [createImageMeta()] })],
    });

    const first = h.api().handleJumpToYear(2024);
    const second = h.api().handleJumpToYear(2024);
    await settle(Promise.all([first, second]).then(() => undefined));

    expect(h.fns.scrollToItem).toHaveBeenCalledTimes(1);
  });
});

// ─── ⑧ 拖拽滚动与清理 ────────────────────────────────────

describe('useTimelineDragAndSkeleton - 拖拽滚动与清理', () => {
  it('forwards sidebar wheel deltas to the scroll container', () => {
    const h = mountHarness();
    h.scrollContainer.value!.scrollTop = 100;

    h.api().handleSidebarWheel({ deltaY: 42 } as WheelEvent);

    expect(h.scrollContainer.value!.scrollTop).toBe(142);
  });

  it('ignores sidebar wheel events before the container is mounted', () => {
    const h = mountHarness({ scrollContainer: null });
    expect(() => h.api().handleSidebarWheel({ deltaY: 42 } as WheelEvent)).not.toThrow();
  });

  it('marks dragging, scrolls to the progress and settles after the drag-end delay', async () => {
    const h = mountHarness();

    await h.api().handleDragScroll(0.42);

    expect(h.fns.setLastStableProgress).toHaveBeenCalledWith(0.42);
    expect(h.fns.scrollToProgress).toHaveBeenCalledWith(0.42, true);
    expect(h.api().getIsDragging()).toBe(true);

    await vi.advanceTimersByTimeAsync(DRAG_END_DELAY_MS);

    expect(h.api().getIsDragging()).toBe(false);
    expect(h.fns.forceUpdateVisibleArea).toHaveBeenCalled();
  });

  // 连续拖动必须不断顺延结束判定，否则拖到一半就被判成「停手了」
  it('pushes the drag-end deadline back on every move', async () => {
    const h = mountHarness();

    await h.api().handleDragScroll(0.1);
    await vi.advanceTimersByTimeAsync(DRAG_END_DELAY_MS - 10);
    await h.api().handleDragScroll(0.2);
    await vi.advanceTimersByTimeAsync(DRAG_END_DELAY_MS - 10);

    expect(h.api().getIsDragging()).toBe(true);

    await vi.advanceTimersByTimeAsync(DRAG_END_DELAY_MS);
    expect(h.api().getIsDragging()).toBe(false);
  });

  it('accepts the legacy source argument without changing behaviour', async () => {
    const h = mountHarness();

    await h.api().handleDragScroll(0.5, 'click');

    expect(h.fns.scrollToProgress).toHaveBeenCalledWith(0.5, true);
  });

  it('cancels pending timers when cleanup runs', async () => {
    const h = mountHarness({ groups: [], visible: true });

    h.groupsRef.value = [createPhotoGroup()];
    await nextTick();
    await h.api().handleDragScroll(0.3);

    h.api().cleanup();
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_MIN_DISPLAY_MS + DRAG_END_DELAY_MS);

    // 定时器被清掉了，所以两个「到点复位」都不会发生
    expect(h.api().isFirstLoadSkeleton.value).toBe(true);
    expect(h.api().getIsDragging()).toBe(true);
  });

  // 防御性清理：调用方忘了调 cleanup 时，卸载也要能释放定时器
  it('cleans up on unmount even when the caller forgets', async () => {
    const h = mountHarness();

    await h.api().handleDragScroll(0.3);
    h.wrapper.unmount();
    await vi.advanceTimersByTimeAsync(DRAG_END_DELAY_MS * 4);

    expect(h.api().getIsDragging()).toBe(true);
  });

  it('is safe to call cleanup with no timers pending', () => {
    const h = mountHarness();
    expect(() => h.api().cleanup()).not.toThrow();
  });
});
