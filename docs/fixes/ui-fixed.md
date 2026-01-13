# UI 问题修复记录

## 1. 表格视图滚动条不显示问题

**问题描述**：上传历史页面的表格视图无法显示滚动条，内容超出时无法滚动查看。

**问题原因**：
- `.history-container` 设置了 `overflow: hidden`，阻止了滚动
- DataTable 的内部滚动被禁用（`overflow: visible !important`），需要外层容器负责滚动

**解决方案**：

参考 commit `6500bc07bd66e1014cf77114dbcf79831eb135da` 的方案：

```css
/* 外层容器 .history-view */
.history-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;  /* 外层不滚动 */
  background: var(--bg-app);
}

/* 内容容器 .history-container 负责滚动 */
.history-container {
  flex: 1;
  overflow-y: auto;   /* 启用垂直滚动 */
  overflow-x: hidden;
  padding: 20px;
  max-width: 850px;
  margin: 0 auto;
  width: 100%;
}

/* 禁用 DataTable 内部滚动，由外层统一处理 */
:deep(.history-table .p-datatable-table-container) {
  overflow: visible !important;
}
```

**关键点**：
1. `.history-view` 设置 `overflow: hidden`，作为 flex 容器
2. `.history-container` 设置 `flex: 1` 和 `overflow-y: auto`，负责滚动
3. DataTable 的 `.p-datatable-table-container` 设置 `overflow: visible`，禁用内部滚动
4. 网格视图的 `.virtual-waterfall-container` 有自己的 `overflow-y: auto`，自行处理滚动

**修复 commit**：`e4abd10` - fix(history): 修复表格视图滚动条不显示的问题

---

## 2. 表格视图骨架屏与真实数据位置偏移问题

**问题描述**：在表格视图中使用骨架屏（Skeleton Loading）时，骨架屏和真实数据的行位置有偏移，且越往下偏移越大（累积误差）。放大窗口时水平位置也会出现偏移。

**问题原因**：

1. **Skeleton 组件的 `display: block` 特性**：PrimeVue 的 Skeleton 组件默认使用 `display: block`，而真实数据中的 Checkbox、Tag 等组件使用 `display: inline-flex`，导致布局行为差异。

2. **骨架屏与真实数据的尺寸不匹配**：
   - 复选框：骨架 `1.5rem` vs 真实 `1.25rem`
   - 文件名：骨架高度 `1rem + 0.75rem` vs 真实 `13px + 11px`
   - 图床标签：骨架 `1.5rem` vs 真实 `22px`

3. **DOM 结构不一致**：预览列的骨架屏是裸露的 Skeleton，而真实数据有额外的 wrapper（`thumb-preview-wrapper` > `thumb-box`）。

4. **表格列宽自动计算**：默认的 `table-layout: auto` 会根据内容自动计算列宽，导致骨架屏和真实数据的列宽分配不同。

**解决方案**：

### 方案 1：强制 Skeleton 使用 inline-block 布局

```css
/* 修复骨架屏累积偏移：强制 Skeleton 使用 inline-block 布局 */
:deep(.minimal-table .p-datatable-tbody .p-skeleton) {
  display: inline-block !important;
  vertical-align: middle;
}
```

### 方案 2：修正骨架屏尺寸与真实组件一致

```vue
<!-- 复选框：1.5rem → 1.25rem -->
<Skeleton width="1.25rem" height="1.25rem" borderRadius="4px" />

<!-- 文件名：匹配 font-size 13px + 11px -->
<Skeleton width="70%" height="13px" />
<Skeleton width="140px" height="11px" class="mt-skeleton" />

<!-- 图床标签：1.5rem → 22px -->
<Skeleton width="50px" height="22px" borderRadius="4px" />
```

### 方案 3：统一 DOM 结构

让骨架屏状态使用与真实数据相同的 wrapper 结构：

```vue
<!-- 骨架屏状态 - 使用与真实数据相同的结构 -->
<div v-if="isSkeleton(slotProps.data)" class="thumb-preview-wrapper">
  <div class="thumb-box">
    <Skeleton width="100%" height="100%" borderRadius="0" />
  </div>
</div>
```

### 方案 4：固定表格列宽

```css
/* 强制固定列宽，确保骨架屏和真实数据的列宽一致 */
:deep(.minimal-table .p-datatable-table) {
  table-layout: fixed;
}
```

**关键点**：
1. 使用「骨架数据」方案而非独立的骨架屏 table，确保在同一个 DataTable 中渲染
2. 固定行高 `height: 52px !important` 和表头高度 `height: 40px !important`
3. 骨架屏和真实数据的 DOM 结构、尺寸、布局方式必须完全一致
4. `table-layout: fixed` 防止窗口大小变化时列宽重新计算

**修复 commit**：
- `d2fb41c` - fix(history): 修复表格视图骨架屏与真实数据行高不一致问题
- `161ded6` - fix(history): 修复放大窗口时骨架屏与真实数据水平位置偏移
