// 图库用键盘移除记录（同资源管理器 / 访达，设计稿没画）：Windows、Linux 按 Delete，macOS 按 ⌘⌫；移除之后焦点给相邻那张。
// 只做纯判断：网格由 GalleryView 的按键处理接，列表由那一行自己接。

import type { UiPlatform } from '@/utils/platform';

/** 这一下是不是「移除记录」：Windows / Linux 单按 Delete，macOS ⌘⌫；多带了别的修饰键不算 */
export function isRemoveKey(event: KeyboardEvent, platform: UiPlatform): boolean {
  if (event.altKey || event.shiftKey) return false;
  return platform === 'macos'
    ? event.key === 'Backspace' && event.metaKey && !event.ctrlKey
    : event.key === 'Delete' && !event.metaKey && !event.ctrlKey;
}

/**
 * 移除之后焦点给谁（order：眼前的先后顺序）：焦点那张还在就留在它身上；
 * 否则从它（没有焦点、或它不在眼前时从第一张被移除的）往后找第一张还在的，后面没有就往前找
 */
export function focusAfterRemoval(order: readonly string[], removed: ReadonlySet<string>, focusedId: string | null): string | null {
  const focused = focusedId ? order.indexOf(focusedId) : -1;
  if (focused >= 0 && !removed.has(order[focused])) return order[focused];
  const from = focused >= 0 ? focused : order.findIndex((id) => removed.has(id));
  if (from < 0) return null;
  const kept = (id: string) => !removed.has(id);
  return order.slice(from + 1).find(kept) ?? order.slice(0, from).reverse().find(kept) ?? null;
}
