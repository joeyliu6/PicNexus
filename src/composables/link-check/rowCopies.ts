// 同一张图在多个图床各有一份链接：缩略图该先用哪一份。纯函数，无 Vue 依赖。

import type { LinkCheckRow } from '@/types/linkCheck';
import { effectiveResult } from './imageHealth';

/**
 * 缩略图该先试哪一份：已确认能访问的 > 主链接自己 > 没检测过的 > 已知坏的
 *
 * Why 不只用主链接：打不开的图正是最需要靠缩略图认出来的那一类，而它自己的地址
 * 恰恰加载不出来；同一张图的其他副本能用就拿来当预览。
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
