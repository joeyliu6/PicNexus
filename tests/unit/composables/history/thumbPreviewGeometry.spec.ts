import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryItem } from '@/config/types';
import {
  PREVIEW_MARGIN,
  PREVIEW_MAX_SIZE,
  buildPreviewStyle,
  computePreviewPosition,
  computePreviewSize,
} from '@/composables/history/thumbPreviewGeometry';

function makeItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return { id: 'x', localFileName: 'a.png', timestamp: 0, results: [], ...overrides } as HistoryItem;
}

function makeAnchor(rect: Partial<DOMRect>): DOMRect {
  return {
    left: 0, top: 0, right: 36, bottom: 36, width: 36, height: 36, x: 0, y: 0,
    toJSON: () => ({}), ...rect,
  } as DOMRect;
}

const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

afterEach(() => setViewport(originalWidth, originalHeight));

describe('computePreviewSize', () => {
  it('scales real dimensions down into the max box while keeping the aspect ratio', () => {
    const size = computePreviewSize(makeItem({ width: 1200, height: 800 }));
    expect(size).toEqual({ width: PREVIEW_MAX_SIZE, height: 200 });
  });

  it('never upscales an image that already fits', () => {
    expect(computePreviewSize(makeItem({ width: 120, height: 90 }))).toEqual({ width: 120, height: 90 });
  });

  it('falls back to aspectRatio when width/height are missing or unusable', () => {
    expect(computePreviewSize(makeItem({ aspectRatio: 2 }))).toEqual({ width: 300, height: 150 });
    expect(computePreviewSize(makeItem({ aspectRatio: 0.5 }))).toEqual({ width: 150, height: 300 });
    // 宽高存在但不可用（0 / NaN）时也要退到 aspectRatio，而不是当成有效值算出 0 尺寸
    expect(computePreviewSize(makeItem({ width: 0, height: 0, aspectRatio: 2 }))).toEqual({ width: 300, height: 150 });
  });

  it('falls back to a square when nothing is known', () => {
    expect(computePreviewSize(makeItem())).toEqual({ width: PREVIEW_MAX_SIZE, height: PREVIEW_MAX_SIZE });
  });
});

describe('computePreviewPosition', () => {
  it('centres the card on the anchor row and places it to the right', () => {
    setViewport(1000, 800);
    const pos = computePreviewPosition(makeAnchor({ top: 400, bottom: 436 }), { width: 300, height: 200 });
    expect(pos).toEqual({ top: 400 + 18 - 100, left: 36 + PREVIEW_MARGIN });
  });

  it('flips to the left of the anchor when the card would overflow the right edge', () => {
    setViewport(1000, 800);
    // 右侧放不下（700 + 8 + 300 > 1000 - 8），翻到锚点左边且左边放得下
    const pos = computePreviewPosition(makeAnchor({ left: 664, right: 700 }), { width: 300, height: 200 });
    expect(pos.left).toBe(664 - 300 - PREVIEW_MARGIN);
  });

  it('clamps to the viewport margins at the top, bottom and left', () => {
    setViewport(200, 300);
    // 锚点贴顶 → 上边界夹紧
    expect(computePreviewPosition(makeAnchor({ top: 0, bottom: 36 }), { width: 300, height: 200 }).top)
      .toBe(PREVIEW_MARGIN);
    // 锚点贴底 → 下边界夹紧
    expect(computePreviewPosition(makeAnchor({ top: 290, bottom: 326 }), { width: 300, height: 200 }).top)
      .toBe(300 - 200 - PREVIEW_MARGIN);
    // 视口比卡片还窄，左翻后仍越界 → 夹到左边距
    expect(computePreviewPosition(makeAnchor({ left: 10, right: 46 }), { width: 300, height: 200 }).left)
      .toBe(PREVIEW_MARGIN);
  });
});

describe('buildPreviewStyle', () => {
  it('serialises position and size into px style values', () => {
    expect(buildPreviewStyle({ top: 12, left: 34 }, { width: 300, height: 200 })).toEqual({
      top: '12px',
      left: '34px',
      width: '300px',
      height: '200px',
    });
  });
});
