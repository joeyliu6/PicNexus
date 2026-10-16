import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetToastsForTests, dismissToast, MAX_TOASTS, pauseToasts, pushToast, resumeToasts, runToastAction, useToastItems,
} from '@/components/pn/toastStore';

const toasts = useToastItems();

describe('toastStore', () => {
  beforeEach(() => {
    __resetToastsForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps at most three, newest last, dropping the oldest plain toast', () => {
    for (const title of ['a', 'b', 'c', 'd']) pushToast({ kind: 'success', title });
    expect(MAX_TOASTS).toBe(3);
    expect(toasts.map((t) => t.title)).toEqual(['b', 'c', 'd']);
  });

  it('keeps an undo toast alive when newer toasts arrive', () => {
    const onExpire = vi.fn();
    pushToast({ kind: 'success', title: 'undo', countdown: true, action: { label: '撤销', run: vi.fn() }, onExpire });
    for (const title of ['b', 'c', 'd']) pushToast({ kind: 'info', title });

    expect(toasts.map((t) => t.title)).toEqual(['undo', 'c', 'd']);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('uses 4 s for plain toasts and 6 s for undo toasts', () => {
    pushToast({ kind: 'success', title: 'plain' });
    pushToast({ kind: 'success', title: 'undo', countdown: true });
    expect(toasts.map((t) => t.life)).toEqual([4000, 6000]);

    vi.advanceTimersByTime(4000);
    expect(toasts.map((t) => t.title)).toEqual(['undo']);
    vi.advanceTimersByTime(2000);
    expect(toasts).toHaveLength(0);
  });

  it('pauses every timer while hovered and resumes with the time that was left', () => {
    const onExpire = vi.fn();
    pushToast({ kind: 'success', title: 'x', life: 1000, onExpire });

    vi.advanceTimersByTime(600);
    pauseToasts();
    vi.advanceTimersByTime(5000);
    expect(onExpire).not.toHaveBeenCalled();

    resumeToasts();
    vi.advanceTimersByTime(399);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('runs the action once and skips onExpire', () => {
    const run = vi.fn();
    const onExpire = vi.fn();
    const id = pushToast({ kind: 'success', title: 'x', action: { label: '撤销', run }, onExpire });

    runToastAction(id);
    runToastAction(id);
    vi.advanceTimersByTime(10_000);

    expect(run).toHaveBeenCalledTimes(1);
    expect(onExpire).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(0);
  });

  it('dismisses without calling onExpire', () => {
    const onExpire = vi.fn();
    const id = pushToast({ kind: 'warn', title: 'x', onExpire });
    dismissToast(id);
    vi.advanceTimersByTime(10_000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
