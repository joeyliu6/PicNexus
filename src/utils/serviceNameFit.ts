// 图床名「放不放得下」的估算，以及据此拼 tooltip
//
// Why 需要这层：标签有 max-width（见 docs/design/tokens.md#service-name-truncation），
// 名字放得下时标签已经完整显示，tooltip 再重复一遍就是双重反馈；放不下被 ellipsis
// 截断时，tooltip 又是看到全名的唯一入口。两种情况要给不同文案。
//
// ⚠️ 没有用 `scrollWidth > clientWidth` 做真实测量，有两个硬原因：
// 1. 这些标签大量存在于 VirtualScroller / DataTable 的**复用节点**里，节点回收复用时
//    ResizeObserver 会疯狂 churn；
// 2. PrimeVue tooltip 在 mouseenter 当场就要拿到最终文案，等不到异步测量结果。
//
// 字符宽度估算够用：内置图床名最长 5 个汉字（"Cloudflare R2" 是 ASCII，约 78px），
// 离 96px 都有余量，只有用户自定义的 profile 名会越线——而那正是要带全名的那一类。

const CHAR_WIDTH_ASCII = 6;
const CHAR_WIDTH_CJK = 11;

/** 最窄一档标签宽度（徽章 / chip），见 docs/design/tokens.md#service-name-truncation */
export const COMPACT_LABEL_WIDTH = 96;

/** 按中英文分别计宽估算文本像素宽度 */
export function estimateServiceNameWidth(name: string): number {
  let width = 0;
  for (const char of name) {
    width += char.charCodeAt(0) > 0x7F ? CHAR_WIDTH_CJK : CHAR_WIDTH_ASCII;
  }
  return width;
}

/** 名字是否可能被 ellipsis 截断 */
export function mayTruncateServiceName(name: string, maxWidth = COMPACT_LABEL_WIDTH): boolean {
  return estimateServiceNameWidth(name) > maxWidth;
}

/**
 * 拼图床名 tooltip
 *
 * - 名字放得下：只返回 detail（没有 detail 就不显示 tooltip）
 * - 名字放不下：前置全名，`全名 · detail`
 */
export function serviceNameTooltip(
  name: string,
  detail?: string | null,
  maxWidth = COMPACT_LABEL_WIDTH
): string | undefined {
  if (!mayTruncateServiceName(name, maxWidth)) return detail || undefined;
  return detail ? `${name} · ${detail}` : name;
}
