# CSS 变量体系

## 变量命名规范

采用 `--{category}-{element}-{state}` 的命名模式：

```css
/* 背景色 */
--bg-app          /* 应用主背景 */
--bg-card         /* 卡片背景 */
--bg-input        /* 输入框背景 */
--bg-disabled     /* 禁用状态背景 */

/* 文本色 */
--text-main       /* 主文本 */
--text-muted      /* 次要文本 */
--text-disabled   /* 禁用文本 */

/* 边框色 */
--border-subtle   /* 普通边框 */
--border-focus    /* 焦点边框 */

/* 状态色 */
--primary         /* 主品牌色 */
--success         /* 成功 */
--warning         /* 警告 */
--error           /* 错误 */

/* 状态背景（带透明度） */
--state-info-bg
--state-success-bg
--state-warn-bg
--state-error-bg

/* 状态文字 */
--state-info-text
--state-success-text
--state-warn-text
--state-error-text

/* 交互状态 */
--hover-overlay         /* 悬浮叠加 */
--hover-overlay-subtle  /* 微妙悬浮 */
--focus-ring-shadow     /* 焦点环 */
--selected-bg           /* 选中背景 */

/* 滚动条 */
--scrollbar-thumb
--scrollbar-thumb-hover
--scrollbar-track
```

## 变量定义位置

| 变量类型 | 定义位置 | 说明 |
|---------|---------|------|
| 主题相关变量 | `dark-theme.css` / `light-theme.css` | 颜色、阴影等随主题变化的值 |
| 尺寸、间距 | `styles/app.css` 的 `:root` | 不随主题变化的布局值 |
| 动效变量 | `styles/motion.css` | duration、easing、transform 预设 |

---

## 动效变量体系

所有动效参数通过 `styles/motion.css` 集中管理，禁止硬编码 transition/animation 时长和缓动函数。

### Duration Token

| 变量 | 值 | 适用场景 |
|------|-----|---------|
| `--duration-micro` | 100ms | 极速反馈：按钮按下、背景闪变 |
| `--duration-fast` | 120ms | 微交互：hover、focus、图标切换 |
| `--duration-normal` | 200ms | 标准过渡：淡入淡出、颜色变化 |
| `--duration-medium` | 300ms | 折叠面板、中等交互 |
| `--duration-slow` | 350ms | 面板滑入、遮罩、页面切换 |
| `--duration-slower` | 500ms | 进度条、复杂编排 |
| `--duration-spinner` | 800ms | spinner 旋转周期 |
| `--duration-shimmer` | 1500ms | 骨架屏微光周期 |
| `--duration-breathe` | 2000ms | 呼吸脉冲周期 |

### Easing Token

| 变量 | 适用场景 |
|------|---------|
| `--ease-standard` | 大多数过渡（Material 标准） |
| `--ease-decelerate` | 元素进入（快启慢停） |
| `--ease-accelerate` | 元素退出（慢启快走） |
| `--ease-overshoot` | 弹出效果（对话框、toast） |
| `--ease-spring` | 弹性效果（收藏、星形弹出） |

### 共享 @keyframes（k- 前缀）

新增组件需要动画时，优先使用已有的 `k-*` keyframes：

| keyframes | 效果 | 典型用法 |
|-----------|------|---------|
| `k-fade-in` | 纯透明度淡入 | 模态框、预览 |
| `k-fade-slide-up` | 淡入+上滑 | 设置区块、列表项入场 |
| `k-fade-slide-down` | 淡入+下滑 | 扫描结果、提示 |
| `k-fade-slide-left` | 淡入+左滑 | 状态消息 |
| `k-fade-scale` | 淡入+缩放+上滑 | 药丸/badge 入场 |
| `k-spin` | 旋转 | 加载 spinner |
| `k-shimmer` | 骨架屏微光 | 图片占位符 |
| `k-pulse` | 透明度脉冲 | 加载中/呼吸状态 |
| `k-sweep` | 水平扫光 | 进度条发光 |
| `k-bounce` | 弹跳缩放 | 完成确认 |
| `k-pop` | 多段弹跳 | 收藏星形 |

