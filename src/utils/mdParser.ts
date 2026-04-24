// Markdown 文件图片链接解析器

import type { MdImageLink } from '../types/linkCheck';
import type { UserConfig } from '../config/types';
import { DEFAULT_LINK_PREFIXES } from '../config/types';
import { stripPrefixTemplate } from './linkPrefixTemplate';

/** 标准 Markdown 图片语法: ![alt](url "title") */
const MD_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** HTML img 标签: <img src="url" ... /> */
const HTML_IMG_REGEX = /<img[^>]+src=["']([^"']+)["'][^>]*\/?>/gi;

/**
 * 围栏代码块首行正则（捕获 3+ 连续反引号或波浪号）
 * 按 CommonMark：
 * - 允许 0-3 空格缩进（≥4 空格属于缩进代码块，不是围栏）
 * - open fence 可以带 info string（如 ```python）
 * - close fence 必须与 open 同字符、数量 ≥ open，且尾部只能是空白
 */
const FENCE_REGEX = /^ {0,3}(`{3,}|~{3,})/;

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
 * 默认跳过围栏代码块和行内代码中的链接；
 * 传入 `{ includeCodeBlocks: true }` 时一并提取代码块内的图片链接。
 */
export function extractImageLinks(
  content: string,
  options?: { includeCodeBlocks?: boolean },
): MdImageLink[] {
  const includeCodeBlocks = options?.includeCodeBlocks ?? false;
  const results: MdImageLink[] = [];
  const seenUrls = new Set<string>();
  const lines = content.split('\n');

  // 当前打开的围栏：{ 开头字符, 反引号/波浪数 }；null 表示未在围栏内
  // 仅同字符 + 反引号数 ≥ open 时才关闭，避免 ``` 与 ~~~ 串扰和嵌套误判
  let fenceOpen: { char: string; len: number } | null = null;

  // 逐行扫描，以便获取准确的行号
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    if (!includeCodeBlocks) {
      const fenceMatch = FENCE_REGEX.exec(line);
      if (fenceMatch) {
        const seq = fenceMatch[1];
        const char = seq[0];
        const len = seq.length;
        // close fence 尾部必须只有空白（CommonMark 4.5），否则仍视为围栏内字面量
        const tailWs = /^\s*$/.test(line.slice(fenceMatch[0].length));
        if (fenceOpen === null) {
          fenceOpen = { char, len };
          continue;
        }
        if (fenceOpen.char === char && len >= fenceOpen.len && tailWs) {
          fenceOpen = null;
          continue;
        }
        // 同字符长度不足 / 不同字符 / 尾部带 info string：落到下方"仍在围栏内"分支被跳过
      }
      // 当前仍在围栏内 → 跳过（含上方未关闭成功的 fence 行字面量）
      if (fenceOpen !== null) continue;
    }

    // 代码块模式下直接用原始行，否则剥离行内代码后再匹配
    const stripped = includeCodeBlocks ? line : stripInlineCode(line);
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
