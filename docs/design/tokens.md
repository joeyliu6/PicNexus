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
| 尺寸、间距 | `style.css` 的 `:root` | 不随主题变化的布局值 |
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

## 维护策略

### 核心原则

**规则写到哪里，AI 就遵守到哪里。没写的 = 不存在。**

### 新增变量时的注意事项

1. **中间档位必须存在** — 如果只有 `--space-sm`(8px) 和 `--space-md`(12px)，AI 遇到 10px 只能硬编码。用 t-shirt 扩展命名：`xs-sm`、`sm-md`、`lg-xl` 表达"两档之间"
2. **变量定义完整 ≠ 变量被使用** — 新增变量后，必须同步更新 CLAUDE.md 的 CSS 样式规范，否则 AI 不会主动使用
3. **替换时的例外**：`width/height/min-height`、`box-shadow/transform` 中的 px、`border: 1px`、`clamp()` 内的值不替换
