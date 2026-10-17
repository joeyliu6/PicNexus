/**
 * 不同比例的图片在图库里怎么占格、怎么画（ImageRatios.dc.html，G13）
 *
 * 等高行里每张图保留原比例；只有极端比例才裁切，并用角标说明：
 * - 长图（滚动截图）：高宽比超过 2.5，格子裁成 1:2.5，从顶部显示、底部渐隐，标「长图」
 * - 超宽图（全景、横幅）：宽高比超过 4，格子居中裁成 4:1，角标写实际比例「全景 6:1」
 * - 小图（图标、表情）：短边小于 120，放进方格、按原尺寸居中、不放大，右下角标原尺寸
 *
 * 小图优先：长图 / 全景的裁切格会把图标、徽章这类小图放大得更糊。
 * 排版（justifiedLayout）只认 layoutRatio；按天汇总的同一套规则在 TimelineQueryService 的 SQL 里。
 */

/** 高宽比超过它算长图 */
export const LONG_IMAGE_RATIO = 2.5;
/** 宽高比超过它算超宽图 */
export const WIDE_IMAGE_RATIO = 4;
/** 短边小于它算小图 */
export const SMALL_IMAGE_SIDE = 120;

export type DisplayKind = 'normal' | 'long' | 'wide' | 'small';

export interface DisplayInput {
  /** 宽 / 高 */
  aspectRatio: number;
  width?: number | null;
  height?: number | null;
}

const ratioOf = (input: DisplayInput): number => (input.aspectRatio > 0 ? input.aspectRatio : 1);

/** 高宽比超过 2.5（灯箱里这类图按宽度显示、上下滚动看全，不看尺寸大小） */
export function isLongRatio(aspectRatio: number): boolean {
  return aspectRatio > 0 && aspectRatio < 1 / LONG_IMAGE_RATIO;
}

export function displayKind(input: DisplayInput): DisplayKind {
  const { width, height } = input;
  if (width && height && width > 0 && height > 0 && Math.min(width, height) < SMALL_IMAGE_SIDE) return 'small';
  const ratio = ratioOf(input);
  if (isLongRatio(ratio)) return 'long';
  if (ratio > WIDE_IMAGE_RATIO) return 'wide';
  return 'normal';
}

/** 格子的宽高比 */
export function layoutRatio(input: DisplayInput): number {
  switch (displayKind(input)) {
    case 'small': return 1;
    case 'long': return 1 / LONG_IMAGE_RATIO;
    case 'wide': return WIDE_IMAGE_RATIO;
    default: return ratioOf(input);
  }
}

/** 比例保留一位小数，整数不带「.0」 */
const ratioText = (ratio: number): string => String(Number(ratio.toFixed(1)));

/**
 * 格子上的说明角标；常规比例没有。
 * 长图只写「长图」：1:2.5 的格子只有 48–60 px 宽，放不下画板里的「长图 1:5.6」。
 */
export function displayTag(input: DisplayInput): string | null {
  switch (displayKind(input)) {
    case 'long': return '长图';
    case 'wide': return `全景 ${ratioText(ratioOf(input))}:1`;
    case 'small': return `${input.width} × ${input.height}`;
    default: return null;
  }
}

/** 文件格式（小写扩展名）：数据库里记的是上传时的扩展名，没记（unknown）就看文件名 */
export function imageFormat(meta: { format?: string | null; localFileName?: string }): string {
  const stored = meta.format?.toLowerCase();
  if (stored && stored !== 'unknown') return stored;
  const match = /\.([a-z0-9]+)$/i.exec(meta.localFileName ?? '');
  return match ? match[1].toLowerCase() : '';
}

const OPAQUE_FORMATS = new Set(['jpg', 'jpeg', 'jpe', 'jfif']);

/**
 * 可能带透明区域：图片底下衬棋盘格（透明的地方才露出来，不透明的图整个盖住它）。
 * 数据库没有记录每张图是否真的透明，只能按格式判断。
 */
export function mayBeTransparent(format: string): boolean {
  return !OPAQUE_FORMATS.has(format);
}

/**
 * 动图：格子里先停在第一帧、标「GIF」，鼠标停留时才播放。
 * 动态 WebP 从扩展名看不出来，按静态图显示。
 */
export function isAnimatedFormat(format: string): boolean {
  return format === 'gif';
}
