# 设计令牌（`--pn-*`）

界面上的颜色、字号、间距、圆角、阴影、层级、动效时长全部写成 `var(--pn-*)`，组件里不写数值。数值的最终依据是设计包：[handoff/tokens/](./redesign/handoff/tokens/) 与 `design-source/project/*.dc.html`。

## 令牌在哪

| 文件 | 放什么 | 怎么改 |
|---|---|---|
| `src/styles/tokens.css` | 设计稿导出的令牌，原样放入：颜色（浅 / 深）、e1–e4 阴影、圆角、间距刻度、四档动效时长与缓动、字体 | 不手改；设计包更新时整份替换 |
| `src/styles/tokens-extra.css` | 设计源文件用到、导出没收录的值：字号 / 字重 / 行高、控件尺寸、各页的具名尺寸与颜色、层级、Logo 动效 | 按页面分段，每段一行注释写出处（画板编号或 `*.dc.html`） |
| `src/styles/pn-base.css` | 全局基础样式：字体文件、`box-sizing`、页面底色与字体、滚动条、焦点环、弹窗遮罩、共用的转圈动画 | 只引用令牌 |
| `src/styles/pn-menu.css` | 菜单、下拉的共用样式（内容传送到 body，组件的 scoped 样式够不到） | 只引用令牌 |

- 主题：根元素 `data-theme="light|dark"`（`ThemeManager` 写，跟随系统或 设置 › 通用）。令牌按 `[data-theme]` 取浅 / 深两套；不随主题变的写在 `:root`。
- 平台：根元素 `data-platform="windows|macos|linux"`，只换中文字体（`--pn-font-cjk`）与浅色侧栏底色。
- 灯箱、压缩预览这类「不随主题、始终深色」的区域，在容器上写 `data-theme="dark"` 取深色令牌。
- 设计稿用到、令牌没收录的值（含不在刻度上的尺寸）：在 `tokens-extra.css` 写成具名令牌（如 `--pn-space-dialog-gap: 14px`），不凑到最近的刻度，也不在组件里写数字。

## 门禁

`npm run lint` 会拦下这些写法：

| 检查 | 拦什么 |
|---|---|
| stylelint `declaration-property-value-allowed-list` / `disallowed-list` | 颜色、字号、z-index、动效时长不是 `var(--…)`；margin / padding / gap / 圆角 / 阴影里写裸数值或裸颜色 |
| `scripts/check-type-scale.mjs` | `--pn-text-*` / `--pn-weight-*` 的值不在刻度上；`font-size` / `font-weight` 不是对应令牌（或借用别的令牌、写在行内 style） |
| `scripts/check-css-undefined-vars.mjs` | `var(--x)` 引用了不存在的令牌（浏览器不报错，那条样式静默作废）；同一选择器下同名令牌定义两次且值不同 |
| `scripts/check-theme-token-copies.mjs` | 首屏手抄的色值与令牌不一致（见「首屏副本」） |

截图测试在每张基准图截图前还会量一遍画出来的样子（`tests/redesign/designRules.ts`）：字号字重、横向滚动、窄窗口侧栏、主按钮个数、弹窗规格、绿点。

## 颜色

| 用途 | 令牌 | 说明 |
|---|---|---|
| 页面底 / 浅灰面板 / 浮层 | `--pn-canvas` / `--pn-surface` / `--pn-elevated` | 面板用浅灰底区分层次，少用描边 |
| 文字三级 | `--pn-text1` / `--pn-text2` / `--pn-text3` | 占位字用 `--pn-text3`、不透明 |
| 描边 | `--pn-border` / `--pn-border-strong` / `--pn-hairline` | 列表只在行间留细线，不套框 |
| 品牌蓝 | `--pn-brand`（花瓣、进度、焦点）/ `--pn-brand-text`（蓝字）/ `--pn-button`（主按钮底）/ `--pn-brand-soft`（选中浅底） | 渐变 `--pn-grad-a → b` 只用于图标、插画、总进度 |
| 琥珀（需要留意） | `--pn-warning` / `-fill` / `-soft` | 失效、登录失效、可能受限 |
| 红（刚才的操作失败了） | `--pn-danger` / `-fill` / `-soft` | 上传失败、写入失败 |
| 绿 | `--pn-success` / `-fill` / `-soft` | 只用于通知的 ✓、「已复制」这类刚完成的反馈；正常状态不画绿点 |
| 未检测 | `--pn-unknown` / `-fill` / `-soft` | |

深色模式层级「越靠上越亮」：侧栏 < 页面 < 卡片 < 菜单；深色下阴影看不见，浮层用 1px 浅描边代替（已含在 e3 / e4 的深色值里）。

## Typography Scale

字号只有六档，外加等宽一档；字重只有三档。行高与字号成对使用。

| 字号令牌 | 行高令牌 | 值 | 用途 |
|---|---|---|---|
| `--pn-text-title` | `--pn-leading-title` | 20 / 26 | 全应用最大：页结论、设置页标题 |
| `--pn-text-dialog-title` | `--pn-leading-dialog-title` | 17 / 24 | 对话框标题 |
| `--pn-text-headline` | `--pn-leading-headline` | 15 / 22 | 页面标题、分组标题 |
| `--pn-text-body` | `--pn-leading-body` | 13 / 20 | 正文基准（页面根字号） |
| `--pn-text-footnote` | `--pn-leading-footnote` | 12 / 16 | 说明、脚注 |
| `--pn-text-caption` | `--pn-leading-caption` | 11 / 14 | 标注、坐标轴 |
| `--pn-text-mono` | `--pn-leading-mono` | 12 / 18 | 链接、路径（`--pn-font-mono`，JetBrains Mono） |

字重：`--pn-weight-regular` 400、`--pn-weight-medium` 500、`--pn-weight-semibold` 600。

