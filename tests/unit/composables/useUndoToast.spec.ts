import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUndoToast } from '@/composables/useUndoToast';
import { suppressToasts } from '@/composables/useToast';
import { __resetToastsForTests, runToastAction, useToastItems } from '@/components/pn/toastStore';

const toasts = useToastItems();

describe('useUndoToast', () => {
  beforeEach(() => {
    __resetToastsForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    suppressToasts(false);
    vi.useRealTimers();
  });

  it('shows a countdown toast with an undo button', () => {
    void useUndoToast().show('确认删除', 3);

    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ title: '确认删除', countdown: true, life: 3000 });
    expect(toasts[0].action?.label).toBe('撤销');
  });

  it('resolves true once the countdown ends', async () => {
    const result = useUndoToast().show('delete', 2);

    vi.advanceTimersByTime(1999);
    expect(toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);

    await expect(result).resolves.toBe(true);
    expect(toasts).toHaveLength(0);
  });

  it('resolves false and confirms the undo when the button is pressed', async () => {
    const result = useUndoToast().show('delete', 5);

    runToastAction(toasts[0].id);

    await expect(result).resolves.toBe(false);
    expect(toasts.map((t) => t.title)).toEqual(['已撤销']);
    vi.advanceTimersByTime(10_000);
  });

  it('cancels the previous round when shown again', async () => {
    const undo = useUndoToast();
    const first = undo.show('first', 5);
    const second = undo.show('second', 5);

    await expect(first).resolves.toBe(false);
    expect(toasts.map((t) => t.title)).toEqual(['second']);
    vi.advanceTimersByTime(5000);
    await expect(second).resolves.toBe(true);
  });

  it('defaults to 5 seconds', () => {
    void useUndoToast().show('delete');
    expect(toasts[0].life).toBe(5000);
  });

  it('does not throw when cancel is called with nothing pending', () => {
    expect(() => useUndoToast().cancel()).not.toThrow();
  });

  it('proceeds right away while toasts are suppressed, since nobody can press undo', async () => {
    suppressToasts(true);
    await expect(useUndoToast().show('delete', 5)).resolves.toBe(true);
  });
});
