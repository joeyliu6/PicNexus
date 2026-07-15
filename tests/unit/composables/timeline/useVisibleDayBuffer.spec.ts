import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, computed, defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useVisibleDayBuffer } from '@/composables/timeline/useVisibleDayBuffer';
import type { DayStats } from '@/services/HistoryDatabase';

function makeDayStats(n: number): DayStats[] {
  return Array.from({ length: n }, (_, i) => ({
    year: 2025,
    month: 1,
    day: i + 1,
    count: 10,
  } as DayStats));
}

function dayKey(d: DayStats): string {
  return `${d.year}-${d.month}-${d.day}`;
}

describe('useVisibleDayBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function harness(options: {
    visibleDayKeys?: string[];
    dayStats?: DayStats[];
    bufferDays?: number;
    debounceMs?: number;
    ensureDaysLoaded?: (keys: string[]) => Promise<void>;
  }) {
    const stats = ref<DayStats[]>(options.dayStats ?? makeDayStats(10));
    const visible = ref<string[]>(options.visibleDayKeys ?? []);
    const ensureDaysLoaded = options.ensureDaysLoaded ?? vi.fn().mockResolvedValue(undefined);

    let api: { cleanup: () => void } | null = null;
    const Harness = defineComponent({
      setup() {
        api = useVisibleDayBuffer({
          visibleDayKeys: computed(() => visible.value),
          dayStats: stats,
          ensureDaysLoaded,
          bufferDays: options.bufferDays,
          debounceMs: options.debounceMs,
        });
        return () => h('div');
      },
    });

    const wrapper = mount(Harness);
    return { wrapper, api: () => api!, stats, visible, ensureDaysLoaded };
  }

  it('空 visibleKeys 不触发 ensureDaysLoaded', async () => {
    const h = harness({ ensureDaysLoaded: vi.fn().mockResolvedValue(undefined) });
    h.visible.value = [];
    await nextTick();
    vi.advanceTimersByTime(200);
    expect(h.ensureDaysLoaded).not.toHaveBeenCalled();
  });

  it('debounce 后扩展前后 bufferDays 并触发加载', async () => {
    const stats = makeDayStats(10);
    const ensure = vi.fn().mockResolvedValue(undefined);
    const h = harness({
      dayStats: stats,
      bufferDays: 2,
      debounceMs: 50,
      ensureDaysLoaded: ensure,
    });
    // 指向第 5 天（index 4）
    h.visible.value = [dayKey(stats[4])];
    await nextTick();
    vi.advanceTimersByTime(60);
    expect(ensure).toHaveBeenCalledTimes(1);
    const arg = ensure.mock.calls[0][0] as string[];
    // index 4 扩展 ±2 → index 2..6，共 5 天
    expect(arg).toHaveLength(5);
    expect(arg[0]).toBe(dayKey(stats[2]));
    expect(arg[4]).toBe(dayKey(stats[6]));
  });

  it('bufferDays 默认为 5', async () => {
    const stats = makeDayStats(20);
    const ensure = vi.fn().mockResolvedValue(undefined);
    const h = harness({
      dayStats: stats,
      debounceMs: 50,
      ensureDaysLoaded: ensure,
    });
    h.visible.value = [dayKey(stats[10])];
    await nextTick();
    vi.advanceTimersByTime(60);
    const arg = ensure.mock.calls[0][0] as string[];
    expect(arg).toHaveLength(11); // ±5 + 1
  });

  it('连续更新会清掉上次定时器', async () => {
    const stats = makeDayStats(10);
    const ensure = vi.fn().mockResolvedValue(undefined);
    const h = harness({
      dayStats: stats,
      debounceMs: 100,
      ensureDaysLoaded: ensure,
      bufferDays: 0,
    });
    h.visible.value = [dayKey(stats[0])];
    await nextTick();
    vi.advanceTimersByTime(50);
    h.visible.value = [dayKey(stats[5])];
    await nextTick();
    vi.advanceTimersByTime(50);
    // 还没到 100ms 的二次触发
    expect(ensure).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(ensure).toHaveBeenCalledTimes(1);
    // 最新一次的 key
    expect(ensure.mock.calls[0][0]).toContain(dayKey(stats[5]));
  });

  it('visible 里没有任何 key 命中 stats 时不调用', async () => {
    const ensure = vi.fn().mockResolvedValue(undefined);
    const h = harness({ ensureDaysLoaded: ensure, debounceMs: 50 });
    h.visible.value = ['9999-99-99'];
    await nextTick();
    vi.advanceTimersByTime(60);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('cleanup 能手动清掉 pending timer', async () => {
    const ensure = vi.fn().mockResolvedValue(undefined);
    const h = harness({ ensureDaysLoaded: ensure, debounceMs: 100 });
    h.visible.value = [dayKey(h.stats.value[0])];
    await nextTick();
    vi.advanceTimersByTime(50);
    h.api().cleanup();
    vi.advanceTimersByTime(200);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('卸载组件时自动清理', async () => {
    const ensure = vi.fn().mockResolvedValue(undefined);
    const h = harness({ ensureDaysLoaded: ensure, debounceMs: 100 });
    h.visible.value = [dayKey(h.stats.value[0])];
    await nextTick();
    h.wrapper.unmount();
    vi.advanceTimersByTime(200);
    expect(ensure).not.toHaveBeenCalled();
  });
});
