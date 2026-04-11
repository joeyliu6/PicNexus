# PicNexus 设计规范

本目录定义了 PicNexus 项目的样式架构和开发规范，确保样式代码的一致性、可维护性和主题适配能力。

## 文档索引

| 文档 | 内容 |
|------|------|
| [CSS 变量体系](./tokens.md) | 变量命名、颜色/间距/动效 Token |
| [主题与组件](./themes.md) | 深色/浅色主题适配、PrimeVue 组件覆盖 |
| [UI 模式与实践](./ui-patterns.md) | 常见 UI 模式、最佳实践、新增变量流程 |
| [设置页面排版](./settings-layout.md) | 设置面板标题/描述/容器/激活态/间距体系 |

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

## 相关文档

- [动效 Token 集中管理](../reference/patterns/motion-token-system.md) — duration / easing / keyframes 模式详解
- [系统总览流程图](../flows/system-overview.md) — 项目宏观架构，定位样式在哪一层

---

## 维护记录

| 日期 | 变更内容 |
|------|---------|
| 2025-12-28 | 初始版本：创建样式设计规范，重构主题系统 |
| 2026-03-25 | 新增设置页面排版规范（标题/描述/容器/激活态/间距） |
| 2026-04-09 | 拆分为多文件结构 |
