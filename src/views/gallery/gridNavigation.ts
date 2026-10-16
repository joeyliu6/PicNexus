// 图库网格的方向键（交接说明 8.2）：← → 按顺序走（跨行、跨天），↑ ↓ 去上 / 下一行里中线最近的那张。
// 输入是布局算好的行（justifiedLayout 的 allRows），只做纯计算。

import type { LayoutRow } from '@/utils/justifiedLayout';

export type GridDirection = 'left' | 'right' | 'up' | 'down';

export function neighborTile(rows: ReadonlyArray<{ row: LayoutRow }>, currentId: string | null, direction: GridDirection): string | null {
  const order = rows.flatMap(({ row }) => row.items.map((item) => item.id));
  if (order.length === 0) return null;
  if (!currentId) return order[0];

  const rowIndex = rows.findIndex(({ row }) => row.items.some((item) => item.id === currentId));
  if (rowIndex < 0) return order[0];

  if (direction === 'left' || direction === 'right') {
    const index = order.indexOf(currentId);
    const next = direction === 'right' ? Math.min(index + 1, order.length - 1) : Math.max(index - 1, 0);
    return order[next];
  }

  const target = rows[rowIndex + (direction === 'down' ? 1 : -1)];
  if (!target) return currentId;
  const current = rows[rowIndex].row.items.find((item) => item.id === currentId)!;
  const middle = current.x + current.width / 2;
  let nearest = target.row.items[0];
  for (const item of target.row.items) {
    if (Math.abs(item.x + item.width / 2 - middle) < Math.abs(nearest.x + nearest.width / 2 - middle)) nearest = item;
  }
  return nearest.id;
}
