// 花瓣动效的触发时机（M06，交接说明第 10 节：每个动效对应一个真实时刻）。纯判断，便于单测；
// 动效本身在 PetalGlyph 的样式里，「减少动态效果」时不播。

/**
 * ⑥ 完成绽放：「复制结果」换成一份新的非空结果时绽放一次。
 * 传入的是每次复制成功时新建的那份结果（首页会话的 `copied`），按引用比较：
 * 同一格式再复制一次也是一次新的成功；复制失败不会新建结果，不绽放；换到下一张（结果回到 null）不绽放。
 * 打开页面时已经复制好的不补播：由调用方只在值变化时才问（watch 不带 immediate）。
 */
export function shouldBloom(previous: unknown, next: unknown): boolean {
  return next !== null && next !== undefined && next !== previous;
}