### Vue Transition class（t- 前缀）

| 名称 | 效果 |
|------|------|
| `t-fade` | 通用淡入淡出 |
| `t-slide-up` | 从下方浮入 |
| `t-dropdown` | 下拉菜单展开 |
| `t-scale-fade` | 对话框弹出 |
| `t-fade-slide` | 通用淡入+位移 |
| `t-collapse` | 折叠面板展开/收起 |

### 用法示例

```css
/* ✅ 正确：使用 Token */
transition: all var(--duration-normal) var(--ease-standard);
animation: k-fade-slide-up var(--duration-medium) var(--ease-decelerate) both;

/* ❌ 错误：硬编码 */
transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
```

### 无障碍

`motion.css` 内置 `prefers-reduced-motion` 支持，所有 duration 变量自动归零。新增组件无需额外处理。

---

## Typography Scale

字号统一走变量体系，**禁止 `font-size` 硬编码**。所有档位定义在 [src/styles/app.css](../../src/styles/app.css) 的 `:root` 里。

| 变量 | 值 | 与上级比率 | 适用场景 |
|------|-----|----------|---------|
| `--text-2xs` | 10px | — | 角标、极小标注 |
| `--text-xs` | 12px | 1.20 | 辅助文字、L3 行内描述（`.toggle-row-desc`） |
| `--text-sm` | 13px | 1.08 | 次要内容、L2 区块说明（`.helper-text`）、L4 提示卡片 |
| `--text-base` | 14px | 1.08 | 正文默认、L1 页面描述、标题行（`.toggle-row-label`） |
| `--text-lg` | 16px | 1.14 | 分组标题（`.group-label`）、强调正文 |
| `--text-lg-xl` | 18px | 1.125 | 对话框标题 |
| `--text-xl` | 20px | 1.11 | 页面标题 |
| `--text-2xl` | 24px | 1.20 | 大标题、设置页 `.section-header h2` |
| `--text-3xl` | 28px | 1.17 | 特大标题 |
| `--text-4xl` | 36px | 1.29 | 空状态插画、大号数字展示 |
| `--text-5xl` | 48px | 1.33 | 超大空状态、引导页主标题 |

> **已废弃**：`--text-2xs-xs`(11px) 已合并至 `--text-xs`；`--text-md`(15px) 已合并至 `--text-lg`。

### 字重

| 变量 | 值 | 场景 |
|------|-----|------|
| `--weight-regular` | 400 | 正文、默认文本 |
| `--weight-medium` | 500 | 按钮、导航标签、活跃选项卡 |
| `--weight-semibold` | 600 | 分组标题、区块标题、重要数据 |
| `--weight-bold` | 600 | 页面大标题、核心焦点数据 |

### 行高

| 变量 | 值 | 场景 |
|------|-----|------|
| `--leading-tight` | 1.3 | 标题、按钮（CJK 优化，原 1.2 偏紧） |
| `--leading-normal` | 1.6 | 正文默认（CJK 推荐 1.6-1.7） |
| `--leading-relaxed` | 1.75 | 段落长文、多行描述 |

### 何时破例

- `line-height`、`letter-spacing` **不在本规则范围**，可直接写具体值
- `box-shadow`、`transform` 内嵌的 px 数字不算 `font-size`，允许硬编码
- `clamp()` / `calc()` 内部的字号值允许硬编码，外层用变量

---

## Spacing Scale

间距统一走变量，使用 4px 网格系统。**禁止 `margin` / `padding` / `gap` 直接写像素值**。

