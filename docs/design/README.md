# PicNexus 设计规范

界面按 Claude Design 交付、已验收的设计包实现（[redesign/](./redesign/README.md)）。改界面前先对照设计源文件 `redesign/handoff/design-source/project/*.dc.html`：尺寸、颜色、文案以它为准；规则与页面说明在 [交接说明](./redesign/handoff/HANDOFF.md)，每张状态图的索引在 `handoff/states/STATES.md`，设计没画、开发时补的做法在 [decisions/](./redesign/decisions/)。

## 文档

| 文档 | 内容 |
|---|---|
| [tokens.md](./tokens.md) | `--pn-*` 令牌：在哪、刻度、门禁、首屏副本 |
| [themes.md](./themes.md) | 深浅色（`data-theme`）与平台（`data-platform`） |
| [ui-patterns.md](./ui-patterns.md) | 界面零件（`Pn*` / 业务组件）、弹窗、浮层、空状态、焦点与键盘 |
| [notification-patterns.md](./notification-patterns.md) | 通知、撤销、确认框、横幅怎么选；新增提醒前必读 |
| [product-copy.md](./product-copy.md) | 文案规则 |
| [settings-layout.md](./settings-layout.md) | 设置页的骨架与规则 |
| [redesign/](./redesign/README.md) | 设计包入口、已定的事、平台限制、各页 decisions |

## 三条底线

1. **只用令牌**：颜色、字号、间距、圆角、阴影、层级、动效时长都写 `var(--pn-*)`；设计稿有、令牌没收录的写成 `tokens-extra.css` 里的具名令牌。`npm run lint` 与截图测试会拦。
2. **只用这套零件**：Reka UI + `src/components/pn/` + `src/components/biz/`，scoped CSS；不用 Tailwind / shadcn-vue / 其他组件库（理由见 [redesign/tech-stack.md](./redesign/tech-stack.md)）。
3. **照设计稿，不顺手优化**：交接说明第 4 节（产品规则）和第 12 节（已否决的方案）是硬约束；设计稿自相矛盾时不自己选，记进 decisions 的「待拍板」。

## 样式文件

```
src/styles/
├── tokens.css        设计稿导出的令牌（原样，不手改）
├── tokens-extra.css  设计稿用到、导出没收录的具名令牌（按页面分段）
├── pn-base.css       字体、box-sizing、页面底、滚动条、焦点环、弹窗遮罩、转圈
└── pn-menu.css       菜单与下拉的共用样式
```

`src/main.ts` 按这个顺序引入（令牌在前）；Cookie 登录小窗的内容页（`src/login-webview.ts`）引入前三份。组件样式写在各自 `.vue` 的 `<style scoped>` 里，传送到 body 的浮层用不带 scoped 的唯一类名。
