# 界面零件与常见做法

界面零件 = Reka UI（行为与无障碍）+ 自写的 `Pn*` 组件（样子）+ scoped CSS，只引用 `--pn-*` 令牌（[tokens.md](./tokens.md)）。新写界面先在下面两个目录里找现成的，没有再写；尺寸、文案以 `design-source/project/*.dc.html` 为准。

## 零件

**基础控件**（`src/components/pn/`，`Controls.dc.html` / `Patterns.dc.html`）

| 组件 | 用途与规格 |
|---|---|
| `PnButton` | `primary` 主按钮（每页最多一个，每个弹窗最多一个）/ `soft` 白色浮起按钮（次要操作首选）/ `secondary` 白底描边（较早定稿的页面）/ `ghost` 文字按钮 / `danger` 危险按钮（写动作，不写「确定」）。高度 `sm` 28 / `md` 30 / `lg` 32 / `dialog` 34；`loading` 原地写「正在…」 |
| `PnIconButton` | 28×28 纯图标按钮，必须有 `label`（读屏 + 悬停气泡） |
| `PnInput` | 高 32（弹窗里 34），聚焦蓝框 + 3px 浅蓝外环，出错红框；占位字 `--pn-text3` |
| `PnSwitch` / `PnSegmented` / `PnSelect` | 开关 36×20；分段控件（切换「怎么看」，选中块浮起、不用彩色）；下拉选择（选中项左侧蓝勾，右侧可带等宽示例） |
| `PnMenu` / `PnContextMenu` | 下拉菜单 / 右键菜单：项高 32，危险项放最后、红字、前面一条线；样式在 `src/styles/pn-menu.css` |
| `PnPopover` / `PnTooltip` | 弹出层（圆角 14、内距 8、e3）；气泡（深底白字 12px，键盘聚焦也出现） |
| `PnDialog` / `PnConfirmHost` | 对话框、确认框（见下） |
| `PnToaster` | 通知（见 [notification-patterns.md](./notification-patterns.md)） |
| `PnEmpty` / `PnSkeleton` / `PnKbd` / `PnIcon` | 空状态、骨架、快捷键标签（macOS 写 ⌘ ⇧）、线条图标（名字在 `pn/icons.ts`） |

**业务组件**（`src/components/biz/`）：`HostIcon`（所有图床图标都用它：16 列表 / 20 标签 / 24 选择面板 / 32 图床页头部 / 44 登录窗口，认不出的退回名字前两个字）、`PetalGlyph`（一瓣 = 一个图床）、`BrandMark`（Logo）、`BgDecor`（背景装饰，只用于首页与空状态）、`CopyButton`（原地变「✓ 已复制」1.5 秒，不弹通知）、`LinkBlock`、`PreviewFrame`（预览框：图完整显示，空处铺模糊放大版）、`ToolCard` / `ToolCardArt`、`UploadCalendar`、`YearPills`。缩略图统一用 `src/components/common/ThumbnailImage.vue`（按候选链接逐个试，全部失败画「图已不存在」图标）。

## 弹窗

- **对话框一律用 `PnDialog`**：宽 520、圆角 16、内边距 24 / 28、左侧 40px 图标块（普通品牌蓝 / 警告琥珀 / 危险红）、标题 17px + 12px 灰色上下文、按钮高 34（`PnButton size="dialog"`）、垂直水平居中；最高「窗口高 − 56」，超出在弹窗里滚动。宽度不可改（没有 `width` 参数）。
- 打开时焦点落在 `[data-autofocus]`，没有就第一个输入框，再没有就主按钮；Esc 与点遮罩关闭（`blocking` 的不关）。
- **确认框**：`useConfirm()`，画在 `PnConfirmHost`，一次只显示一个、排队。`tone: 'danger'` = 红图标块 + 红确认按钮（不可逆的危险操作），不给按琥珀。能撤销的操作不弹确认（改用撤销通知），见 notification-patterns.md。
- 规格外的三处，各自记在 decisions：新手引导（大弹窗，[onboarding.md](./redesign/decisions/onboarding.md)）、命令面板（同圆角、遮罩、阴影，[home.md](./redesign/decisions/home.md)）、压缩预览（整窗深色查看器，[settings.md](./redesign/decisions/settings.md)）。
- 截图测试会量每个 `.pn-dialog` 的宽、圆角、居中与按钮高（`tests/redesign/designRules.ts`）。

## 传送到 body 的浮层

对话框、菜单、弹出层、气泡的内容由 Reka 传送到 `<body>`，组件的 scoped 样式够不到：

