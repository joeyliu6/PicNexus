import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfirmTone, useConfirm } from '@/composables/useConfirm';
import { __resetConfirmsForTests, currentConfirm, settleConfirm } from '@/components/pn/confirmStore';
import { UI_COPY } from '@/constants';

function current() {
  const request = currentConfirm.value;
  if (!request) throw new Error('没有正在显示的确认框');
  return request;
}

describe('useConfirm', () => {
  beforeEach(() => {
    __resetConfirmsForTests();
  });

  it('uses centralized defaults for async confirmations', async () => {
    const { confirm } = useConfirm();
    const result = confirm('继续操作？');

    expect(current()).toMatchObject({
      title: UI_COPY.confirm.defaults.header,
      message: '继续操作？',
      acceptLabel: UI_COPY.confirm.defaults.acceptLabel,
      rejectLabel: UI_COPY.confirm.defaults.rejectLabel,
    });

    settleConfirm(current().id, 'accept');
    await expect(result).resolves.toBe(true);
    expect(currentConfirm.value).toBeNull();
  });

  it('uses warning defaults for warn confirmations', () => {
    const { confirmWarn } = useConfirm();

    confirmWarn('当前任务未完成，仍要继续吗？', vi.fn());

    expect(current()).toMatchObject({
      title: UI_COPY.confirm.warn.header,
      acceptLabel: UI_COPY.confirm.warn.acceptLabel,
      tone: 'warning',
      danger: false,
    });
  });

  it('calls neither callback when a callback-style confirm is dismissed', async () => {
    const { showConfirm } = useConfirm();
    const accept = vi.fn();
    const reject = vi.fn();

    showConfirm({ message: '导出？', accept, reject });
    settleConfirm(current().id, 'dismiss');
    await Promise.resolve();

    expect(accept).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  it('shows queued confirmations one after another', async () => {
    const { confirm } = useConfirm();
    const first = confirm('第一个？');
    const second = confirm('第二个？');

    expect(current().message).toBe('第一个？');
    settleConfirm(current().id, 'reject');
    await expect(first).resolves.toBe(false);

    expect(current().message).toBe('第二个？');
    settleConfirm(current().id, 'accept');
    await expect(second).resolves.toBe(true);
  });

  it('maps the legacy icon and accept classes onto dialog tones', () => {
    expect(resolveConfirmTone('pi pi-trash', 'p-button-danger')).toEqual({ tone: 'danger', danger: true });
    expect(resolveConfirmTone('pi pi-exclamation-triangle')).toEqual({ tone: 'warning', danger: false });
    expect(resolveConfirmTone(undefined, 'p-button-warning')).toEqual({ tone: 'warning', danger: false });
    expect(resolveConfirmTone('pi pi-shield')).toEqual({ tone: 'brand', danger: false });
  });
});
