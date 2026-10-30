import { describe, expect, it } from 'vitest';
import { TOAST_MESSAGES, UI_COPY } from '@/constants';

describe('UI_COPY', () => {
  it('provides typed templates for dynamic toast copy', () => {
    expect(UI_COPY.toast.upload.failed('网络超时')).toEqual({
      summary: '上传失败',
      detail: '网络超时',
    });
  });

  it('keeps TOAST_MESSAGES compatible while reusing UI copy templates', () => {
    expect(TOAST_MESSAGES.upload.failed('认证失败')).toEqual(UI_COPY.toast.upload.failed('认证失败'));
  });
});
