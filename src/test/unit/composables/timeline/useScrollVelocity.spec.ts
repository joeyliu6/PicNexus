import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { useScrollVelocity } from '../../../../composables/timeline/useScrollVelocity';
import { DEFAULT_OPTIONS } from '../../../../composables/timeline/types';

function makeVelocity() {
  const scrollTop = ref(0);
  const viewportHeight = ref(600);
  const containerWidth = ref(1200);
  const layoutResult = ref(null);
  const visibleRowRange = ref<[number, number]>([0, 0]);
  const groups = ref<{ items: { id: string }[] }[]>([]);

  return {
    scrollTop,
    viewportHeight,
    containerWidth,
    layoutResult,
    visibleRowRange,
    groups,
    ...useScrollVelocity(scrollTop, viewportHeight, containerWidth, layoutResult, visibleRowRange, groups, DEFAULT_OPTIONS),
  };
}

describe('useScrollVelocity — 初始状态', () => {
  it('初始 displayMode 为 normal', () => {
    const { displayMode } = makeVelocity();
    expect(displayMode.value).toBe('normal');
  });

  it('初始 scrollVelocity 为 0', () => {
    const { scrollVelocity } = makeVelocity();
    expect(scrollVelocity.value).toBe(0);
  });

  it('初始 scrollDirection 为 null', () => {
    const { scrollDirection } = makeVelocity();
    expect(scrollDirection.value).toBeNull();
  });
});

describe('useScrollVelocity — scrollDirection 判断', () => {
  it('scrollTop 增加超过 5px 时方向为 down', () => {
    const ctx = makeVelocity();
    ctx.scrollTop.value = 100;
    ctx.updateScrollVelocity();
    expect(ctx.scrollDirection.value).toBe('down');
  });

  it('scrollTop 减少超过 5px 时方向为 up', () => {
    const ctx = makeVelocity();
    ctx.scrollTop.value = 100;
    ctx.updateScrollVelocity();
    ctx.scrollTop.value = 90;
    ctx.updateScrollVelocity();
    expect(ctx.scrollDirection.value).toBe('up');
  });
});

describe('useScrollVelocity — displayMode 切换', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('快速滚动时 displayMode 切换为 fast', () => {
    const ctx = makeVelocity();
    // 模拟极快速度：大位移 + 极短时间
    vi.spyOn(performance, 'now').mockReturnValue(0);
    ctx.updateScrollVelocity(); // 初始化时间
    vi.spyOn(performance, 'now').mockReturnValue(1); // 1ms 后
    ctx.scrollTop.value = 1000; // 1000px/1ms = 速度极快
    ctx.updateScrollVelocity();
    expect(ctx.displayMode.value).toBe('fast');
  });

  it('forceFastMode 立即切换为 fast', () => {
    const ctx = makeVelocity();
    ctx.forceFastMode();
    expect(ctx.displayMode.value).toBe('fast');
  });

  it('startModeRecovery 在 200ms 后恢复 normal', () => {
    const ctx = makeVelocity();
    ctx.forceFastMode();
    expect(ctx.displayMode.value).toBe('fast');
    ctx.startModeRecovery();
    vi.advanceTimersByTime(200);
    expect(ctx.displayMode.value).toBe('normal');
  });

  it('startModeRecovery 在 normal 模式下无效', () => {
    const ctx = makeVelocity();
    expect(ctx.displayMode.value).toBe('normal');
    ctx.startModeRecovery();
    vi.advanceTimersByTime(200);
    expect(ctx.displayMode.value).toBe('normal');
  });
});

describe('useScrollVelocity — resetVelocity', () => {
  it('resetVelocity 将 scrollVelocity 重置为 0', () => {
    const ctx = makeVelocity();
    ctx.resetVelocity();
    expect(ctx.scrollVelocity.value).toBe(0);
  });
});

describe('useScrollVelocity — cleanup', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.restoreAllMocks());

  it('cleanup 清除恢复定时器，不再触发 normal 切换', () => {
    const ctx = makeVelocity();
    ctx.forceFastMode();
    ctx.startModeRecovery();
    ctx.cleanup();
    vi.advanceTimersByTime(500);
    // 定时器已被清除，仍保持 fast
    expect(ctx.displayMode.value).toBe('fast');
  });
});

describe('useScrollVelocity — fastModeItems (降级网格)', () => {
  it('displayMode 为 normal 时返回空数组', () => {
    const ctx = makeVelocity();
    expect(ctx.fastModeItems.value).toHaveLength(0);
  });

  it('displayMode 为 fast 且有 groups 时计算网格占位符', () => {
    const ctx = makeVelocity();
    ctx.groups.value = [{ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }];
    ctx.containerWidth.value = 800;
    ctx.viewportHeight.value = 600;
    ctx.scrollTop.value = 0;
    ctx.forceFastMode();
    expect(ctx.fastModeItems.value.length).toBeGreaterThan(0);
  });

  it('displayMode 为 fast 但 groups 为空时返回空数组', () => {
    const ctx = makeVelocity();
    ctx.forceFastMode();
    ctx.groups.value = [];
    expect(ctx.fastModeItems.value).toHaveLength(0);
  });
});
