/**
 * 路径中间截断：保留首尾路径段，中间用省略号替代
 * 适用于在有限宽度内展示长路径
 */
function truncateByChars(value: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (value.length <= maxChars) return value;
  if (maxChars === 1) return '\u2026';

  const head = Math.ceil((maxChars - 1) / 2);
  const tail = Math.floor((maxChars - 1) / 2);
  return value.slice(0, head) + '\u2026' + (tail > 0 ? value.slice(-tail) : '');
}

export function middleTruncate(path: string, maxChars: number): string {
  if (!path) return maxChars <= 0 ? '' : '.'.repeat(Math.min(3, maxChars));
  if (path.length <= maxChars) return path;
  const sep = path.includes('\\') ? '\\' : '/';
  const parts = path.split(sep);
  if (parts.length <= 3) {
    return truncateByChars(path, maxChars);
  }
  const head = parts.slice(0, 2).join(sep);
  const tail = parts.slice(-1)[0];
  const compact = `${head}${sep}\u2026${sep}${tail}`;
  if (compact.length > maxChars) return truncateByChars(path, maxChars);

  const fixed = head.length + tail.length + 4;
  if (maxChars <= fixed) return compact;
  const available = maxChars - fixed;
  const mid = parts.slice(2, -1);
  let kept = '';
  for (const p of mid) {
    const next = kept ? kept + sep + p : p;
    if (next.length > available) break;
    kept = next;
  }
  return kept ? `${head}${sep}${kept}${sep}\u2026${sep}${tail}` : `${head}${sep}\u2026${sep}${tail}`;
}
