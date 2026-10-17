import { describe, it, expect } from 'vitest';
import { stripKnownPrefixes, replaceImageLinks } from '@/utils/mdParser';
import type { UserConfig } from '@/config/types';

describe('stripKnownPrefixes', () => {
  const config = {
    linkPrefixConfig: {
      enabled: true,
      selectedIndex: 0,
      prefixList: [
        { name: '搜狗图片', template: 'https://img01.sogoucdn.com/net/a/04/link?appid=100520031&w=4096&url={url_encoded}' },
        { name: 'CDN JSON', template: 'https://cdn.cdnjson.com/pic.html?url=' },
        { name: 'Jetpack', template: 'https://i0.wp.com/{url_no_scheme}' },
      ],
    },
  } as UserConfig;

  it('剥离搜狗 URL 编码前缀', () => {
    const original = 'https://real.com/a.png';
    const url = `https://img01.sogoucdn.com/net/a/04/link?appid=100520031&w=4096&url=${encodeURIComponent(original)}`;
    expect(stripKnownPrefixes(url, config)).toBe(original);
  });

  it('剥离 cdnjson 纯前缀', () => {
    const url = 'https://cdn.cdnjson.com/pic.html?url=https://real.com/b.png';
    expect(stripKnownPrefixes(url, config)).toBe('https://real.com/b.png');
  });

  it('剥离 Jetpack 去协议前缀', () => {
    const url = 'https://i0.wp.com/real.com/c.png';
    expect(stripKnownPrefixes(url, config)).toBe('https://real.com/c.png');
  });

  it('无匹配前缀时返回原始 URL', () => {
    const url = 'https://other.com/c.png';
    expect(stripKnownPrefixes(url, config)).toBe(url);
  });

  it('config 无 prefixList 时使用 DEFAULT_LINK_PREFIXES', () => {
    const url = 'https://cdn.cdnjson.com/pic.html?url=https://real.com/d.png';
    expect(stripKnownPrefixes(url, {} as UserConfig)).toBe('https://real.com/d.png');
  });
});

describe('replaceImageLinks', () => {
  it('替换 Markdown 图片中的 URL', () => {
    const content = '![alt](https://old.com/a.png)';
    const replacements = new Map([['https://old.com/a.png', 'https://new.com/b.png']]);
    expect(replaceImageLinks(content, replacements))
      .toBe('![alt](https://new.com/b.png)');
  });

  it('替换 HTML img 中的 URL', () => {
    const content = '<img src="https://old.com/a.png" />';
    const replacements = new Map([['https://old.com/a.png', 'https://new.com/b.png']]);
    expect(replaceImageLinks(content, replacements))
      .toBe('<img src="https://new.com/b.png" />');
  });

  it('同一 URL 出现多次全部替换', () => {
    const content = '![a](https://old.com/x.png) ![b](https://old.com/x.png)';
    const replacements = new Map([['https://old.com/x.png', 'https://new.com/y.png']]);
    const result = replaceImageLinks(content, replacements);
    expect(result).not.toContain('old.com');
  });

  it('空 replacements 不改变内容', () => {
    const content = '![a](https://keep.com/a.png)';
    expect(replaceImageLinks(content, new Map())).toBe(content);
  });

  it('URL 中包含正则特殊字符（查询串 ? + . *）时正常替换', () => {
    const content = '![a](https://cdn.com/a.png?v=1+2*3)';
    const replacements = new Map([['https://cdn.com/a.png?v=1+2*3', 'https://new.com/b.png']]);
    expect(replaceImageLinks(content, replacements))
      .toBe('![a](https://new.com/b.png)');
  });

  it('URL 路径中包含成对括号时完整替换且不破坏 Markdown', () => {
    const content = '![a](https://cdn.example.com/photo_(1).png)';
    const replacements = new Map([['https://cdn.example.com/photo_(1).png', 'https://new.com/b.png']]);
    expect(replaceImageLinks(content, replacements))
      .toBe('![a](https://new.com/b.png)');
  });

  it('replaces URLs when Markdown image titles contain escaped quotes', () => {
    const content = '![a](https://old.com/a.png "some \\"quoted\\" title")';
    const replacements = new Map([['https://old.com/a.png', 'https://new.com/b.png']]);
    expect(replaceImageLinks(content, replacements))
      .toBe('![a](https://new.com/b.png "some \\"quoted\\" title")');
  });

  it('newUrl 含 $& / $1 不被当作反向引用（callback 形式替换）', () => {
    const content = '![a](https://old.com/a.png)';
    const replacements = new Map([['https://old.com/a.png', 'https://new.com/b.png?sig=$&$1']]);
    expect(replaceImageLinks(content, replacements))
      .toBe('![a](https://new.com/b.png?sig=$&$1)');
  });

  it('不替换普通链接 [text](url) 中的同 URL（只认图片语法）', () => {
    const content = '![img](https://x.com/a.png)\n\n[source](https://x.com/a.png)';
    const replacements = new Map([['https://x.com/a.png', 'https://y.com/b.png']]);
    const result = replaceImageLinks(content, replacements);
    expect(result).toContain('![img](https://y.com/b.png)');
    // 普通链接保持原样
    expect(result).toContain('[source](https://x.com/a.png)');
  });

  it('不替换围栏代码块内的同 URL', () => {
    const content = [
      '![a](https://x.com/a.png)',
      '```',
      '![demo](https://x.com/a.png)',
      '```',
    ].join('\n');
    const replacements = new Map([['https://x.com/a.png', 'https://y.com/b.png']]);
    const result = replaceImageLinks(content, replacements);
    expect(result).toContain('![a](https://y.com/b.png)');
    // 代码块内保持原 URL
    expect(result).toContain('![demo](https://x.com/a.png)');
  });

  it('不替换行内代码中的同 URL', () => {
    const content = '前 `![demo](https://x.com/a.png)` 后 ![real](https://x.com/a.png)';
    const replacements = new Map([['https://x.com/a.png', 'https://y.com/b.png']]);
    const result = replaceImageLinks(content, replacements);
    expect(result).toContain('`![demo](https://x.com/a.png)`');
    expect(result).toContain('![real](https://y.com/b.png)');
  });

  it('保留图片标题 ![alt](url "title")', () => {
    const content = '![a](https://old.com/a.png "标题")';
    const replacements = new Map([['https://old.com/a.png', 'https://new.com/b.png']]);
    expect(replaceImageLinks(content, replacements))
      .toBe('![a](https://new.com/b.png "标题")');
  });
});
