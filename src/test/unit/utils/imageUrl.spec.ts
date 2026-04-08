import { describe, it, expect, vi } from 'vitest';

// Mock config types
vi.mock('../../../config/types', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    getActivePrefix: vi.fn(() => null),
  };
});

const { getPrimaryImageUrl } = await import('../../../utils/imageUrl');
const { getActivePrefix } = await import('../../../config/types');

const mockedGetActivePrefix = vi.mocked(getActivePrefix);

describe('getPrimaryImageUrl', () => {
  const baseConfig = { weiboProxyMode: 'none' } as any;

  it('返回主服务的成功上传 URL', () => {
    const item = {
      primaryService: 'jd',
      results: [
        { serviceId: 'jd', status: 'success', result: { url: 'https://img.jd.com/test.jpg', serviceId: 'jd', fileKey: 'k' } },
      ],
    } as any;

    expect(getPrimaryImageUrl(item, baseConfig)).toBe('https://img.jd.com/test.jpg');
  });

  it('没有匹配的成功结果时返回空字符串', () => {
    const item = {
      primaryService: 'jd',
      results: [
        { serviceId: 'jd', status: 'failed', error: '上传失败' },
      ],
    } as any;

    expect(getPrimaryImageUrl(item, baseConfig)).toBe('');
  });

  it('微博图片使用 large 尺寸 URL', () => {
    const item = {
      primaryService: 'weibo',
      results: [
        {
          serviceId: 'weibo', status: 'success',
          result: { url: 'https://tvax1.sinaimg.cn/mw690/abc.jpg', serviceId: 'weibo', fileKey: 'abc' },
        },
      ],
    } as any;

    mockedGetActivePrefix.mockReturnValue(null);
    const url = getPrimaryImageUrl(item, baseConfig);
    expect(url).toBe('https://tvax1.sinaimg.cn/large/abc.jpg');
  });

  it('微博图片带前缀', () => {
    const item = {
      primaryService: 'weibo',
      results: [
        {
          serviceId: 'weibo', status: 'success',
          result: { url: 'https://tvax1.sinaimg.cn/mw690/abc.jpg', serviceId: 'weibo', fileKey: 'abc' },
        },
      ],
    } as any;

    mockedGetActivePrefix.mockReturnValue('https://proxy.com/?url=');
    const url = getPrimaryImageUrl(item, baseConfig);
    expect(url).toBe('https://proxy.com/?url=https://tvax1.sinaimg.cn/large/abc.jpg');
  });

  it('results 为空数组时返回空字符串', () => {
    const item = {
      primaryService: 'jd',
      results: [],
    } as any;

    expect(getPrimaryImageUrl(item, baseConfig)).toBe('');
  });
});
