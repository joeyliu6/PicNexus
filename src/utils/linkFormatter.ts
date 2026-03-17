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

/** 链接格式选项（用于 UI 展示） */
export interface LinkFormatOption {
  format: LinkFormat;
  label: string;
  icon: string;
  example: string;
}

/** 预定义格式选项 */
export const LINK_FORMAT_OPTIONS: LinkFormatOption[] = [
  { format: 'url', label: 'URL', icon: 'pi-link', example: 'https://example.com/image.png' },
  { format: 'markdown', label: 'Markdown', icon: 'pi-file-edit', example: '![filename](url)' },
  { format: 'html', label: 'HTML', icon: 'pi-code', example: '<img src="url" alt="filename" />' },
  { format: 'bbcode', label: 'BBCode', icon: 'pi-comment', example: '[img]url[/img]' },
  { format: 'custom', label: '自定义', icon: 'pi-pencil', example: '{url}' },
];

/** 格式名称映射 */
export const FORMAT_NAMES: Record<LinkFormat, string> = {
  url: 'URL',
  markdown: 'Markdown',
  html: 'HTML',
  bbcode: 'BBCode',
  custom: '自定义',
};

export function escapeHtmlAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeMarkdown(str: string): string {
  return str.replace(/[\[\]]/g, '\\$&');
}

export function escapeMarkdownUrl(str: string): string {
  return str.replace(/[()]/g, '\\$&');
}

/**
 * 格式化链接
 * @param url 链接地址
 * @param fileName 文件名
 * @param format 格式类型
 * @param customTemplate 自定义模板（format 为 'custom' 时使用）
 */
export function formatLink(url: string, fileName: string, format: LinkFormat, customTemplate?: string): string {
  switch (format) {
    case 'url': return url;
    case 'markdown': return `![${escapeMarkdown(fileName)}](${escapeMarkdownUrl(url)})`;
    case 'html': return `<img src="${escapeHtmlAttr(url)}" alt="${escapeHtmlAttr(fileName)}" />`;
    case 'bbcode': return `[img]${url}[/img]`;
    case 'custom': return applyTemplate(customTemplate || '{url}', { url, filename: fileName });
    default: return url;
  }
}

/**
 * 模板变量替换
 * 支持变量：{url}、{filename}、{width}、{height}
 */
export function applyTemplate(template: string, context: LinkFormatContext): string {
  return template
    .replace(/\{url\}/g, context.url)
    .replace(/\{filename\}/g, context.filename)
    .replace(/\{width\}/g, context.width != null ? String(context.width) : '')
    .replace(/\{height\}/g, context.height != null ? String(context.height) : '');
}
