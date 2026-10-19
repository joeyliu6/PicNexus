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
    // 撤销的可能是删压缩方案，不能写「历史记录保留完好」
    expect(toasts.map((t) => [t.title, t.desc])).toEqual([['已撤销', undefined]]);
    vi.advanceTimersByTime(10_000);
  });

  it('lets two rounds run side by side, each settling on its own', async () => {
    // 连删两个压缩方案：第二轮出现时第一轮不能被当成「撤销」，否则第一个方案会被悄悄放回去
    const undo = useUndoToast();
    const first = undo.show('first', 5);
    const second = undo.show('second', 5);
    expect(toasts.map((t) => t.title)).toEqual(['first', 'second']);

    runToastAction(toasts[1].id);
    await expect(second).resolves.toBe(false);
    vi.advanceTimersByTime(5000);
    await expect(first).resolves.toBe(true);
  });

  it('treats a round pushed out of the stack as done, since nobody can undo it any more', async () => {
    const undo = useUndoToast();
    const rounds = [undo.show('1'), undo.show('2'), undo.show('3'), undo.show('4')];

    await expect(rounds[0]).resolves.toBe(true);
    expect(toasts.map((t) => t.title)).toEqual(['2', '3', '4']);
  });

  it('defaults to the 6-second undo life and the green tick of the design', () => {
    void useUndoToast().show('已删除方案');
    expect(toasts[0]).toMatchObject({ life: 6000, kind: 'success' });
  });

  it('can show a pending action in amber', () => {
    void useUndoToast().show('将清空所有历史记录', 5, 'warn');
    expect(toasts[0]).toMatchObject({ life: 5000, kind: 'warn' });
  });

  it('proceeds right away while toasts are suppressed, since nobody can press undo', async () => {
    suppressToasts(true);
    await expect(useUndoToast().show('delete', 5)).resolves.toBe(true);
  });
});
