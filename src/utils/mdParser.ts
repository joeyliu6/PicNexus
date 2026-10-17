// Markdown 文档里的图片链接：替换（文档修复写回）与剥前缀（认出加了代理前缀的旧链接）。
// 提取链接在 Rust 侧（md_scanner.rs 的 scan_md_folder），这里的围栏 / 行内代码规则与它保持一致。

import type { UserConfig } from '@/config/types';
import { DEFAULT_LINK_PREFIXES } from '@/config/types';
import { stripPrefixTemplate } from './linkPrefixTemplate';

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

interface MarkdownImageMatch {
  start: number;
  end: number;
  alt: string;
  url: string;
  urlStart: number;
  urlEnd: number;
}

function isEscaped(text: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) count++;
  return count % 2 === 1;
}

function findUnescaped(text: string, char: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === char && !isEscaped(text, i)) return i;
  }
  return -1;
}

function parseTitleAndClose(line: string, pos: number): number | null {
  let i = pos;
  while (i < line.length && /\s/.test(line[i])) i++;
  if (i === pos || line[i] !== '"') return null;

  i++;
  while (i < line.length) {
    if (line[i] === '"' && !isEscaped(line, i)) {
      i++;
      return line[i] === ')' ? i + 1 : null;
    }
    i++;
  }

  return null;
}

function parseMarkdownImageAt(line: string, start: number): MarkdownImageMatch | null {
  if (line[start] !== '!' || line[start + 1] !== '[') return null;

  const altEnd = findUnescaped(line, ']', start + 2);
  if (altEnd === -1 || line[altEnd + 1] !== '(') return null;

  const urlStart = altEnd + 2;
  if (urlStart >= line.length) return null;

  // CommonMark 允许目的地址用尖括号包裹，这里保留括号外的 title 兼容。
  if (line[urlStart] === '<') {
    const urlEnd = findUnescaped(line, '>', urlStart + 1);
    if (urlEnd === -1) return null;
    const close = line[urlEnd + 1] === ')'
      ? urlEnd + 2
      : parseTitleAndClose(line, urlEnd + 1);
    if (close === null) return null;
    return {
      start,
      end: close,
      alt: line.slice(start + 2, altEnd),
      url: line.slice(urlStart + 1, urlEnd).trim(),
      urlStart: urlStart + 1,
      urlEnd,
    };
  }

  let depth = 0;
  for (let i = urlStart; i < line.length; i++) {
    const ch = line[i];
    if (isEscaped(line, i)) continue;

    if (ch === '(') {
      depth++;
      continue;
    }

    if (ch === ')') {
      if (depth > 0) {
        depth--;
        continue;
      }
      return {
        start,
        end: i + 1,
        alt: line.slice(start + 2, altEnd),
        url: line.slice(urlStart, i).trim(),
        urlStart,
        urlEnd: i,
      };
    }

    if (/\s/.test(ch) && depth === 0) {
      const close = parseTitleAndClose(line, i);
      if (close === null) return null;
      return {
        start,
        end: close,
        alt: line.slice(start + 2, altEnd),
        url: line.slice(urlStart, i).trim(),
        urlStart,
        urlEnd: i,
      };
    }
  }

  return null;
}

function parseMarkdownImageMatches(line: string): MarkdownImageMatch[] {
  const matches: MarkdownImageMatch[] = [];
  let searchFrom = 0;

  while (searchFrom < line.length) {
    const start = line.indexOf('![', searchFrom);
    if (start === -1) break;
    const match = parseMarkdownImageAt(line, start);
    if (match) {
      matches.push(match);
      searchFrom = match.end;
    } else {
      searchFrom = start + 2;
    }
  }

  return matches;
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
 * 在 Markdown 内容中替换图片链接
 *
 * 严格只替换图片语法（![alt](url) / <img src="url">）中的 URL：
 * - 跳过围栏代码块内容（与 Rust 侧 scan_md_folder 的提取同一套 fence 规则）
 * - 跳过行内代码 spans
 * - 普通链接 [text](url)、正文里出现的裸 URL、注释均不会被改写
 * - 使用 callback 形式替换，newUrl 中的 `$&` / `$1` 不会被当作反向引用
 */
export function replaceImageLinks(content: string, replacements: Map<string, string>): string {
  if (replacements.size === 0) return content;

  const lines = content.split('\n');
  let fenceOpen: { char: string; len: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 围栏跟踪（CommonMark：同字符、数量不少于开头、尾部只有空白才算关闭）
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

  let result = line;
  const mdMatches = parseMarkdownImageMatches(line)
    .filter((match) => !inCode(match.start))
    .reverse();
  for (const match of mdMatches) {
    const newUrl = replacements.get(match.url.trim());
    if (newUrl === undefined) continue;
    result = result.slice(0, match.urlStart) + newUrl + result.slice(match.urlEnd);
  }

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
