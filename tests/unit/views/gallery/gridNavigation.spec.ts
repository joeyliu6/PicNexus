import { describe, expect, it } from 'vitest';
import { neighborTile } from '@/views/gallery/gridNavigation';
import type { LayoutRow } from '@/utils/justifiedLayout';

// 交接说明 8.2：网格里方向键移动。← → 按顺序走（跨行、跨天），↑ ↓ 去上 / 下一行里最靠近的那张。

const row = (y: number, items: Array<[string, number, number]>): { row: LayoutRow } => ({
  row: { y, height: 150, items: items.map(([id, x, width]) => ({ id, x, y, width, height: 150 })) },
});

const ROWS = [
  row(0, [['a', 0, 300], ['b', 306, 200], ['c', 512, 400]]),
  row(156, [['d', 0, 500], ['e', 506, 406]]),
  // 下一天
  row(400, [['f', 0, 200]]),
];

describe('neighborTile', () => {
  it('steps left and right through the order, across rows and days', () => {
    expect(neighborTile(ROWS, 'c', 'right')).toBe('d');
    expect(neighborTile(ROWS, 'd', 'left')).toBe('c');
    expect(neighborTile(ROWS, 'e', 'right')).toBe('f');
  });

  it('goes up and down to the image whose middle is nearest', () => {
    expect(neighborTile(ROWS, 'b', 'down')).toBe('d');
    expect(neighborTile(ROWS, 'c', 'down')).toBe('e');
    expect(neighborTile(ROWS, 'e', 'up')).toBe('c');
    expect(neighborTile(ROWS, 'd', 'down')).toBe('f');
  });

  it('stays put at the edges and starts at the first image when nothing is focused', () => {
    expect(neighborTile(ROWS, 'a', 'left')).toBe('a');
    expect(neighborTile(ROWS, 'f', 'down')).toBe('f');
    expect(neighborTile(ROWS, null, 'right')).toBe('a');
    expect(neighborTile([], null, 'down')).toBeNull();
  });
});