| 变量 | 值 | 典型用途 |
|------|-----|---------|
| `--space-2xs` | 2px | 极微小间距（图标与文字） |
| `--space-xs` | 4px | 小芯片内边距 |
| `--space-xs-sm` | 6px | xs 与 sm 之间过渡 |
| `--space-sm` | 8px | 基础内边距、小卡片 |
| `--space-sm-md` | 10px | sm 与 md 之间过渡 |
| `--space-md` | 12px | 卡片内边距、默认 gap |
| `--space-md-lg` | 14px | md 与 lg 之间过渡 |
| `--space-lg` | 16px | 区块内边距 |
| `--space-lg-xl` | 20px | lg 与 xl 之间过渡 |
| `--space-xl` | 24px | 大卡片、区块间距 |
| `--space-2xl` | 32px | 大区块间距 |
| `--space-3xl` | 40px | 页面级间距 |
| `--space-4xl` | 48px | 超大区块 |
| `--space-5xl` | 60px | 空状态留白 |

### 何时破例

- `width` / `height` / `min-*` / `max-*` **不受此规则约束**，可直接写像素值
- `border: 1px solid` 的 1px 允许硬编码
- `transform: translateX(10px)` 允许硬编码
- 绝对定位 `top` / `left` / `right` / `bottom` 的微调值允许硬编码（但建议尽量用变量）

---

## Radius Scale

圆角统一走变量，**禁止 `border-radius` 硬编码**。

| 变量 | 值 | 场景 |
|------|-----|------|
| `--radius-xs` | 2px | 极小元素 |
| `--radius-xs-sm` | 3px | 小芯片 |
| `--radius-sm` | 4px | 输入框、小按钮 |
| `--radius-sm-md` | 6px | 标签、pill、小型芯片 |
| `--radius-md` | 8px | 卡片、面板（容器默认） |
| `--radius-lg` | 12px | 大卡片 |
| `--radius-xl` | 16px | 对话框 |
| `--radius-2xl` | 20px | 大对话框 |
| `--radius-3xl` | 24px | 超大卡片 |
| `--radius-full` | 9999px | 圆形头像、胶囊按钮 |

**约定**：设置页容器圆角统一 `--radius-md`（8px），小型芯片统一 `--radius-sm-md`（6px），详见 [settings-layout.md](settings-layout.md)。

---

## Z-index Scale

Z-index 分两类管理：**全局层级必须用变量**；**同一堆叠上下文内的相对整数**（≤ 20）作为 stylelint 例外，可直接硬编码。

### 全局层级（必须用变量）

| 变量 | 值 | 用途 |
|------|-----|------|
| `--z-base` | 1 | 基础层 |
| `--z-dropdown` | 100 | 下拉菜单、select |
| `--z-sticky` | 200 | 吸顶导航、粘性表头 |
| `--z-overlay` | 1000 | 半透明遮罩 |
| `--z-modal` | 1100 | 对话框、弹窗 |
| `--z-toast` | 10000 | Toast 通知（需压过灯箱 9999） |
| `--z-tooltip` | 1300 | Tooltip |
| `--z-lightbox` | 9999 | 图片灯箱 |
| `--z-titlebar` | 10001 | 自定义窗口标题栏（最高） |

### 局部堆叠（允许硬编码）

当元素处于**同一个父级堆叠上下文**内（比如 card 里 `image` 和 `badge` 的相对排序），使用 `0 | 1 | 2 | 3 | 5 | 10 | 20` 这样的小整数是合理的——用变量反而过度抽象。stylelint 已放行 ≤ 20 的整数值。

**判断原则**：如果这个 `z-index` 影响范围**仅限当前父容器**，用小整数；如果它要**跨容器比较**（比如 dropdown 要压过 sidebar），必须用变量。

---

## 维护策略

### 核心原则

**规则写到哪里，AI 就遵守到哪里。没写的 = 不存在。**

### 新增变量时的注意事项

1. **中间档位必须存在** — 如果只有 `--space-sm`(8px) 和 `--space-md`(12px)，AI 遇到 10px 只能硬编码。用 t-shirt 扩展命名：`xs-sm`、`sm-md`、`lg-xl` 表达"两档之间"
2. **变量定义完整 ≠ 变量被使用** — 新增变量后，必须同步更新 CLAUDE.md 的 CSS 样式规范，否则 AI 不会主动使用
3. **替换时的例外**：`width/height/min-height`、`box-shadow/transform` 中的 px、`border: 1px`、`clamp()` 内的值不替换
