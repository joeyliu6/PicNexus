// Markdown 文件图片链接解析器

import type { MdImageLink } from '../types/linkCheck';
import type { UserConfig } from '../config/types';
import { DEFAULT_LINK_PREFIXES } from '../config/types';
import { stripPrefixTemplate } from './linkPrefixTemplate';

/** 标准 Markdown 图片语法: ![alt](url "title") */
const MD_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** HTML img 标签: <img src="url" ... /> */
const HTML_IMG_REGEX = /<img[^>]+src=["']([^"']+)["'][^>]*\/?>/gi;

/** 围栏代码块开始/结束标记 */
const FENCE_REGEX = /^\s*(```|~~~)/;

/** 行内代码（支持单、双、三反引号） */
const INLINE_CODE_REGEX = /(`{1,3})(?:(?!\1).)+\1/g;

/**
 * 将行内代码替换为等长空格，防止代码中的图片语法被匹配
 */
function stripInlineCode(line: string): string {
  return line.replace(INLINE_CODE_REGEX, (m) => ' '.repeat(m.length));
}

/**
 * 检测行的 Markdown 上下文类型
 */
function detectContext(line: string): 'normal' | 'blockquote' | 'table' {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('>')) return 'blockquote';
  // 简单判断表格行：以 | 开头或包含至少两个 |
  if (trimmed.startsWith('|') || (trimmed.match(/\|/g)?.length ?? 0) >= 2) return 'table';
  return 'normal';
}

/**
 * 从 Markdown 内容中提取所有图片链接
 * 自动跳过围栏代码块和行内代码中的链接
 */
export function extractImageLinks(content: string): MdImageLink[] {
  const results: MdImageLink[] = [];
  const seenUrls = new Set<string>();
  const lines = content.split('\n');

  let insideFence = false;

  // 逐行扫描，以便获取准确的行号
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // 围栏代码块状态切换
    if (FENCE_REGEX.test(line)) {
      insideFence = !insideFence;
      continue;
    }

    // 跳过围栏代码块内的行
    if (insideFence) continue;

    // 剥离行内代码后用于正则匹配
    const stripped = stripInlineCode(line);
    const context = detectContext(line);

    // Markdown 图片语法
    let match: RegExpExecArray | null;
    MD_IMAGE_REGEX.lastIndex = 0;
    while ((match = MD_IMAGE_REGEX.exec(stripped)) !== null) {
      const url = match[2].trim();
      if (isValidImageUrl(url) && !seenUrls.has(url)) {
        seenUrls.add(url);
        // 从原始行提取 originalText（保持原文不变）
        const originalText = line.substring(match.index, match.index + match[0].length);
        results.push({
          originalText,
          url,
          altText: match[1] || '',
          lineNumber,
          syntax: 'markdown',
          context,
        });
      }
    }

    // HTML img 标签
    HTML_IMG_REGEX.lastIndex = 0;
    while ((match = HTML_IMG_REGEX.exec(stripped)) !== null) {
      const url = match[1].trim();
      if (isValidImageUrl(url) && !seenUrls.has(url)) {
        seenUrls.add(url);
        const originalText = line.substring(match.index, match.index + match[0].length);
        results.push({
          originalText,
          url,
          altText: '',
          lineNumber,
          syntax: 'html',
          context,
        });
      }
    }
  }

  return results;
}

/**
 * 判断是否为有效的图片 URL（过滤 data:、相对路径等）
 */
function isValidImageUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:')) return false;
  if (url.startsWith('#')) return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  return true;
}

/**
 * 剥离已知的链接前缀（搜狗/cdnjson/Jetpack/IPFS Scan 等）
 * 用于从 MD 中的 URL 反向匹配数据库中的原始 URL
 */
export function stripKnownPrefixes(url: string, config: UserConfig): string {
  const prefixes = config.linkPrefixConfig?.prefixList || DEFAULT_LINK_PREFIXES;
  for (const item of prefixes) {
    const original = stripPrefixTemplate(url, item.template);
    if (original !== null) {
      return original;
    }
  }
  return url;
}

/**
 * 智能截断 URL，保留域名和文件名，中间用省略号替代
 * 例: https://cdn.example.com/very/long/path/image.png → https://cdn.example.com/.../image.png
 */
export function smartTruncateUrl(url: string, maxLen = 60): string {
  if (url.length <= maxLen) return url;
  try {
    const u = new URL(url);
    const pathParts = u.pathname.split('/').filter(Boolean);
    const fileName = pathParts.pop() || '';
    const suffix = fileName + u.search + u.hash;

    // 域名 + 文件名仍超长时，退化为尾部截断
    if (u.origin.length + suffix.length + 5 > maxLen) {
      return url.slice(0, maxLen - 3) + '...';
    }
    return `${u.origin}/.../` + suffix;
  } catch {
    return url.slice(0, maxLen - 3) + '...';
  }
}

/**
 * 在 Markdown 内容中替换图片链接
 * 严格只替换图片链接，不改变任何其他内容
 */
export function replaceImageLinks(
  content: string,
  replacements: Map<string, string>,
): string {
  let result = content;
  for (const [oldUrl, newUrl] of replacements) {
    // 转义 URL 中的正则特殊字符
    const escaped = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 只替换在图片语法上下文中的 URL
    result = result.replace(new RegExp(escaped, 'g'), newUrl);
  }
  return result;
}
