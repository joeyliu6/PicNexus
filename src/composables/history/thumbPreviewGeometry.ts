/**
 * thumbPreviewGeometry — 表格视图悬浮预览卡片的几何计算
 *
 * 从 useTableInteractions 抽出：这三个都是纯函数，不碰响应式状态、不读 DOM
 * （只读 window 视口尺寸），因此可以脱离组件单独测试。
 *
 * ⚠️ 这里算出的尺寸就是 PhotoSwipe 开关动画（FLIP）的起止矩形。
 * 卡片根元素上不允许有 transform，否则 getBoundingClientRect() 量到的
 * 是动画中间态，开合两端对不上 —— 详见 thumb-hover-preview.css 的说明。
 */
import type { HistoryItem } from '@/config/types';

/** 预览卡片任一边的最大边长（px） */
export const PREVIEW_MAX_SIZE = 300;
/** 预览卡片与锚点行、与视口边缘的间隙（px） */
export const PREVIEW_MARGIN = 8;

export interface PreviewSize {
  width: number;
  height: number;
}

export interface PreviewPosition {
  top: number;
  left: number;
}

/**
 * 按原图比例把预览缩进 PREVIEW_MAX_SIZE 的方框内。
 * 依次退化：真实宽高 → aspectRatio → 正方形兜底。
 */
export function computePreviewSize(item: HistoryItem): PreviewSize {
  const width = Number(item.width);
  const height = Number(item.height);

  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    const scale = Math.min(1, PREVIEW_MAX_SIZE / width, PREVIEW_MAX_SIZE / height);
    return {
      width: width * scale,
      height: height * scale,
    };
  }

  const aspectRatio = Number(item.aspectRatio);
  if (Number.isFinite(aspectRatio) && aspectRatio > 0) {
    if (aspectRatio >= 1) return { width: PREVIEW_MAX_SIZE, height: PREVIEW_MAX_SIZE / aspectRatio };
    return { width: PREVIEW_MAX_SIZE * aspectRatio, height: PREVIEW_MAX_SIZE };
  }

  return { width: PREVIEW_MAX_SIZE, height: PREVIEW_MAX_SIZE };
}

/** 根据目标行 rect 计算预览的 top/left（避让视口边界） */
export function computePreviewPosition(anchor: DOMRect, previewSize: PreviewSize): PreviewPosition {
  let top = anchor.top + anchor.height / 2 - previewSize.height / 2;
  let left = anchor.right + PREVIEW_MARGIN;
  if (top < PREVIEW_MARGIN) top = PREVIEW_MARGIN;
  if (top + previewSize.height > window.innerHeight - PREVIEW_MARGIN) {
    top = window.innerHeight - previewSize.height - PREVIEW_MARGIN;
  }
  if (left + previewSize.width > window.innerWidth - PREVIEW_MARGIN) {
    left = anchor.left - previewSize.width - PREVIEW_MARGIN;
  }
  if (left < PREVIEW_MARGIN) left = PREVIEW_MARGIN;
  return { top, left };
}

export function buildPreviewStyle(position: PreviewPosition, previewSize: PreviewSize): Record<string, string> {
  return {
    top: `${position.top}px`,
    left: `${position.left}px`,
    width: `${previewSize.width}px`,
    height: `${previewSize.height}px`,
  };
}