- 浮层根元素加 `pn-layer`（取外壳的字体、字号、颜色与焦点环），样式用不带 `scoped` 的唯一类名写在组件的 `<style>` 里或 `pn-menu.css`。
- `:deep()` 救不了：浮层根节点不带 `data-v` 属性；全局 `.css` 里的 `:deep()` 会被浏览器整条丢弃（`scripts/check-css-deep.mjs` 拦）。
- 菜单、弹出层离窗口边至少 8px。
- 进出场动画共用 `pn-base.css`：`.pn-menu` / `.pn-select-menu` / `.pn-popover` / `.pn-tooltip` 按 `data-state` 淡入（朝 `data-side` 挪 4px）、淡出，组件里不再各写一份；自写的浮层照同一规格补（见 [tokens.md](./tokens.md)「动效」）。

## 悬停、按下与过渡

- 每个可点的元素都要有悬停色和按下色（点了就选中的行、导航项只要悬停色），颜色按长相取 [tokens.md](./tokens.md)「可点元素的悬停与按下」那一对令牌；悬停变色写 `transition: background-color var(--pn-dur-instant) var(--pn-ease-in)`。
- 选中 / 未选、开关这类状态切换渐变 `--pn-dur-fast`；切换页面不放过渡（LoadingRules ①）。
- 列表里的项增删、换顺序：会被频繁重绘的列表（上传中的「最近上传」）让进出的那一项自己伸缩（`max-height` + 透明度），不用 TransitionGroup 的 `-move`；不常重绘、要换顺序的（图床左栏）用 `src/utils/flipReorder.ts`（换序前 `measureFlip`、换完 `playFlip`）。换筛选、切页面这类「换内容」不放动画。

## 空状态与加载

- 空状态用 `PnEmpty`：44px 线条图标 + 15px 标题 + 一句说明 + 可选按钮，居中偏上（下方留 80）。`compact` 版（卡片、小列表里）只有标题和说明；紧凑区域（如设置页「最近操作」）没内容时整组不显示。背景装饰（`BgDecor`）只放在图库无图、链接健康从未检测、引导欢迎页与首页。
- 加载超过 300ms 才出骨架（`PnSkeleton`），骨架按真实版式排（`LoadingRules.dc.html`）；转圈用共用的 `pn-spin`（`pn-base.css`），「减少动态效果」时停住。

## 焦点、键盘与读屏

- 焦点环：品牌蓝 2px 外环，只在键盘操作时出现（`pn-base.css`）；输入框不套这一圈，由自己的框画聚焦样式。
- Tab 顺序：侧栏 → 页面工具栏 → 内容 → 详情面板；`Esc` 关闭一切浮层。
- 所有可点元素是真的 `<button>` / `<a>` / `<input>`；纯图标按钮有 `aria-label`；装饰性 SVG `aria-hidden`；只给读屏看的标题用 1×1 裁切写法。

## 滚动条与布局

- 滚动条：6px 细条、轨道透明，悬停加深（`pn-base.css`，设计稿没画）。
- 最小窗口 800×600，任何页面不横向滚动；宽 < 1000px 侧栏收成 56px 图标栏（截图测试会量）。
- 尺寸都按 `box-sizing: border-box` 算（`pn-base.css` 全局写了）。

## 不像网页

- 界面文字不能选：`pn-base.css` 给 `body` 写了 `user-select: none`（WebKit 只认 `-webkit-` 前缀，两种都写），双击、拖选、Ctrl+A 都不会把按钮和说明刷蓝；组件里不再各写一份。要拿去别处粘贴的内容（链接、路径、命令、模板预览）加 `pn-selectable`；输入框照常能选。
- 右键不弹浏览器菜单（`src/shell/useNativeContextMenu.ts`）：输入框里、选中的字上照常弹，Windows 上菜单再由 Rust 精简到只剩撤销、剪切、复制、粘贴、全选这类编辑项（[window-system-integration.md](../flows/window-system-integration.md)「原生右键菜单」）；要自己的右键菜单用 `PnContextMenu`。
- 图片和链接拖不起来（`pn-base.css` 的 `-webkit-user-drag: none`），不用再写 `draggable="false"`。
- 主窗口不响应 WebView2 的浏览器快捷键（F5 / Ctrl+R 刷新、Ctrl+P 打印、Ctrl+F 查找栏），在 Rust 里关（[window-system-integration.md](../flows/window-system-integration.md)）：这些键浏览器先于网页处理，网页里拦不住；按键照常交给网页，应用要用的键（图库 Ctrl+F）自己接。
- 自写的 `<input>`（搜索框、改名框）写 `spellcheck="false"` 和 `autocomplete="off"`，与 `PnInput` 的默认一致：不画拼写红线、不弹浏览器记住的旧输入。
- 守门测试在 `tests/e2e/desktop-feel.e2e.spec.ts`（Chromium + WebKit）。
