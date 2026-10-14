// 同一张图在多个图床各有一份链接（一份 = 一行）。这里回答「这一行坏了，图还在不在」。
// 纯函数，无 Vue 依赖：调用方负责只对可见行求值，避免每个进度 tick 扫全量。

import type { CheckLinkResult, LinkCheckRow } from '@/types/linkCheck';

export interface CopyHint {
  text: string;
  tone: 'ok' | 'error';
  tooltip: string;
}

function effectiveResult(row: LinkCheckRow): CheckLinkResult | undefined {
  return row.recheckResult ?? row.checkResult;
}

/**
 * 按 historyId 建索引
 *
 * 只读 `historyId`（建好后不再变），所以放进 computed 时只随数组引用重算，
 * 不会因为某一行的检测结果变化而重建。
 */
export function indexRowsByHistory(rows: readonly LinkCheckRow[]): Map<string, LinkCheckRow[]> {
  const index = new Map<string, LinkCheckRow[]>();
  for (const row of rows) {
    const list = index.get(row.historyId);
    if (list) list.push(row);
    else index.set(row.historyId, [row]);
  }
  return index;
}

/** 同一张图的其他图床链接（不含自己） */
export function siblingRows(row: LinkCheckRow, index: ReadonlyMap<string, LinkCheckRow[]>): LinkCheckRow[] {
  return (index.get(row.historyId) ?? []).filter((r) => r.serviceId !== row.serviceId);
}

/**
 * 坏链接的后果提示
 *
 * - 其他图床还有能用的 → 图没丢，只是这一份坏了（绿）
 * - 有别的副本但都坏了 / 只有这一份 → 图真的可能丢了（红）
 * - 正常 / 未检测 / 防盗链之类「浏览器多半能看」的 → 不提示，避免把小事说成大事
 */
export function copyHint(row: LinkCheckRow, siblings: readonly LinkCheckRow[]): CopyHint | null {
  const result = effectiveResult(row);
  if (!result || result.is_valid || result.browser_might_work || result.error_type === 'redirect') return null;

  const okCount = siblings.filter((s) => effectiveResult(s)?.is_valid).length;
  if (okCount > 0) {
    return {
      text: okCount === siblings.length ? '其他图床正常' : `${okCount} 个备份可用`,
      tone: 'ok',
      tooltip: `这张图在其他 ${okCount} 个图床上仍可访问，图片没有丢失`,
    };
  }
  if (siblings.length === 0) {
    return { text: '无备份', tone: 'error', tooltip: '这张图只上传到了这一个图床，链接失效后无法自动恢复' };
  }
  const unchecked = siblings.filter((s) => !effectiveResult(s)).length;
  if (unchecked > 0) return null;
  return { text: '备份也失效', tone: 'error', tooltip: `这张图的其他 ${siblings.length} 个备份也无法访问` };
}

/**
 * 缩略图该先试哪一份：已确认能访问的 > 这一行自己 > 没检测过的 > 已知坏的
 *
 * Why 不只用这一行自己的链接：坏链接正是最需要靠缩略图认出来的那一类，
 * 而它自己的地址恰恰加载不出来；同一张图的其他副本能用就拿来当预览。
 */
export function thumbnailCopyOrder(row: LinkCheckRow, siblings: readonly LinkCheckRow[]): LinkCheckRow[] {
  const rank = (r: LinkCheckRow): number => {
    const result = effectiveResult(r);
    if (result?.is_valid) return 0;
    if (r === row) return 1;
    if (!result) return 2;
    return 3;
  };
  return [row, ...siblings]
    .map((r, i) => ({ r, i, k: rank(r) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map(({ r }) => r);
}
