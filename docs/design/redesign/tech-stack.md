# 界面重构 · 技术选型

> 读者：维护者，以及按设计稿写代码的 AI。设计规则与页面细节以 [handoff/HANDOFF.md](./handoff/HANDOFF.md) 为准，本文只管「用什么做」。

## 1. 结论

**桌面框架、后端、业务逻辑都不换；界面层按设计稿重写，零件用 Reka UI + 自写组件。**

| 层 | 现在 | 重构后 |
|---|---|---|
| 桌面框架 | Tauri 2 | 不变 |
| 后端 | Rust | 不变；为托盘原生菜单、上传日历等加少量命令 |
| 前端框架 | Vue 3 + TypeScript + Vite | 不变 |
| 业务逻辑 | composables / core / services / uploaders / store | 保留，只在设计要求变行为的地方定点修改 |
| 界面零件 | PrimeVue 4 + PrimeIcons | **Reka UI**（无样式，只管键盘、焦点、读屏）+ 自写 `Pn*` 组件 |
| 图标 | PrimeIcons | `PnIcon`：形状照抄设计源文件的 SVG（`src/components/pn/icons.ts`），不从图标库里挑近似的；图床 logo 继续用项目自带的 SVG |
| 样式 | 主题 CSS + PrimeVue 覆盖样式 | scoped CSS，只引用 `var(--pn-*)` 令牌（[handoff/tokens/tokens.css](./handoff/tokens/tokens.css)） |
| 通知 / 确认框 | PrimeVue Toast / ConfirmDialog | 自写 PnToast / PnDialog，挂在现有 `useToast` / `useConfirm` / `useUndoToast` 下面，调用方式不变 |
| 长列表 | PrimeVue VirtualScroller + 自写虚拟时间轴 | `@tanstack/vue-virtual`；等高行排版算法（`utils/justifiedLayout.ts`）保留 |
| 页面切换 | `currentView` + 事件 + provide/inject | vue-router（内存模式），托盘、命令面板、应用内跳转都走路由 |
| 灯箱 | PhotoSwipe + 自写桥接 | 不变 |
| 托盘 | 网页浮窗（`tray-menu.html`） | Tauri 原生菜单（`Menu` / `CheckMenuItem` / `Submenu`） |

## 2. 为什么不用 shadcn-vue + Tailwind

- **设计稿本身就是「CSS 变量 + 精确像素」**：令牌是一组 `--pn-*` 变量，源文件的尺寸全写在行内样式里，有大量不在刻度上的值。照抄成 CSS 是一比一；写成 Tailwind 类名，要么写方括号任意值，要么逐个注册名字。
- **shadcn-vue 拿来也要重写长相**：它的零件 = Reka UI + 一套 Tailwind 类名 + 它自己的一套颜色名。设计稿的按钮、弹窗、通知规格都很具体，几乎每个都得改，最后有用的只剩底层的 Reka UI。
- **现有样式门禁继续有效**：stylelint（禁止写死颜色、间距、字号、z-index）、`check-css-undefined-vars`、`check-theme-token-copies` 都只查 CSS。样式写进类名，这些门禁就看不到了。
- 代价：每个零件多写几十行 CSS。成品长相两条路一样。

不做：前端改用 React。上传编排、镜像回退、链接检测、同步、加密都写在 Vue composables 里并有大量测试护着，重写没有产品收益，只有回归风险。

## 3. 规矩跟着变的地方

| 规矩 | 重构后 |
|---|---|
| CSS 禁止写死颜色、间距等 | 保留。设计稿用到而导出令牌没收录的颜色、尺寸，以及不在刻度上的值，写成具名令牌放进 `src/styles/tokens-extra.css`，不硬写、也不凑到最近的刻度 |
| 令牌位置 | `src/styles/tokens.css`（设计包原样）+ `src/styles/tokens-extra.css`；旧的 `light-theme.css` / `dark-theme.css` 在最后一个旧页面删掉时一并删除；`check-theme-token-copies.mjs` 改读新位置 |
| 主题与平台 | 根元素 `data-theme="light|dark"`、`data-platform="windows|macos|linux"` |
| 单个 `.vue` 不超过 500 行 | 保留 |
| Logger、Store 单例、配置深拷贝 | 不变 |
| 视觉基准图 | 按页面重做后逐页重录（1400×900 与 800×600，浅 / 深）；跨引擎布局探针保留 |

## 4. 落地时要核实的事

- 各库的确切版本（以 npm / crates.io 当天为准）。vue-router 5 要求 vue ≥ 3.5.34，项目是 3.5.24，所以用 vue-router 4。
- Tauri 原生菜单能否「勾选后不关菜单」、Windows 上能否把「打开 PicNexus」设为加粗默认项；做不到按系统默认行为，并记在 [README](./README.md)。
- macOS / Linux 的 WebKit 对 `backdrop-filter`（图库刻度条毛玻璃）的支持。
