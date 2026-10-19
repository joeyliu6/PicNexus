# 动效令牌集中管理

## 适用场景

- 新写的组件要加过渡或动画，不知道该用多长、什么曲线
- 想让「减少动态效果」一处生效，而不是每个组件各写一遍

## 做法

时长与缓动全部是令牌，定义在 `src/styles/tokens.css`（设计稿导出的四档）和 `src/styles/tokens-extra.css`（转圈、Logo 动效），速查表在 [docs/design/tokens.md](../../design/tokens.md)「动效」：

- 时长：`--pn-dur-instant` 100（悬停）/ `fast` 150（复制、开关）/ `standard` 200（菜单出现）/ `expressive` 250（对话框、灯箱）；`--pn-dur-spin` 转圈一周；花瓣三个动效各一个。
- 缓动：进场 `--pn-ease-in`，退场 `--pn-ease-out` 且时长快 30%。
- 关键帧：只有多处共用的才放全局（`pn-base.css` 里的 `pn-spin`、`pn-dialog-in`、`pn-dialog-fade`）；其余写在组件自己的 `<style>` 里，名字带组件前缀（`drop-overlay-fan`、`petals-bloom`）。
- stylelint 拦写死的时长：`transition` / `animation` 里不能有裸的 `ms` / `s`。

```css
.focus-card__pill { transition: background var(--pn-dur-fast) var(--pn-ease-in); }
.pn-dialog[data-state='open'] { animation: pn-dialog-in var(--pn-dur-expressive) var(--pn-ease-in); }

@media (prefers-reduced-motion: reduce) {
  .pn-dialog[data-state='open'] { animation-name: pn-dialog-fade; }
}
```

## 减少动态效果

- `--pn-dur-fast / standard / expressive` 与三个花瓣时长在 `@media (prefers-reduced-motion: reduce)` 里归零；`pn-spin` 在同一条件下改成不转的关键帧。
- 有位移、缩放的进场，在组件里改用纯淡入（`pn-dialog-fade`），不要只靠时长归零——归零后是「直接出现」，交接说明 5.3 要的是「位移改淡入」。
- JS 里写死的时长（传给 PhotoSwipe 的灯箱开关时长等）走 `src/utils/reducedMotion.ts` 的 `motionDuration()`。
- 守门测试在真浏览器里记 `animationstart` / `transitionstart`（`tests/e2e/motion.e2e.spec.ts`），jsdom 不跑 CSS 动画，单测证明不了。

## 不做

- 不引入动效库：全是 transform / opacity。
- 不给每个组件定私有时长变量：用令牌，确有设计稿原值再写成具名令牌。
