// 链接格式化工具模块

/** 链接格式类型 */
export type LinkFormat = 'url' | 'markdown' | 'html' | 'bbcode' | 'custom';

/** 链接格式化上下文（用于模板变量替换） */
export interface LinkFormatContext {
  url: string;
  filename: string;
  width?: number;
  height?: number;
}

/** 格式名称映射 */
export const FORMAT_NAMES: Record<LinkFormat, string> = {
  url: 'URL',
  markdown: 'Markdown',
  html: 'HTML',
  bbcode: 'BBCode',
  custom: '自定义',
};

function escapeHtmlAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeMarkdown(str: string): string {
  return str.replace(/[\[\]]/g, '\\$&');
}

function escapeMarkdownUrl(str: string): string {
  return str.replace(/[()]/g, '\\$&');
}

/**
 * 格式化链接
 * @param url 链接地址
 * @param fileName 文件名
 * @param format 格式类型
 * @param customTemplate 自定义模板（format 为 'custom' 时使用）
 * @param dimensions 图片尺寸（可选，用于自定义模板的 {width}/{height} 变量）
 */
export function formatLink(
  url: string,
  fileName: string,
  format: LinkFormat,
  customTemplate?: string,
  dimensions?: { width?: number; height?: number }
): string {
  switch (format) {
    case 'url': return url;
    case 'markdown': return `![${escapeMarkdown(fileName)}](${escapeMarkdownUrl(url)})`;
    case 'html': return `<img src="${escapeHtmlAttr(url)}" alt="${escapeHtmlAttr(fileName)}" />`;
    case 'bbcode': return `[img]${url}[/img]`;
    case 'custom': return applyTemplate(customTemplate || '{url}', {
      url,
      filename: fileName,
      width: dimensions?.width,
      height: dimensions?.height,
    });
    default: return url;
  }
}

/**
 * 模板变量替换
 * 支持变量：{url}、{filename}、{width}、{height}
 */
export function applyTemplate(template: string, context: LinkFormatContext): string {
  const values: Record<string, string> = {
    url: context.url,
    filename: context.filename,
    width: context.width != null ? String(context.width) : '',
    height: context.height != null ? String(context.height) : '',
  };
  // 一遍扫完 + 函数替换：值里的 $' $& 不被当成替换模式，
  // 文件名里恰好写着 {width} 之类也不会被下一轮二次替换
  return template.replace(/\{(url|filename|width|height)\}/g, (_, key: string) => values[key]);
}
