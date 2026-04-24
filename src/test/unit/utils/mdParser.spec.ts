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

  it('过滤末尾扩展名为 .js 的徽章代理 URL', () => {
    // badge-size.now.sh / shields.io 这类徽章代理会把 JS 文件 URL 拼到 path 里
    // 虽然服务端返回 SVG，但末尾扩展名一眼看是 .js，按黑名单过滤避免被当图片扫
    const md = '![popper](https://badge-size.now.sh/https://unpkg.com/@popperjs/core/dist/umd/popper.min.js?compression=brotli&label=popper)';
    expect(extractImageLinks(md)).toHaveLength(0);
  });

  it('过滤末尾扩展名为 .css / .html / .pdf / .zip 等明显非图片资源', () => {
    const md = [
      '![a](https://cdn.com/style.css)',
      '![b](https://cdn.com/page.html)',
      '![c](https://cdn.com/doc.pdf)',
      '![d](https://cdn.com/pkg.zip)',
      '![e](https://cdn.com/video.mp4)',
    ].join('\n');
    expect(extractImageLinks(md)).toHaveLength(0);
  });

  it('扩展名大小写不敏感（.JS 也应被过滤）', () => {
    const md = '![x](https://cdn.com/foo.JS)';
    expect(extractImageLinks(md)).toHaveLength(0);
  });

  it('黑名单不影响正常图片扩展（.svg/.webp/.avif 等通过）', () => {
    const md = [
      '![a](https://cdn.com/a.svg)',
      '![b](https://cdn.com/b.webp)',
      '![c](https://cdn.com/c.avif)',
    ].join('\n');
    expect(extractImageLinks(md)).toHaveLength(3);
  });

  it('无扩展名的图床 ID URL 仍通过（不误杀 imgur/sm.ms 风格）', () => {
    const md = '![a](https://i.imgur.com/abc123XYZ)';
    expect(extractImageLinks(md)).toHaveLength(1);
  });

  it('query/fragment 不参与扩展名判定', () => {
    // path 末段是 .png，query 里带 .js 不应影响判定
    const md = '![a](https://cdn.com/image.png?ref=foo.js#section)';
    expect(extractImageLinks(md)).toHaveLength(1);
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

  it('tilde 围栏内出现反引号不应提前关闭围栏', () => {
    const md = [
      '~~~text',
      '![inside](https://e.com/a.png)',
      '```',
      '~~~',
      '![after](https://e.com/b.png)',
    ].join('\n');
    const links = extractImageLinks(md);
    // inside 被 tilde 围栏包住，after 在围栏关闭后
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://e.com/b.png');
  });

  it('嵌套围栏：4-tick 开，内部 3-tick 视为字面量', () => {
    const md = [
      '````markdown',
      '```',
      '![inside](https://e.com/nested.png)',
      '```',
      '````',
      '![after](https://e.com/after.png)',
    ].join('\n');
    const links = extractImageLinks(md);
    // 4-tick 围栏未关闭前，内部的 3-tick 和图片均为字面量，不应提取
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://e.com/after.png');
  });

  it('4+ 空格缩进不视为 fence（按 CommonMark 为缩进代码块）', () => {
    // 4 空格缩进的 ``` 不应开启围栏，后续图片应照常提取
    const md = [
      '    ```',
      '![x](https://e.com/a.png)',
      '    ```',
      '![y](https://e.com/b.png)',
    ].join('\n');
    const links = extractImageLinks(md);
    expect(links).toHaveLength(2);
  });

  it('0-3 空格缩进仍视为合法 fence', () => {
    const md = [
      '   ```',
      '![inside](https://e.com/a.png)',
      '   ```',
      '![after](https://e.com/b.png)',
    ].join('\n');
    const links = extractImageLinks(md);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://e.com/b.png');
  });

  it('close fence 尾部带 info string 时不关闭（CommonMark）', () => {
    const md = [
      '```',
      '![inside](https://e.com/a.png)',
      '``` notes',
      '![still-inside](https://e.com/b.png)',
      '```',
      '![after](https://e.com/c.png)',
    ].join('\n');
    const links = extractImageLinks(md);
    // "``` notes" 不是合法 close（尾部非空白），前两张仍在围栏内
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://e.com/c.png');
  });

  it('close fence 尾部纯空白（空格/tab）仍视为合法 close', () => {
    const md = [
      '```',
      '![in](https://e.com/a.png)',
      '```   \t',
      '![after](https://e.com/b.png)',
    ].join('\n');
    const links = extractImageLinks(md);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://e.com/b.png');
  });

  it('open fence 允许带 info string 正常开启', () => {
    const md = [
      '``` python',
      '![inside](https://e.com/a.png)',
      '```',
      '![after](https://e.com/b.png)',
    ].join('\n');
    const links = extractImageLinks(md);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://e.com/b.png');
  });

  it('close fence 反引号数少于 open 时不关闭', () => {
    const md = [
      '````',
      '![x](https://e.com/a.png)',
      '```',
      '![y](https://e.com/b.png)',
      '````',
      '![z](https://e.com/c.png)',
    ].join('\n');
    const links = extractImageLinks(md);
    // 前 2 张图在 4-tick 围栏内（3-tick 不足以关闭）；z 在围栏关闭后
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://e.com/c.png');
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

  it('URL 中包含正则特殊字符（查询串 ? + . *）时正常替换', () => {
    const content = '![a](https://cdn.com/a.png?v=1+2*3)';
    const replacements = new Map([['https://cdn.com/a.png?v=1+2*3', 'https://new.com/b.png']]);
    expect(replaceImageLinks(content, replacements))
      .toBe('![a](https://new.com/b.png)');
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
