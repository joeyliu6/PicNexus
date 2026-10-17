// 格子上的角标放不放得下（G13 补充）：窄窗口打开详情时一行会被压得很矮，长图格子只剩 20 多 px 宽，
// 放不下的角标不画半截——说明角标（长图 / 全景 / 原尺寸）不画，⚠ 角标只留 ⚠，「仅 1 份」不画（读屏照读，详情里也有）。
// 尺寸与 GalleryTile 的样式一致：角标离格子左缘 8、内边距 7（说明角标 6）、⚠ 图标 11 + 间距 4、字号 11。

const EDGE = 8;
const BADGE_PAD = 7;
const TAG_PAD = 6;
const WARN_ICON = 11;
const ICON_GAP = 4;
const CAPTION = 11;

const measured = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;

/** 11px 字的宽度：量一次记住（角标只有几种文字）；量不了时按每字 11 估 */
function captionWidth(text: string): number {
  const known = measured.get(text);
  if (known !== undefined) return known;
  if (context === undefined) {
    context = document.createElement('canvas').getContext('2d');
    if (context) context.font = `500 ${CAPTION}px ${getComputedStyle(document.documentElement).getPropertyValue('--pn-font-ui') || 'sans-serif'}`;
  }
  const width = context ? context.measureText(text).width : [...text].length * CAPTION;
  measured.set(text, width);
  return width;
}

/** 说明角标（长图 / 全景 6:1 / 48 × 48）放得下 */
export function tagFits(text: string, tileWidth: number): boolean {
  return EDGE + TAG_PAD * 2 + captionWidth(text) <= tileWidth;
}

/** 健康角标怎么画：完整 / 只留 ⚠ / 不画 */
export function badgeFit(badge: { text: string; warn: boolean }, tileWidth: number): 'full' | 'icon' | 'none' {
  const icon = badge.warn ? WARN_ICON + ICON_GAP : 0;
  if (EDGE + BADGE_PAD * 2 + icon + captionWidth(badge.text) <= tileWidth) return 'full';
  return badge.warn && EDGE + BADGE_PAD * 2 + WARN_ICON <= tileWidth ? 'icon' : 'none';
}