刻度外的例外只有设计稿原值、记在 decisions 里的几处，加进 `check-type-scale.mjs` 的 `EXCEPTIONS`：花瓣角标 9px（`--pn-size-petal-badge-text`，[home.md](./redesign/decisions/home.md)）、日历星期 10px（`--pn-size-calendar-weekday-text`，[health.md](./redesign/decisions/health.md)）。图床图标认不出时画的两个字随图标尺寸缩放，是图标不是文字。

字体：`--pn-font-ui`（西文 Inter + 平台中文字体）、`--pn-font-mono`。Inter 与 JetBrains Mono 随应用打包（`src/assets/fonts/`，在 `pn-base.css` 声明）。

## Spacing Scale

刻度：`--pn-space-2 / 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 / 56`。margin、padding、gap 只写这些或 `tokens-extra.css` 里的具名间距（例如 `--pn-space-sidebar-x` 10、`--pn-space-dialog-x` 28）。宽高、`border` 的 1px、`transform` 位移不受这条约束，但宽高按设计稿写成具名尺寸令牌（`--pn-size-*`）。

## Radius Scale

| 令牌 | 值 | 用途 |
|---|---|---|
| `--pn-radius-xs` | 4 | 快捷键、小标签 |
| `--pn-radius-sm` | 6 | 小按钮、菜单项 |
| `--pn-radius-md` | 8 | 按钮、输入框、导航项 |
| `--pn-radius-lg` | 10 | 列表行、缩略图 |
| `--pn-radius-xl` | 14 | 投放区、弹出层、通知 |
| `--pn-radius-dialog` / `--pn-radius-card` | 16 | 对话框、工具卡 |
| `--pn-radius-panel` | 20 | 大面板 |

同心圆角：内圆角 = 外圆角 − 内边距；算出来不在刻度上的写成具名令牌（如 `--pn-radius-button-sm` 7）。

## 阴影与层级

阴影只给浮起来的东西：`--pn-e1` 贴面（缩略图）、`--pn-e2` 卡片（焦点卡，带一点品牌蓝）、`--pn-e3` 浮层（菜单、下拉）、`--pn-e4` 对话（对话框、命令面板）；白色浮起按钮用 `--pn-btn-soft` + `--pn-btn-soft-shadow`。

## Z-index Scale

跨容器比较的层级必须用令牌：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--pn-z-drop-overlay` | 900 | 拖入遮罩 |
| `--pn-z-lightbox` | 950 | 图库灯箱、压缩预览 |
| `--pn-z-popover` | 1000 | 菜单、下拉、弹出层 |
| `--pn-z-dialog` | 1100 | 对话框、命令面板 |
| `--pn-z-toast` | 1200 | 通知（在对话框之上） |
| `--pn-z-tooltip` | 1300 | 气泡 |

同一父容器里的相对堆叠（图片上的角标等）用 0–20 的小整数，stylelint 已放行。

## 动效

### Duration Token

| 令牌 | 值 | 用途 |
|---|---|---|
| `--pn-dur-instant` | 100ms | 悬停（只变颜色、透明度） |
| `--pn-dur-fast` | 150ms | 复制 → 已复制、开关 |
| `--pn-dur-standard` | 200ms | 菜单出现 |
| `--pn-dur-expressive` | 250ms | 对话框、抽屉、灯箱 |
| `--pn-dur-spin` | 900ms | 转圈一周 |
| `--pn-dur-petal-light` / `--pn-dur-bloom` / `--pn-dur-receive` | 300 / 600 / 600ms | 花瓣逐片点亮、完成绽放、拖入感应（[decisions/motion.md](./redesign/decisions/motion.md)） |

缓动：进场 `--pn-ease-in`（`cubic-bezier(.2,0,0,1)`），退场 `--pn-ease-out`（`(.4,0,1,1)`）且快 30%。灯箱开关时长要传给 PhotoSwipe 的 JS 选项，数值写在 `usePhotoSwipeBridge.ts`，对齐这里的令牌。

### 减少动态效果

系统开着「减少动态效果」时：`--pn-dur-fast / standard / expressive` 与三个花瓣时长归零；位移、缩放类的进场改用 `pn-dialog-fade` 这类纯淡入（各组件的 `@media (prefers-reduced-motion: reduce)`）；共用的转圈 `pn-spin` 停住；`--pn-dur-instant` 不归零（只用于悬停变色）。JS 里写死的时长走 `src/utils/reducedMotion.ts` 的 `motionDuration()`。

## 首屏副本（唯一允许抄写色值的地方）

三个文件跑在 Vue 挂载之前，拿不到 `tokens.css`，只能把色值手抄一份：

| 文件 | 抄了什么 |
|---|---|
| `login-webview.html` | `--pn-canvas`、`--pn-text1`（浅 / 深） |
| `login-titlebar.html` | Cookie 登录小窗标题栏用到的颜色与尺寸令牌 |
| `public/preload.css` | 主窗口首屏的底色与文字色（按 `public/preload-theme.js` 先写好的 `data-theme`） |

抄写要同名（沿用真实令牌名），并登记进 `scripts/check-theme-token-copies.mjs` 的 `COPIES`，由 `npm run lint` 逐条比对。只在注释里写「必须一致」拦不住任何东西。

## 引用的令牌必须存在

`var(--x)` 写了一个不存在的名字，浏览器不报错，那条样式静默作废。`check-css-undefined-vars.mjs` 拿 `src/**` 的全部 `var(--…)` 引用与全项目的定义做差集，非空即失败；带 fallback 的写法照样算未定义；`--reka-*` 由 Reka UI 运行时写入，跳过。报错时先在本文件或 `tokens*.css` 找真正存在的名字，多半只是记错了。
