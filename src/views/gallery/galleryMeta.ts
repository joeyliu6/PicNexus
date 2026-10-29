// 网格格子与列表行共用的几条展示规则（GalleryScreen.dc.html）：花瓣、常驻角标、状态列。
// 正常不打任何标记，只有出问题才写琥珀色 ⚠ + 原因（交接说明规则 4）。

import type { ImageMeta } from '@/types/image-meta';
import type { PetalState } from '@/utils/petals';

/** 这张图存了几份（至少 1：复制时使用的那份） */
function copiesOf(meta: ImageMeta): number {
  return Math.max(meta.mirrorServices?.length ?? 1, 1);
}

/**
 * 花瓣：几份亮几片，一律品牌蓝（GalleryScreen.dc.html）。链接的健康状况由 ⚠ 角标说，
 * 红色只留给「刚才的操作失败了」（交接说明规则 4.5）
 */
export function petalsOf(meta: ImageMeta): PetalState[] {
  return Array.from({ length: copiesOf(meta) }, (): PetalState => 'ok');
}

export function petalLabelOf(meta: ImageMeta): string {
  const copies = copiesOf(meta);
  if (meta.copyLinkHealth === 'dead') return `${copies} 份，复制链接已失效`;
  if (meta.copyLinkHealth === 'limited') return `${copies} 份，复制链接可能受限`;
  if (meta.copyLinkHealth === 'unchecked') return `${copies} 份，复制链接尚未检测`;
  return `${copies} 份均正常`;
}

/**
 * 格子上的常驻角标：只在需要注意时出现（⚠ 失效 / ⚠ 可能受限 / 仅 1 份）。
 * backupsExpected =「上传到」勾了 2 个及以上图床：只勾一个时张张都只有 1 份，「仅 1 份」是常态，不标
 */
export function badgeOf(meta: ImageMeta, { backupsExpected }: { backupsExpected: boolean }): { text: string; warn: boolean } | null {
  if (meta.copyLinkHealth === 'dead') return { text: '失效', warn: true };
  if (meta.copyLinkHealth === 'limited') return { text: '可能受限', warn: true };
  if (backupsExpected && copiesOf(meta) === 1) return { text: '仅 1 份', warn: false };
  return null;
}

/** 列表「状态」列：平时为空 */
export function statusOf(meta: ImageMeta): { text: string; warn: boolean } {
  if (meta.copyLinkHealth === 'dead') return { text: '失效', warn: true };
  if (meta.copyLinkHealth === 'limited') return { text: '可能受限', warn: true };
  if (meta.copyLinkHealth === 'unchecked') return { text: '尚未检测', warn: false };
  return { text: '', warn: false };
}

export type ListLayout = 'wide' | 'narrow' | 'compact';

/**
 * 列表视图按自己的宽度分三档（打开详情、收起侧栏都会变）：七列都放 / 去掉「尺寸 · 大小」/
 * 图床写到文件名下面、状态收成 ⚠。分界按各档列宽之和 + 文件名至少约 180px 定（列宽见 --pn-grid-gallery-list*）。
 * 还没量出宽度（0）时按最宽的画。
 */
export function listLayout(width: number): ListLayout {
  if (width <= 0 || width >= 1080) return 'wide';
  return width >= 820 ? 'narrow' : 'compact';
}
