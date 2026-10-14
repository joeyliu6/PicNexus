import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { useProgressPace } from '@/composables/link-check/useProgressPace';
import type { BatchCheckProgress } from '@/types/linkCheck';

let scope: EffectScope;

function setup() {
  const progress = ref<BatchCheckProgress | null>(null);
  scope = effectScope();
  const pace = scope.run(() => useProgressPace(progress))!;
  const tick = async (checked: number, total = 100) => {
    progress.value = { checked, total, current_url: '' };
    await nextTick();
  };
  return { progress, pace, tick };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { scope?.stop(); vi.useRealTimers(); });

describe('useProgressPace', () => {
  it('第一条进度只建基线；之后按速度估算剩余时间', async () => {
    const { pace, tick } = setup();

    await tick(10);
    expect(pace.etaSeconds.value).toBeNull();

    vi.advanceTimersByTime(2000);
    await tick(30);
    // 2 秒查了 20 条 → 10 条/秒，还剩 70 条 → 7 秒
    expect(pace.etaSeconds.value).toBe(7);
  });

  it('超过 10 秒没有新结果 → 判为卡在慢图床；有新结果立刻解除', async () => {
    const { pace, tick } = setup();
    await tick(10);

    vi.advanceTimersByTime(10_000);
    expect(pace.stalled.value).toBe(true);

    vi.advanceTimersByTime(1000);
    await tick(12);
    expect(pace.stalled.value).toBe(false);
  });

  it('检查结束（进度清空）→ 一切归零，下次从头算', async () => {
    const { progress, pace, tick } = setup();
    await tick(10);
    vi.advanceTimersByTime(1000);
    await tick(20);
    expect(pace.etaSeconds.value).not.toBeNull();

    progress.value = null;
    await nextTick();
    expect(pace.etaSeconds.value).toBeNull();
    expect(pace.stalled.value).toBe(false);

    vi.advanceTimersByTime(20_000);
    expect(pace.stalled.value).toBe(false);
  });
});
