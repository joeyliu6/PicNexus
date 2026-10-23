// 换顺序时每一项从原位置滑到新位置（FLIP）：换之前量好每一项（带 data-flip-key）的位置，换完让位置变了的
// 从原位置用 transform 滑回来。用 Web Animations 而不是 TransitionGroup 的 -move 类：不跟 Vue 重绘、不靠类名，
// 外面套了别的组件（右键菜单）也能用。时长、缓动取令牌 --pn-dur-standard / --pn-ease-in；
// 「减少动态效果」时时长令牌是 0，直接到位。

export type FlipPositions = Map<string, number>;

function items(container: HTMLElement | null): HTMLElement[] {
  return container ? [...container.querySelectorAll<HTMLElement>('[data-flip-key]')] : [];
}

/** 换顺序之前：量下每一项现在离窗口顶多远 */
export function measureFlip(container: HTMLElement | null): FlipPositions {
  return new Map(items(container).map((el) => [el.dataset.flipKey!, el.getBoundingClientRect().top]));
}

/** 换完顺序（DOM 已更新）之后：位置变了的每一项从原位置滑过来；新出现的、量不到位置的不动 */
export function playFlip(container: HTMLElement | null, before: FlipPositions): void {
  const root = getComputedStyle(document.documentElement);
  const duration = Number.parseFloat(root.getPropertyValue('--pn-dur-standard'));
  if (!(duration > 0)) return;
  const easing = root.getPropertyValue('--pn-ease-in').trim() || 'ease-out';
  for (const el of items(container)) {
    const from = before.get(el.dataset.flipKey!);
    if (from === undefined) continue;
    const dy = from - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration, easing });
  }
}
