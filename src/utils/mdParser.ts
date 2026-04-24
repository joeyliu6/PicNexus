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
 *
 * 严格只替换图片语法（![alt](url) / <img src="url">）中的 URL：
 * - 跳过围栏代码块内容（与 extractImageLinks 同步跟踪 fence 状态）
 * - 跳过行内代码 spans
 * - 普通链接 [text](url)、正文里出现的裸 URL、注释均不会被改写
 * - 使用 callback 形式替换，newUrl 中的 `$&` / `$1` 不会被当作反向引用
 */
export function replaceImageLinks(
  content: string,
  replacements: Map<string, string>,
): string {
  if (replacements.size === 0) return content;

  const lines = content.split('\n');
  let fenceOpen: { char: string; len: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 围栏跟踪（与 extractImageLinks 的 fence 状态机完全一致）
    const fenceMatch = FENCE_REGEX.exec(line);
    if (fenceMatch) {
      const seq = fenceMatch[1];
      const char = seq[0];
      const len = seq.length;
      const tailWs = /^\s*$/.test(line.slice(fenceMatch[0].length));
      if (fenceOpen === null) {
        fenceOpen = { char, len };
        continue;
      }
      if (fenceOpen.char === char && len >= fenceOpen.len && tailWs) {
        fenceOpen = null;
        continue;
      }
    }
    if (fenceOpen !== null) continue;

    lines[i] = replaceInLine(line, replacements);
  }

  return lines.join('\n');
}

/** 单行内：仅在图片语法中替换 URL，跳过行内代码 */
function replaceInLine(line: string, replacements: Map<string, string>): string {
  // 先定位行内代码 spans；图片语法命中时若 offset 落在 span 内则不替换
  const codeSpans = locateInlineCode(line);
  const inCode = (pos: number) => codeSpans.some((s) => pos >= s.start && pos < s.end);

  // Markdown 图片：![alt](url "title"?)
  const mdRe = /!\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;
  let result = line.replace(mdRe, (match, alt: string, url: string, title: string, offset: number) => {
    if (inCode(offset)) return match;
    const newUrl = replacements.get(url.trim());
    if (newUrl === undefined) return match;
    return `![${alt}](${newUrl}${title ?? ''})`;
  });

  // HTML 替换后偏移量变了，重新定位行内代码
  const codeSpans2 = locateInlineCode(result);
  const inCode2 = (pos: number) => codeSpans2.some((s) => pos >= s.start && pos < s.end);

  const htmlRe = /(<img[^>]+src=["'])([^"']+)(["'][^>]*\/?>)/gi;
  result = result.replace(htmlRe, (match, prefix: string, url: string, suffix: string, offset: number) => {
    if (inCode2(offset)) return match;
    const newUrl = replacements.get(url.trim());
    if (newUrl === undefined) return match;
    return `${prefix}${newUrl}${suffix}`;
  });

  return result;
}

function locateInlineCode(line: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  // 复用模块级 regex：避免大文件下每行多次 new RegExp 的构造开销
  // 调用前必须显式重置 lastIndex——String.replace 对 g flag 会自动归零，但 exec 不会
  INLINE_CODE_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_CODE_REGEX.exec(line)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}
