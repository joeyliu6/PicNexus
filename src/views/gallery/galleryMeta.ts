// 网格格子与列表行共用的几条展示规则（GalleryScreen.dc.html）：花瓣、常驻角标、状态列。
// 正常不打任何标记，只有出问题才写琥珀色 ⚠ + 原因（交接说明规则 4）。

import type { ImageMeta } from '@/types/image-meta';
import type { PetalState } from '@/utils/petals';

/** 这张图存了几份（至少 1：复制时使用的那份） */
function copiesOf(meta: ImageMeta): number {
  return Math.max(meta.mirrorServices?.length ?? 1, 1);
}

/** 花瓣：几份亮几片；复制时使用的那份失效变红、可能受限变琥珀 */
export function petalsOf(meta: ImageMeta): PetalState[] {
  return Array.from({ length: copiesOf(meta) }, (_, i) => {
    if (i > 0) return 'ok';
    if (meta.copyLinkHealth === 'dead') return 'failed';
    if (meta.copyLinkHealth === 'limited') return 'limited';
    return 'ok';
  });
}

export function petalLabelOf(meta: ImageMeta): string {
  const copies = copiesOf(meta);
  if (meta.copyLinkHealth === 'dead') return `${copies} 份，复制链接已失效`;
  if (meta.copyLinkHealth === 'limited') return `${copies} 份，复制链接可能受限`;
  return `${copies} 份均正常`;
}

/** 格子上的常驻角标：只在需要注意时出现（⚠ 失效 / ⚠ 可能受限 / 仅 1 份） */
export function badgeOf(meta: ImageMeta): { text: string; warn: boolean } | null {
  if (meta.copyLinkHealth === 'dead') return { text: '失效', warn: true };
  if (meta.copyLinkHealth === 'limited') return { text: '可能受限', warn: true };
  if (copiesOf(meta) === 1) return { text: '仅 1 份', warn: false };
  return null;
}

/** 列表「状态」列：平时为空 */
export function statusOf(meta: ImageMeta): { text: string; warn: boolean } {
  if (meta.copyLinkHealth === 'dead') return { text: '失效', warn: true };
  if (meta.copyLinkHealth === 'limited') return { text: '可能受限', warn: true };
  if (meta.copyLinkHealth === 'unchecked') return { text: '尚未检测', warn: false };
  return { text: '', warn: false };
}
