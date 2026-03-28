/**
 * 路径中间截断：保留首尾路径段，中间用省略号替代
 * 适用于在有限宽度内展示长路径
 */
export function middleTruncate(path: string, maxChars: number): string {
  if (!path || path.length <= maxChars) return path || '...';
  const sep = path.includes('\\') ? '\\' : '/';
  const parts = path.split(sep);
  if (parts.length <= 3) {
    const half = Math.floor((maxChars - 1) / 2);
    return path.slice(0, half) + '\u2026' + path.slice(-half);
  }
  const head = parts.slice(0, 2).join(sep);
  const tail = parts.slice(-1)[0];
  const fixed = head.length + tail.length + 4;
  if (maxChars <= fixed) return `${head}${sep}\u2026${sep}${tail}`;
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
