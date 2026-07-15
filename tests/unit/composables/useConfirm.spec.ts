import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfirm } from '@/composables/useConfirm';
import { UI_COPY } from '@/constants';

const requireMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());

vi.mock('primevue/useconfirm', () => ({
  useConfirm: () => ({
    require: requireMock,
    close: closeMock,
  }),
}));

describe('useConfirm', () => {
  beforeEach(() => {
    requireMock.mockReset();
    closeMock.mockReset();
  });

  it('uses centralized defaults for async confirmations', async () => {
    const { confirm } = useConfirm();
    const result = confirm('继续操作？');

    const options = requireMock.mock.calls[0][0];
    expect(options).toMatchObject({
      header: UI_COPY.confirm.defaults.header,
      message: '继续操作？',
      icon: UI_COPY.confirm.defaults.icon,
      acceptLabel: UI_COPY.confirm.defaults.acceptLabel,
      rejectLabel: UI_COPY.confirm.defaults.rejectLabel,
    });

    options.accept();
    await expect(result).resolves.toBe(true);
  });

  it('uses destructive defaults for delete confirmations', () => {
    const { confirmDelete } = useConfirm();
    const accept = vi.fn();

    confirmDelete('确定删除这条记录吗？', accept);

    const options = requireMock.mock.calls[0][0];
    expect(options).toMatchObject({
      header: UI_COPY.confirm.delete.header,
      message: '确定删除这条记录吗？',
      icon: UI_COPY.confirm.delete.icon,
      acceptLabel: UI_COPY.confirm.delete.acceptLabel,
      rejectLabel: UI_COPY.confirm.delete.rejectLabel,
      acceptClass: UI_COPY.confirm.delete.acceptClass,
    });
    options.accept();
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it('uses warning defaults for warn confirmations', () => {
    const { confirmWarn } = useConfirm();
    const accept = vi.fn();

    confirmWarn('当前任务未完成，仍要继续吗？', accept);

    const options = requireMock.mock.calls[0][0];
    expect(options).toMatchObject({
      header: UI_COPY.confirm.warn.header,
      message: '当前任务未完成，仍要继续吗？',
      icon: UI_COPY.confirm.warn.icon,
      acceptLabel: UI_COPY.confirm.warn.acceptLabel,
      rejectLabel: UI_COPY.confirm.warn.rejectLabel,
      acceptClass: UI_COPY.confirm.warn.acceptClass,
    });
  });

  it('keeps dismiss distinct from reject in three-way confirmations', async () => {
    const { confirmThreeWay } = useConfirm();
    const result = confirmThreeWay({ message: '如何处理本地配置？' });

    const options = requireMock.mock.calls[0][0];
    options.onHide();

    await expect(result).resolves.toBe('dismiss');
  });
});
