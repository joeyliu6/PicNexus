// 知乎 source 参数处理单测：isZhimgUrl / applyZhihuSource / applyZhihuSourceFromConfig

import { describe, it, expect } from 'vitest';
import {
  isZhimgUrl,
  applyZhihuSource,
  applyZhihuSourceFromConfig,
  ZHIHU_SOURCE_DEFAULT_VALUE,
} from '../../../utils/zhihuSource';
import type { UserConfig } from '../../../config/types';

describe('isZhimgUrl', () => {
  it('识别根 zhimg.com 域名', () => {
    expect(isZhimgUrl('https://zhimg.com/foo.jpg')).toBe(true);
  });

  it('识别 *.zhimg.com 子域名', () => {
    expect(isZhimgUrl('https://pic1.zhimg.com/foo.jpg')).toBe(true);
    expect(isZhimgUrl('https://pica.zhimg.com/v2-abc.jpg')).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(isZhimgUrl('https://PIC1.ZHIMG.COM/foo.jpg')).toBe(true);
  });

  it('非 zhimg.com 域名返回 false', () => {
    expect(isZhimgUrl('https://zhihu.com/foo.jpg')).toBe(false);
    expect(isZhimgUrl('https://fakezhimg.com/foo.jpg')).toBe(false);
    expect(isZhimgUrl('https://zhimg.com.evil.com/foo.jpg')).toBe(false);
  });

  it('空字符串/无效 URL 返回 false', () => {
    expect(isZhimgUrl('')).toBe(false);
    expect(isZhimgUrl('not-a-url')).toBe(false);
  });
});

describe('applyZhihuSource', () => {
  const URL = 'https://pic1.zhimg.com/v2-abc.jpg';

  it('启用 + 有效 value → 追加 source 参数', () => {
    expect(applyZhihuSource(URL, true, '172ae18b'))
      .toBe('https://pic1.zhimg.com/v2-abc.jpg?source=172ae18b');
  });

  it('禁用时原样返回', () => {
    expect(applyZhihuSource(URL, false, '172ae18b')).toBe(URL);
  });

  it('value 为空字符串视为禁用', () => {
    expect(applyZhihuSource(URL, true, '')).toBe(URL);
  });

  it('URL 为空时原样返回', () => {
    expect(applyZhihuSource('', true, '172ae18b')).toBe('');
  });

  it('非 zhimg.com 域名原样返回', () => {
    const other = 'https://imgur.com/a.jpg';
    expect(applyZhihuSource(other, true, '172ae18b')).toBe(other);
  });

  it('URL 已有 source 参数时不覆盖（尊重原值）', () => {
    const withSource = 'https://pic1.zhimg.com/v2-abc.jpg?source=existing';
    expect(applyZhihuSource(withSource, true, '172ae18b')).toBe(withSource);
  });

  it('保留其他已有 query 参数', () => {
    const url = 'https://pic1.zhimg.com/v2-abc.jpg?foo=bar';
    const result = applyZhihuSource(url, true, '172ae18b');
    expect(result).toContain('foo=bar');
    expect(result).toContain('source=172ae18b');
  });

  it('无效 URL 解析失败时原样返回', () => {
    expect(applyZhihuSource('://broken', true, '172ae18b')).toBe('://broken');
  });
});

describe('applyZhihuSourceFromConfig', () => {
  const URL = 'https://pic1.zhimg.com/v2-abc.jpg';

  it('config 为 null/undefined 时使用默认值（启用 + 默认 value）', () => {
    expect(applyZhihuSourceFromConfig(URL, null))
      .toBe(`${URL}?source=${ZHIHU_SOURCE_DEFAULT_VALUE}`);
    expect(applyZhihuSourceFromConfig(URL, undefined))
      .toBe(`${URL}?source=${ZHIHU_SOURCE_DEFAULT_VALUE}`);
  });

  it('zhihu 服务未配置时仍按默认启用', () => {
    expect(applyZhihuSourceFromConfig(URL, {} as UserConfig))
      .toBe(`${URL}?source=${ZHIHU_SOURCE_DEFAULT_VALUE}`);
  });

  it('sourceParamEnabled=false 时不追加', () => {
    const config = {
      services: { zhihu: { sourceParamEnabled: false } },
    } as UserConfig;
    expect(applyZhihuSourceFromConfig(URL, config)).toBe(URL);
  });

  it('使用自定义 sourceParamValue', () => {
    const config = {
      services: { zhihu: { sourceParamEnabled: true, sourceParamValue: 'custom-x' } },
    } as UserConfig;
    expect(applyZhihuSourceFromConfig(URL, config))
      .toBe(`${URL}?source=custom-x`);
  });

  it('sourceParamValue 全空白时退化为默认值', () => {
    const config = {
      services: { zhihu: { sourceParamEnabled: true, sourceParamValue: '   ' } },
    } as UserConfig;
    expect(applyZhihuSourceFromConfig(URL, config))
      .toBe(`${URL}?source=${ZHIHU_SOURCE_DEFAULT_VALUE}`);
  });

  it('非 zhimg URL 不受影响', () => {
    const other = 'https://imgur.com/a.jpg';
    expect(applyZhihuSourceFromConfig(other, null)).toBe(other);
  });
});
