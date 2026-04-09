# UI 模式与最佳实践

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
