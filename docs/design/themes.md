# 主题适配与组件样式

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
