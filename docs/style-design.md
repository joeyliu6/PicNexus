# PicNexus 样式设计规范

本文档定义了 PicNexus 项目的样式架构和开发规范，确保样式代码的一致性、可维护性和主题适配能力。

## 目录

- [核心设计原则](#核心设计原则)
- [文件结构](#文件结构)
- [CSS 变量体系](#css-变量体系)
- [主题适配规范](#主题适配规范)
- [PrimeVue 组件样式](#primevue-组件样式)
- [常见模式](#常见模式)
- [最佳实践](#最佳实践)

---

## 核心设计原则

### 1. 变量优先，避免硬编码

**所有颜色值必须使用 CSS 变量**，禁止在组件中硬编码颜色。

```css
/* ✅ 正确 */
.card {
  background-color: var(--bg-card);
  color: var(--text-main);
  border: 1px solid var(--border-subtle);
}

/* ❌ 错误 */
.card {
  background-color: #1e293b;
  color: #f8fafc;
  border: 1px solid #334155;
}
```

### 2. 单一职责，分层管理

样式按职责分层，每个文件只负责特定功能：

| 层级 | 文件 | 职责 |
|------|------|------|
| 变量层 | `dark-theme.css`, `light-theme.css` | 定义主题变量，不包含选择器样式 |
| 组件层 | `primevue-overrides.css` | PrimeVue 组件的主题覆盖 |
| 全局层 | `style.css` | 全局基础样式、布局、通用组件 |
| 动画层 | `transitions.css` | 主题切换过渡动画 |

### 3. 一处定义，多处复用

相同的样式模式只在一个地方定义，通过 CSS 变量实现主题适配，避免在多个文件中重复。

---

## 文件结构

```
src/
├── style.css                    # 全局基础样式
└── theme/
    ├── index.ts                 # PrimeVue 预设配置
    ├── ThemeManager.ts          # 主题切换逻辑
    ├── dark-theme.css           # 深色主题变量
    ├── light-theme.css          # 浅色主题变量
    ├── primevue-overrides.css   # PrimeVue 组件覆盖
    └── transitions.css          # 主题过渡动画
```

### 导入顺序（main.ts）

样式文件的导入顺序非常重要，确保正确的层叠优先级：

```typescript
// 1. 第三方样式
import 'primeicons/primeicons.css';

// 2. 主题变量（先加载，供后续样式使用）
import './theme/dark-theme.css';
import './theme/light-theme.css';

// 3. PrimeVue 组件覆盖（依赖主题变量）
import './theme/primevue-overrides.css';

// 4. 过渡动画
import './theme/transitions.css';
```

> **注意**：`style.css` 在 `index.html` 中通过 `<link>` 引入，在 main.ts 之前加载。

---

## CSS 变量体系

### 变量命名规范

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

### 变量定义位置

| 变量类型 | 定义位置 | 说明 |
|---------|---------|------|
| 主题相关变量 | `dark-theme.css` / `light-theme.css` | 颜色、阴影等随主题变化的值 |
| 尺寸、间距 | `style.css` 的 `:root` | 不随主题变化的布局值 |

---

## 主题适配规范

### 深色主题（默认）

```css
:root,
:root.dark-theme {
  --bg-app: #0f172a;
  --text-main: #f8fafc;
  /* ... */
}
```

### 浅色主题

```css
:root.light-theme {
  --bg-app: #f1f5f9;
  --text-main: #0f172a;
  /* ... */
}
```

### 主题特定样式

当某些样式无法仅通过变量实现时，使用主题类选择器：

```css
/* 只有在确实需要时才使用主题选择器 */
:root.dark-theme .special-element {
  /* 深色主题特殊处理 */
}

:root.light-theme .special-element {
  /* 浅色主题特殊处理 */
}
```

---

## PrimeVue 组件样式

### 覆盖原则

1. **使用 CSS 变量**：所有覆盖样式使用 CSS 变量，自动适配主题
2. **集中管理**：所有 PrimeVue 组件覆盖放在 `primevue-overrides.css`
3. **不使用主题选择器**：组件覆盖样式不需要 `:root.dark-theme` 或 `:root.light-theme` 前缀

### 示例

```css
/* primevue-overrides.css */

/* InputText 组件 - 使用变量，自动适配两种主题 */
.p-inputtext {
  color: var(--text-main);
  background-color: var(--bg-input);
  border-color: var(--border-subtle);
}

.p-inputtext:enabled:focus {
  border-color: var(--border-focus);
  box-shadow: var(--focus-ring-shadow);
}

.p-inputtext:disabled {
  color: var(--text-disabled);
  background-color: var(--bg-disabled);
}
```

### 状态颜色

消息和通知组件使用语义化的状态变量：

```css
.p-message.p-message-success {
  background-color: var(--state-success-bg);
  border-color: var(--success);
  color: var(--state-success-text);
}
```

---

## 常见模式

### 滚动条

全局滚动条样式在 `style.css` 中定义，使用 CSS 变量：

```css
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--scrollbar-track, transparent);
}

::-webkit-scrollbar-thumb {
  background-color: var(--scrollbar-thumb);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background-color: var(--scrollbar-thumb-hover);
}
```

组件如需透明 track，只需覆盖 track 样式：

```css
.my-component::-webkit-scrollbar-track {
  background: transparent;
}
```

### 焦点环

使用统一的焦点环变量：

```css
.focusable-element:focus {
  border-color: var(--border-focus);
  box-shadow: var(--focus-ring-shadow);
}
```

### 悬浮效果

```css
.hoverable:hover {
  background-color: var(--hover-overlay);
}

/* 微妙悬浮（用于列表项等） */
.subtle-hover:hover {
  background-color: var(--hover-overlay-subtle);
}
```

---

## 最佳实践

### ✅ 应该做

1. **新增颜色时先检查变量**：查看是否已有合适的变量可用
2. **新增组件样式时使用变量**：确保主题适配
3. **PrimeVue 覆盖集中管理**：添加到 `primevue-overrides.css`
4. **测试两种主题**：修改样式后同时测试深色和浅色主题

### ❌ 不应该做

1. **不要硬编码颜色值**：使用变量代替
2. **不要在组件中重复全局样式**：如滚动条、焦点环
3. **不要在主题文件中写选择器样式**：主题文件只定义变量
4. **不要使用 `!important`**：除非绝对必要

### 添加新变量的流程

1. 确认现有变量无法满足需求
2. 在 `dark-theme.css` 和 `light-theme.css` 中同时添加变量
3. 使用语义化命名（如 `--state-info-bg` 而非 `--blue-bg-015`）
4. 在需要的地方使用新变量
5. 测试两种主题下的效果

---

## 设置页面排版规范

设置页面（`src/components/settings/`）有一套完整的排版体系，所有设置面板必须遵循。

共享样式定义在 `src/styles/settings-shared.css`，各面板通过 `@import` 引入。

### 标题层级

| 层级 | Class | 字号 | 粗细 | 颜色 | 用途 |
|------|-------|------|------|------|------|
| 页面标题 | `.section-header h2` | 24px | 700 | `--text-primary` | 每个设置 Tab 的顶部标题 |
| 区块标签 | `.group-label` | 14px | 600 | `--text-primary` | 功能分区标题（如"外观主题""应用行为"） |
| 行标题 | `.toggle-row-label` | 14px | 500 | `--text-primary` | 设置项名称（如"开机自启动"） |

### 描述文字层级（4 级）

| 层级 | Class | 字号 | 颜色 | Margin | 用途 | 示例 |
|------|-------|------|------|--------|------|------|
| **L1** 页面描述 | `.section-desc` | 14px | `--text-secondary` | 0 | H2 标题下方 | "管理应用外观、启动行为与链接输出。" |
| **L2** 区块说明 | `.helper-text` | 13px | `--text-muted` | -3px 0 12px 0 | group-label 下方 | "在任何应用中通过快捷键直接触发上传…" |
| **L3** 行内描述 | `.toggle-row-desc` 等 | 12px | `--text-muted` | 0 | 设置项下方小字 | "系统启动时自动运行 PicNexus" |
| **L4** 提示卡片 | `.tips-card` | 13px | `--text-secondary` | (卡片 padding) | 信息提示框 | "典型效果：JPEG 80%…" |

> **L3 行内描述**在不同面板中使用不同 class 名（`.toggle-row-desc`、`.config-hint`、`.port-hint`、`.service-section-desc`、`.link-card-desc`），但样式值必须统一为 **12px / --text-muted**。

### 容器规范

| 容器类型 | 圆角 | 背景 | 边框 | 示例 |
|---------|------|------|------|------|
| 设置项分组卡片 | 8px | `--bg-card` | `1px solid --border-subtle` | `.toggle-group`、`.preset-config-box` |
| 小型选择芯片 | 6px | `--bg-card` | `1px solid --border-subtle` | `.preset-chip`、`.format-tab` |
| 大型选择卡片 | 8px | `--bg-card` | `1px solid --border-subtle` | `.theme-card`、`.format-card` |
| 提示信息卡片 | 8px | `--primary-alpha-8` | `1px solid --primary-alpha-15` | `.tips-card` |

### 激活态

| 元素类型 | 背景 | 边框 | 阴影 | 粗细 |
|---------|------|------|------|------|
| 大型选择卡片 | `--primary-alpha-8` | `--primary` | `0 0 0 1px --primary` | 600 |
| 小型选择芯片 | `--primary-alpha-8` | `--primary` | 无 | 600 |
| 下拉菜单项 | `--primary-alpha-10` | 无 | 无 | — |

### 间距规范

| 场景 | 值 |
|------|-----|
| 设置项行 padding | 12px 16px |
| section-header margin-bottom（h2 到 desc） | 8px |
| form-group margin-top | 16px |
| Divider 分隔区块 | PrimeVue `<Divider />` |
| transition 时长 | 0.15s |

### 代码示例

```html
<!-- 标准设置面板结构 -->
<div class="my-settings-panel">
  <!-- L0: 页面标题 -->
  <div class="section-header">
    <h2>面板标题</h2>
    <p class="section-desc">L1: 页面描述文字。</p>
  </div>

  <!-- 区块 -->
  <div class="form-group">
    <label class="group-label">区块标签</label>
    <p class="helper-text">L2: 区块说明文字。</p>

    <div class="toggle-group">
      <div class="toggle-row">
        <div class="toggle-info">
          <span class="toggle-row-label">设置项名称</span>
          <span class="toggle-row-desc">L3: 行内描述文字</span>
        </div>
        <ToggleSwitch ... />
      </div>
    </div>
  </div>

  <Divider />

  <!-- 下一个区块 -->
  <div class="form-group">
    <label class="group-label">另一个区块</label>
    <!-- ... -->
  </div>
</div>
```

---

## 维护记录

| 日期 | 变更内容 |
|------|---------|
| 2025-12-28 | 初始版本：创建样式设计规范，重构主题系统 |
| 2026-03-25 | 新增设置页面排版规范（标题/描述/容器/激活态/间距） |
