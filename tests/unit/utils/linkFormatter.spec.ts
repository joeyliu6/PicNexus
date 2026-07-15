import { describe, it, expect } from 'vitest';
import { formatLink, applyTemplate } from '@/utils/linkFormatter';
import type { LinkFormatContext } from '@/utils/linkFormatter';

describe('formatLink', () => {
  const url = 'https://cdn.example.com/image.png';
  const fileName = 'image.png';

  it('url 格式直接返回原始 URL', () => {
    expect(formatLink(url, fileName, 'url')).toBe(url);
  });

  it('markdown 格式生成 ![alt](url)', () => {
    expect(formatLink(url, fileName, 'markdown'))
      .toBe('![image.png](https://cdn.example.com/image.png)');
  });

  it('markdown 格式转义文件名中的 []', () => {
    expect(formatLink(url, 'img[1].png', 'markdown'))
      .toBe('![img\\[1\\].png](https://cdn.example.com/image.png)');
  });

  it('markdown 格式转义 URL 中的 ()', () => {
    const urlWithParens = 'https://cdn.example.com/image(1).png';
    expect(formatLink(urlWithParens, fileName, 'markdown'))
      .toBe('![image.png](https://cdn.example.com/image\\(1\\).png)');
  });

  it('html 格式生成 <img> 标签', () => {
    expect(formatLink(url, fileName, 'html'))
      .toBe('<img src="https://cdn.example.com/image.png" alt="image.png" />');
  });

  it('html 格式转义特殊字符', () => {
    const evil = 'https://cdn.example.com/a"b<c>&d.png';
    expect(formatLink(evil, 'a"b.png', 'html'))
      .toBe('<img src="https://cdn.example.com/a&quot;b&lt;c&gt;&amp;d.png" alt="a&quot;b.png" />');
  });

  it('bbcode 格式生成 [img]url[/img]', () => {
    expect(formatLink(url, fileName, 'bbcode'))
      .toBe('[img]https://cdn.example.com/image.png[/img]');
  });

  it('custom 格式使用自定义模板', () => {
    expect(formatLink(url, fileName, 'custom', '<a href="{url}">{filename}</a>'))
      .toBe('<a href="https://cdn.example.com/image.png">image.png</a>');
  });

  it('custom 格式无模板时回退到 {url}', () => {
    expect(formatLink(url, fileName, 'custom')).toBe(url);
  });

  it('custom 格式支持 {width} 和 {height}', () => {
    expect(formatLink(url, fileName, 'custom', '{url}?w={width}&h={height}', { width: 800, height: 600 }))
      .toBe('https://cdn.example.com/image.png?w=800&h=600');
  });

  it('custom 格式 dimensions 缺失时 {width}/{height} 替换为空', () => {
    expect(formatLink(url, fileName, 'custom', '{url}?w={width}'))
      .toBe('https://cdn.example.com/image.png?w=');
  });

  it('未知格式回退到原始 URL', () => {
    expect(formatLink(url, fileName, 'unknown' as never)).toBe(url);
  });
});

describe('applyTemplate', () => {
  const ctx: LinkFormatContext = {
    url: 'https://example.com/a.png',
    filename: 'a.png',
    width: 100,
    height: 200,
  };

  it('替换所有支持的变量', () => {
    expect(applyTemplate('{url} {filename} {width}x{height}', ctx))
      .toBe('https://example.com/a.png a.png 100x200');
  });

  it('同一变量多次出现都会替换', () => {
    expect(applyTemplate('{url}|{url}', ctx))
      .toBe('https://example.com/a.png|https://example.com/a.png');
  });

  it('width/height 为 undefined 时替换为空字符串', () => {
    const noSize: LinkFormatContext = { url: 'u', filename: 'f' };
    expect(applyTemplate('{width}x{height}', noSize)).toBe('x');
  });
});
