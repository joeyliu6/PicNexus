// 链接块分色（Patterns.dc.html「链接块」）：按格式语法分色——网址蓝色、文件名正文色、语法符号灰色。
// 不按格式写死规则，而是在已经生成好的链接文字里找网址与文件名，自定义模板也能用。

import { markdownAlt } from './linkFormatter';

export type LinkSegmentKind = 'url' | 'name' | 'syntax';

export interface LinkSegment {
  kind: LinkSegmentKind;
  text: string;
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * @param text      已按当前格式生成的链接（formatLink 的结果）
 * @param url       图片地址
 * @param filename  文件名（Markdown / HTML 里出现的那一段；HTML 里可能是转义后的样子）
 */
export function splitLinkSegments(text: string, url: string, filename?: string): LinkSegment[] {
  const needles: Array<{ value: string; kind: LinkSegmentKind }> = [];
  if (url) needles.push({ value: url, kind: 'url' });
  if (filename) {
    needles.push({ value: filename, kind: 'name' });
    const escaped = escapeHtmlAttr(filename);
    if (escaped !== filename) needles.push({ value: escaped, kind: 'name' });
    // Markdown 的说明不带扩展名；排在完整文件名之后，同一位置时先认完整的
    const alt = markdownAlt(filename);
    if (alt !== filename) needles.push({ value: alt, kind: 'name' });
  }

  const segments: LinkSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let best: { index: number; value: string; kind: LinkSegmentKind } | null = null;
    for (const needle of needles) {
      const index = text.indexOf(needle.value, cursor);
      // 网址排在第一个：同一位置时认成网址（网址里可能恰好含有文件名）
      if (index >= 0 && (!best || index < best.index)) {
        best = { index, value: needle.value, kind: needle.kind };
      }
    }
    if (!best) {
      segments.push({ kind: 'syntax', text: text.slice(cursor) });
      break;
    }
    if (best.index > cursor) segments.push({ kind: 'syntax', text: text.slice(cursor, best.index) });
    segments.push({ kind: best.kind, text: best.value });
    cursor = best.index + best.value.length;
  }
  return segments;
}
