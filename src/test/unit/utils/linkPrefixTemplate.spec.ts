import { describe, it, expect } from 'vitest';
import {
  hasPlaceholder,
  applyPrefixTemplate,
  stripPrefixTemplate,
} from '../../../utils/linkPrefixTemplate';

describe('hasPlaceholder', () => {
  it('识别 {url} 等占位符', () => {
    expect(hasPlaceholder('{url}')).toBe(true);
    expect(hasPlaceholder('prefix{url_no_scheme}suffix')).toBe(true);
    expect(hasPlaceholder('{path}')).toBe(true);
    expect(hasPlaceholder('{url_encoded}')).toBe(true);
  });

  it('没有占位符时返回 false', () => {
    expect(hasPlaceholder('https://example.com/')).toBe(false);
    expect(hasPlaceholder('')).toBe(false);
  });

  it('未知占位符不算', () => {
    expect(hasPlaceholder('{unknown}')).toBe(false);
  });

  it('重复调用行为一致（lastIndex 重置）', () => {
    expect(hasPlaceholder('{url}')).toBe(true);
    expect(hasPlaceholder('{url}')).toBe(true);
  });
});

describe('applyPrefixTemplate', () => {
  const URL = 'https://cdn.example.com/path/to/img.png';

  it('空模板返回原 URL', () => {
    expect(applyPrefixTemplate('', URL)).toBe(URL);
  });

  it('无占位符时作为纯前缀拼接', () => {
    expect(applyPrefixTemplate('https://proxy/?', URL)).toBe(`https://proxy/?${URL}`);
  });

  it('{url} 替换为完整 URL', () => {
    expect(applyPrefixTemplate('img-{url}', URL)).toBe(`img-${URL}`);
  });

  it('{url_no_scheme} 去掉 https://', () => {
    expect(applyPrefixTemplate('https://cache/{url_no_scheme}', URL))
      .toBe('https://cache/cdn.example.com/path/to/img.png');
  });

  it('{url_no_scheme} 去掉 http://', () => {
    expect(applyPrefixTemplate('{url_no_scheme}', 'http://foo.com/a.png'))
      .toBe('foo.com/a.png');
  });

  it('{path} 去掉协议与域名', () => {
    expect(applyPrefixTemplate('https://cdn.new/{path}', URL))
      .toBe('https://cdn.new/path/to/img.png');
  });

  it('{path} 当 URL 无路径时返回空', () => {
    expect(applyPrefixTemplate('[{path}]', 'https://foo.com')).toBe('[]');
  });

  it('{url_encoded} 使用 encodeURIComponent', () => {
    expect(applyPrefixTemplate('x?={url_encoded}', URL))
      .toBe('x?=' + encodeURIComponent(URL));
  });
});

describe('stripPrefixTemplate', () => {
  const URL = 'https://cdn.example.com/a.png';

  it('空模板返回 null', () => {
    expect(stripPrefixTemplate('anything', '')).toBeNull();
  });

  it('无占位符模板 - 前缀匹配', () => {
    expect(stripPrefixTemplate('https://proxy/' + URL, 'https://proxy/')).toBe(URL);
  });

  it('无占位符模板 - 不匹配返回 null', () => {
    expect(stripPrefixTemplate('https://other.com/a.png', 'https://proxy/')).toBeNull();
  });

  it('{url} 模板能还原原 URL', () => {
    const template = 'https://cache/{url}';
    const final = applyPrefixTemplate(template, URL);
    expect(stripPrefixTemplate(final, template)).toBe(URL);
  });

  it('{url_no_scheme} 模板还原时补回 https://', () => {
    const template = 'https://cache/{url_no_scheme}';
    const final = applyPrefixTemplate(template, URL);
    // 原始是 https:// 开头，还原补 https:// 能拿回来
    expect(stripPrefixTemplate(final, template)).toBe(URL);
  });

  it('{url_encoded} 模板还原使用 decodeURIComponent', () => {
    const template = 'p?u={url_encoded}';
    const final = applyPrefixTemplate(template, URL);
    expect(stripPrefixTemplate(final, template)).toBe(URL);
  });

  it('{path} 模板不可还原，返回 null', () => {
    const template = 'https://cdn/{path}';
    const final = applyPrefixTemplate(template, URL);
    expect(stripPrefixTemplate(final, template)).toBeNull();
  });

  it('字面量不匹配时返回 null', () => {
    const template = 'https://cache/{url}';
    expect(stripPrefixTemplate('https://other/' + URL, template)).toBeNull();
  });

  it('多个字面量片段能正确分段', () => {
    const template = 'p-{url_no_scheme}-suffix';
    const final = applyPrefixTemplate(template, URL);
    expect(final).toBe('p-cdn.example.com/a.png-suffix');
    expect(stripPrefixTemplate(final, template)).toBe(URL);
  });

  it('{url_encoded} 解码失败时返回 null', () => {
    const template = '{url_encoded}';
    // 制造一个无效 percent-encoded 序列
    expect(stripPrefixTemplate('%E0%A4%A', template)).toBeNull();
  });

  it('后置字面量在 finalUrl 里找不到 → null', () => {
    const template = '{url}|end';
    expect(stripPrefixTemplate('https://cdn.example.com/a.png', template)).toBeNull();
  });
});
