# UI 模式与最佳实践

## 空状态设计规范

项目中的空状态分为 4 种类型，每种类型有明确的使用场景和样式规范。

### 1. 标准空状态（Standard Empty State）

**使用场景**：列表、表格、网格等主要内容区域的空状态

**组件**：`EmptyState.vue`

**样式规范**：
- 图标大小：48px（`--text-4xl`）
- 图标颜色：`--text-disabled`，透明度 0.5
- 标题字号：16px（`--text-lg`），字重 500
- 标题颜色：`--text-secondary`
- 描述字号：13px（`--text-sm`）
- 描述颜色：`--text-muted`
- 垂直间距：`--space-md`（12px）
- 容器内边距：`--space-2xl`（32px）

**图标选择指南**：
- 通用无数据：`pi-inbox`
- 搜索/筛选无结果：`pi-search`
- 收藏为空：`pi-star`
- 历史记录为空：`pi-clock`
- 配置缺失：`pi-cog`
- 错误状态：`pi-exclamation-triangle`

**用法示例**：

```vue
<EmptyState
  icon="pi pi-star"
  title="暂无收藏"
  description="点击图片右上角的 ★ 开始收藏"
/>

<EmptyState
  icon="pi pi-search"
  title="未找到结果"
  description="尝试调整搜索关键词或筛选条件"
>
  <button @click="reset">重置筛选</button>
</EmptyState>
```

### 2. Hero 空状态（Hero Empty State）

**使用场景**：首次使用引导、需要强调行动号召的空状态

**组件**：`HeroEmptyState.vue`

**样式规范**：
- 图标容器：56px × 56px，圆角 `--radius-xl`（16px）
- 图标容器背景：`--primary-alpha-10`
- 图标大小：24px（`--text-2xl`）
- 图标颜色：`--primary`
- 标题字号：18px（`--text-lg-xl`），字重 700
- 标题颜色：`--text-main`
- 描述字号：13px（`--text-sm`）
- 描述颜色：`--text-muted`
- 垂直间距：`--space-sm-md`（10px）
- 元信息字号：12px（`--text-xs`），颜色 `--text-tertiary`

**用法示例**：

```vue
<HeroEmptyState
  icon="pi pi-shield"
  title="检查你的图片链接"
  description="扫描全部上传历史，发现失效和异常链接"
  metaText="共 1,234 个链接待检测"
>
  <button class="hero-cta" @click="handleStart">
    <i class="pi pi-play"></i> 开始全面检测
  </button>
</HeroEmptyState>
```

### 3. 内联空状态（Inline Empty State）

**使用场景**：侧边栏、小型列表、日志面板等紧凑区域

**组件**：`InlineEmptyState.vue`

**样式规范**：
- 图标大小：36px（`--text-4xl`）
- 图标颜色：`--text-disabled`，透明度 0.5
- 标题字号：13px（`--text-sm`），字重 500
- 标题颜色：`--text-secondary`
- 提示字号：12px（`--text-xs`）
- 提示颜色：`--text-tertiary`
- 垂直间距：`--space-sm`（8px）
- 容器内边距：`--space-lg`（16px）

**用法示例**：

```vue
<InlineEmptyState
  icon="pi pi-inbox"
  title="暂无记录"
/>

<InlineEmptyState
  icon="pi pi-inbox"
  title="暂无可迁移的图片"
  hint="历史记录中没有符合条件的图片"
/>
```

### 4. 交互空状态（Interactive Empty State）

**使用场景**：拖放区域、文件选择等需要用户交互的空状态

**实现方式**：自定义组件（如 `RescueIdleZone.vue`）

**样式规范**：
- 图标大小：36px（`--text-4xl`）
- 图标颜色：`--primary`
- 边框：2px dashed `--border-subtle`
- 边框圆角：`--radius-md`（8px）
- 悬停边框：`--primary-alpha-40`
- 拖拽时边框：`--primary`（实线）
- 拖拽时背景：`--primary-alpha-5`
- 主文字字号：16px（`--text-lg`），字重 600
- 主文字颜色：`--text-secondary`
- 描述字号：13px（`--text-sm`）
- 描述颜色：`--text-muted`
- 容器内边距：`--space-3xl`（40px）

**特点**：
- 虚线边框提示可拖放
- 悬停和拖拽时有视觉反馈
- 包含明确的交互指引

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
