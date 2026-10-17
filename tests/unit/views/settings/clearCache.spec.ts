// 清理应用缓存：WebView 的清理会连本机记住的界面偏好（侧栏收起、提示看过没有、首屏主题）一起清掉，要原样放回
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCacheKeepingPreferences } from '@/views/settings/clearCache';

beforeEach(() => localStorage.clear());

describe('clearCacheKeepingPreferences', () => {
  it('清完后本机偏好原样放回', async () => {
    localStorage.setItem('picnexus-theme', 'dark');
    localStorage.setItem('picnexus-hint-fast-upload', '1');
    const clear = vi.fn(async () => { localStorage.clear(); });
    await clearCacheKeepingPreferences(clear);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('picnexus-theme')).toBe('dark');
    expect(localStorage.getItem('picnexus-hint-fast-upload')).toBe('1');
  });

  it('清理失败照样放回，并把错误交给调用方', async () => {
    localStorage.setItem('picnexus-theme', 'light');
    const clear = vi.fn(async () => { localStorage.clear(); throw new Error('denied'); });
    await expect(clearCacheKeepingPreferences(clear)).rejects.toThrow('denied');
    expect(localStorage.getItem('picnexus-theme')).toBe('light');
  });
});
