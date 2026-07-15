import { describe, expect, it } from 'vitest';
import { TOAST_MESSAGES, UI_COPY } from '@/constants';

describe('UI_COPY', () => {
  it('keeps destructive upload queue confirmation explicit', () => {
    expect(UI_COPY.confirm.upload.clearQueue).toEqual({
      header: '确认清空',
      message: '确定要清空上传队列吗？此操作不可撤销。',
      acceptLabel: '清空',
      rejectLabel: '取消',
      icon: 'pi pi-exclamation-triangle',
      acceptClass: 'p-button-danger',
    });
  });

  it('provides typed templates for dynamic toast copy', () => {
    expect(UI_COPY.toast.upload.success(3)).toEqual({
      summary: '已上传',
      detail: '成功上传 3 个文件',
    });
    expect(UI_COPY.toast.upload.failed('网络超时')).toEqual({
      summary: '上传失败',
      detail: '网络超时',
    });
  });

  it('keeps TOAST_MESSAGES compatible while reusing UI copy templates', () => {
    expect(TOAST_MESSAGES.upload.success(2)).toEqual(UI_COPY.toast.upload.success(2));
    expect(TOAST_MESSAGES.upload.failed('认证失败')).toEqual(UI_COPY.toast.upload.failed('认证失败'));
  });

  it('provides reusable backup password validation copy', () => {
    expect(UI_COPY.dialogs.backupPassword.error.remainingAttempts(4)).toBe('密码不正确，剩余尝试次数：4');
    expect(UI_COPY.dialogs.backupPassword.action.submit.disable).toBe('确认关闭');
  });
});
