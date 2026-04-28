import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type Ref } from 'vue';
import { useDebouncedTrue } from '../../../composables/useDebouncedTrue';

describe('useDebouncedTrue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function runComposable(source: Ref<boolean>, delayMs = 100) {
    const scope = effectScope();
    let debounced!: Ref<boolean>;
    scope.run(() => {
      debounced = useDebouncedTrue(source, delayMs);
    });
    return { debounced, stop: () => scope.stop() };
  }

  it('requires true to remain stable for the delay', async () => {
    const source = ref(false);
    const { debounced, stop } = runComposable(source);

    expect(debounced.value).toBe(false);

    source.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(99);
    expect(debounced.value).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(debounced.value).toBe(true);

    stop();
  });

  it('turns false immediately and cancels pending true timers', async () => {
    const source = ref(false);
    const { debounced, stop } = runComposable(source);

    source.value = true;
    await nextTick();
    source.value = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(100);
    expect(debounced.value).toBe(false);

    source.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(100);
    expect(debounced.value).toBe(true);

    source.value = false;
    await nextTick();
    expect(debounced.value).toBe(false);

    stop();
  });

  it('clears a pending timer when the effect scope is disposed', async () => {
    const source = ref(true);
    const { debounced, stop } = runComposable(source);

    await nextTick();
    stop();
    await vi.advanceTimersByTimeAsync(100);

    expect(debounced.value).toBe(false);
  });
});
