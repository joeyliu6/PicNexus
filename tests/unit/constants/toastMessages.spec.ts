// 通知里的张数、个数：大数字千分位（交接说明 9.6）；失败写「未能 XX」+ 处理办法，不用口头语（交接说明 9.2、9.4）
import { describe, expect, it } from 'vitest';
import { TOAST_MESSAGES } from '@/constants/toastMessages';

describe('TOAST_MESSAGES.history removal notices', () => {
  it('counts with thousands separators', () => {
    expect(TOAST_MESSAGES.history.imagesRemoved(1234).summary).toBe('已从记录中移除 1,234 张图片');
    expect(TOAST_MESSAGES.history.linksRemoved(12_483).summary).toBe('已移除 12,483 个链接');
    expect(TOAST_MESSAGES.history.removePartial(1500).summary).toBe('1,500 张图片未能移除');
  });

  it('says what failed and what to do', () => {
    expect(TOAST_MESSAGES.history.removeFailed('db locked')).toEqual({ summary: '未能移除', detail: 'db locked，请稍后重试' });
  });
});
