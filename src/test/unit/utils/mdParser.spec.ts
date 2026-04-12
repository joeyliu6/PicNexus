import { describe, it, expect } from 'vitest';
import { extractImageLinks, stripKnownPrefixes, smartTruncateUrl, replaceImageLinks } from '../../../utils/mdParser';
import type { UserConfig } from '../../../config/types';

describe('extractImageLinks', () => {
  it('提取标准 Markdown 图片语法', () => {
    const md = '文本 ![alt](https://cdn.example.com/a.png) 文本';
    const links = extractImageLinks(md);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://cdn.example.com/a.png');
    expect(links[0].altText).toBe('alt');
    expect(links[0].syntax).toBe('markdown');
    expect(links[0].lineNumber).toBe(1);
  });

  it('提取 HTML img 标签', () => {
    const md = '<img src="https://cdn.example.com/b.png" alt="b" />';
    const links = extractImageLinks(md);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://cdn.example.com/b.png');
    expect(links[0].syntax).toBe('html');
  });

  it('同一内容中同时提取 Markdown 和 HTML 语法', () => {
    const md = '![a](https://a.com/1.png)\n<img src="https://b.com/2.png" />';
    const links = extractImageLinks(md);
    expect(links).toHaveLength(2);
  });

  it('跳过围栏代码块内的图片', () => {
    const md = '```\n![alt](https://code.com/a.png)\n```';
    expect(extractImageLinks(md)).toHaveLength(0);
  });

  it('跳过行内代码中的图片', () => {
    const md = '看看这个 `![alt](https://inline.com/a.png)` 代码';
    expect(extractImageLinks(md)).toHaveLength(0);
  });

  it('相同 URL 去重', () => {
    const md = '![a](https://dup.com/1.png)\n![b](https://dup.com/1.png)';
    expect(extractImageLinks(md)).toHaveLength(1);
  });

  it('过滤 data: URL', () => {
    const md = '![a](data:image/png;base64,abc)';
    expect(extractImageLinks(md)).toHaveLength(0);
  });

  it('过滤相对路径', () => {
    const md = '![a](./local.png)';
    expect(extractImageLinks(md)).toHaveLength(0);
  });

  it('过滤 # 锚点链接', () => {
    const md = '![a](#anchor)';
    expect(extractImageLinks(md)).toHaveLength(0);
  });

  it('正确记录行号', () => {
    const md = '第一行\n第二行\n![pic](https://line3.com/a.png)\n第四行';
    const links = extractImageLinks(md);
    expect(links[0].lineNumber).toBe(3);
  });

  it('检测 blockquote 上下文', () => {
    const md = '> ![a](https://bq.com/a.png)';
    const links = extractImageLinks(md);
    expect(links[0].context).toBe('blockquote');
  });

  it('检测 table 上下文', () => {
    const md = '| col1 | ![a](https://tbl.com/a.png) |';
    const links = extractImageLinks(md);
    expect(links[0].context).toBe('table');
  });

  it('普通行上下文为 normal', () => {
    const md = '![a](https://normal.com/a.png)';
    const links = extractImageLinks(md);
    expect(links[0].context).toBe('normal');
  });

  it('围栏代码块结束后恢复正常提取', () => {
    const md = '```\n代码\n```\n![a](https://after.com/a.png)';
    const links = extractImageLinks(md);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://after.com/a.png');
  });

  it('支持带 title 的 Markdown 图片语法', () => {
    const md = '![alt](https://title.com/a.png "some title")';
    const links = extractImageLinks(md);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://title.com/a.png');
  });
});

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

describe('smartTruncateUrl', () => {
  it('短 URL 不截断', () => {
    const url = 'https://cdn.com/a.png';
    expect(smartTruncateUrl(url)).toBe(url);
  });

  it('长 URL 保留域名和文件名', () => {
    const url = 'https://cdn.example.com/very/long/nested/path/to/image.png';
    const result = smartTruncateUrl(url, 50);
    expect(result).toContain('cdn.example.com');
    expect(result).toContain('image.png');
    expect(result).toContain('...');
  });

  it('域名+文件名超长时退化为尾部截断', () => {
    const url = 'https://very-very-very-very-long-domain.example.com/a-very-very-very-long-filename.png';
    const result = smartTruncateUrl(url, 40);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result).toMatch(/\.\.\.$/);
  });

  it('无效 URL 直接尾部截断', () => {
    const bad = 'not-a-valid-url-but-still-very-long-string-that-needs-truncation';
    const result = smartTruncateUrl(bad, 30);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result).toMatch(/\.\.\.$/);
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

  it('URL 中包含正则特殊字符时正常替换', () => {
    const content = '![a](https://cdn.com/a(1).png)';
    const replacements = new Map([['https://cdn.com/a(1).png', 'https://new.com/b.png']]);
    expect(replaceImageLinks(content, replacements))
      .toBe('![a](https://new.com/b.png)');
  });
});
