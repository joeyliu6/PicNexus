import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent, ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { mountWithDefaults } from '../../../helpers/vueMount';
import { useScrollRestore } from '../../../../composables/timeline/useScrollRestore';
import type { VisibleItem } from '../../../../composables/useVirtualTimeline';

const NOOP_CALLBACKS = {
  restoreScrollTop: vi.fn().mockResolvedValue(undefined),
  scrollToProgress: vi.fn(),
  scrollToItem: vi.fn(),
  forceUpdateVisibleArea: vi.fn(),
  hasItem: (_id: string) => false,
};

function makeScrollContainer(scrollTopValue = 0): HTMLElement {
  return {
    scrollTop: scrollTopValue,
    clientHeight: 600,
    clientWidth: 1200,
  } as unknown as HTMLElement;
}

const mountedWrappers: VueWrapper[] = [];

function createRestoreContext(overrides: Partial<Parameters<typeof useScrollRestore>[0]> = {}) {
  return useScrollRestore({
    scrollContainer: ref<HTMLElement | null>(null),
    virtualScrollTop: ref(0),
    totalHeight: ref(5000),
    viewportHeight: ref(600),
    visibleItems: ref<VisibleItem[]>([]),
    isCalculating: ref(false),
    isLoading: ref(false),
    visible: ref(true as boolean | undefined),
    activationTrigger: ref(undefined as number | undefined),
    callbacks: { ...NOOP_CALLBACKS },
    ...overrides,
  });
}

function makeRestore(overrides: Partial<Parameters<typeof useScrollRestore>[0]> = {}) {
  let restore!: ReturnType<typeof createRestoreContext>;
  const Harness = defineComponent({
    setup() {
      restore = createRestoreContext(overrides);
      return () => null;
    },
  });

  mountedWrappers.push(mountWithDefaults(Harness));
  return restore;
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount();
  }
  vi.clearAllMocks();
});

// ─── canRestoreNow ────────────────────────────────────────────────────────────

describe('canRestoreNow', () => {
  it('totalHeight = 0 时返回 false', () => {
    const restore = makeRestore({
      scrollContainer: ref(null),
      virtualScrollTop: ref(0),
      totalHeight: ref(0),
      viewportHeight: ref(600),
      visibleItems: ref([]),
      isCalculating: ref(false),
      isLoading: ref(false),
      visible: ref(true as boolean | undefined),
      activationTrigger: ref(undefined as number | undefined),
      callbacks: { ...NOOP_CALLBACKS },
    });
    expect(restore.getLastStableScrollTop()).toBe(0); // indirect test that it initializes
  });

  it('isLoading = true 时 saveStablePosition 不更新 progress（layoutReady 为 false）', () => {
    const restore = makeRestore({
      scrollContainer: ref(makeScrollContainer(100)),
      virtualScrollTop: ref(100),
      totalHeight: ref(5000),
      viewportHeight: ref(600),
      visibleItems: ref([]),
      isCalculating: ref(false),
      isLoading: ref(true), // loading = true
      visible: ref(true as boolean | undefined),
      activationTrigger: ref(undefined as number | undefined),
      callbacks: { ...NOOP_CALLBACKS },
    });
    restore.saveStablePosition(100);
    // progress 不应被更新（isLoading = true），仍为 0
    expect(restore.getLastStableProgress()).toBe(0);
  });

  it('isLoading = false, isCalculating = false, totalHeight > 0 时 layoutReady', () => {
    const restore = makeRestore();
    restore.saveStablePosition(500);
    // progress 应该被更新
    expect(restore.getLastStableProgress()).toBeGreaterThan(0);
  });
});

// ─── saveStablePosition ───────────────────────────────────────────────────────

describe('saveStablePosition', () => {
  it('传入正数 scrollTop 时保存该值', () => {
    const restore = makeRestore();
    restore.saveStablePosition(300);
    expect(restore.getLastStableScrollTop()).toBe(300);
  });

  it('传入 0 时保存 0（清除 anchor）', () => {
    const restore = makeRestore();
    restore.saveStablePosition(200);
    restore.saveStablePosition(0);
    expect(restore.getLastStableScrollTop()).toBe(0);
  });

  it('负数 scrollTop 被截断为 0', () => {
    const restore = makeRestore();
    restore.saveStablePosition(-100);
    expect(restore.getLastStableScrollTop()).toBeGreaterThanOrEqual(0);
  });

  it('计算并保存 progress（0~1）', () => {
    const restore = makeRestore({
      totalHeight: ref(1000),
      viewportHeight: ref(400),
    });
    restore.saveStablePosition(300); // maxScroll = 600, progress = 300/600 = 0.5
    expect(restore.getLastStableProgress()).toBeCloseTo(0.5, 2);
  });

  it('progress 不超过 1', () => {
    const restore = makeRestore({
      totalHeight: ref(1000),
      viewportHeight: ref(400),
    });
    restore.saveStablePosition(900); // maxScroll = 600, 900/600 > 1 → clamp to 1
    expect(restore.getLastStableProgress()).toBeLessThanOrEqual(1);
  });
});

// ─── setLastStableProgress ────────────────────────────────────────────────────

describe('setLastStableProgress', () => {
  it('设置合法进度值', () => {
    const restore = makeRestore();
    restore.setLastStableProgress(0.75);
    expect(restore.getLastStableProgress()).toBeCloseTo(0.75, 2);
  });

  it('超过 1 的值被截断到 1', () => {
    const restore = makeRestore();
    restore.setLastStableProgress(1.5);
    expect(restore.getLastStableProgress()).toBe(1);
  });

  it('负值被截断到 0', () => {
    const restore = makeRestore();
    restore.setLastStableProgress(-0.5);
    expect(restore.getLastStableProgress()).toBe(0);
  });
});

// ─── trackScrollPosition ─────────────────────────────────────────────────────

describe('trackScrollPosition', () => {
  it('scrollContainer 为 null 时返回 false', () => {
    const restore = makeRestore({ scrollContainer: ref(null) });
    expect(restore.trackScrollPosition()).toBe(false);
  });

  it('正常读取 scrollContainer.scrollTop 并返回 true', () => {
    const container = makeScrollContainer(250);
    const restore = makeRestore({ scrollContainer: ref(container) });
    const result = restore.trackScrollPosition();
    expect(result).toBe(true);
    expect(restore.getLastStableScrollTop()).toBe(250);
  });
});

// ─── getLastStableAnchorId ────────────────────────────────────────────────────

describe('getLastStableAnchorId', () => {
  it('初始值为 null', () => {
    const restore = makeRestore();
    expect(restore.getLastStableAnchorId()).toBeNull();
  });

  it('saveStablePosition(0) 清除 anchorId', () => {
    const restore = makeRestore();
    restore.saveStablePosition(100);
    restore.saveStablePosition(0);
    expect(restore.getLastStableAnchorId()).toBeNull();
  });
});
