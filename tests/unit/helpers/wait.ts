import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { vi } from 'vitest';

export { flushPromises };

export async function flushTicks(count = 1): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await nextTick();
  }
}
export async function flushPromisesAndTicks(tickCount = 1): Promise<void> {
  await flushPromises();
  await flushTicks(tickCount);
}

export async function wait(ms = 0): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function advanceTimersByTime(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flushPromisesAndTicks();
}

export async function runPendingTimers(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
  await flushPromisesAndTicks();
}

export function useFakeTimers(options?: Parameters<typeof vi.useFakeTimers>[0]) {
  vi.useFakeTimers(options);

  return {
    advanceBy: advanceTimersByTime,
    runPending: runPendingTimers,
    restore: () => vi.useRealTimers(),
  };
}
