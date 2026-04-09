# 时间线视图切换时短暂空白问题

## 问题描述

从其他页面（如上传、设置）切换回时间线视图时，会出现短暂的空白界面，然后图片才显示出来。第一次加载时有骨架屏过渡，体验良好，但后续切换时因为数据已缓存，`isLoading` 为 false，直接跳过骨架屏导致空白。

## 问题根源

1. **KeepAlive 缓存机制**：组件被缓存后，切换回来时不会重新触发 `onMounted`，而是触发 `onActivated`
2. **数据已缓存**：`isLoading` 状态为 false，骨架屏条件 `v-if="isLoading"` 不满足
3. **渲染延迟**：虽然数据在内存中，但 DOM 渲染和图片显示需要时间，这段时间就是空白

## 解决方案

### 核心思路

添加独立的 `showSkeleton` 状态，在视图切换时主动显示骨架屏，等待布局计算完成后延迟隐藏。

### 实现细节

#### 1. 双触发机制

处理两种切换场景：

```typescript
// 场景1：内部视图切换（表格 ↔ 时间线）
watch(
  () => props.visible,
  (isVisible, wasVisible) => {
    if (isVisible && !wasVisible) {
      showSkeletonWithCheck();
    }
  }
);

// 场景2：KeepAlive 激活（从上传/设置页面切换回来）
watch(
  () => props.activationTrigger,
  (_, oldVal) => {
    if (props.visible && oldVal !== undefined) {
      showSkeletonWithCheck();
    }
  }
);
```

#### 2. 最小显示时间

避免骨架屏一闪而过：

```typescript
const SKELETON_MIN_DISPLAY_MS = 300;

function hideSkeleton() {
  if (skeletonMinDisplayTimeout) {
    clearTimeout(skeletonMinDisplayTimeout);
  }
  if (!showSkeleton.value) return;
  skeletonMinDisplayTimeout = window.setTimeout(() => {
    showSkeleton.value = false;
  }, SKELETON_MIN_DISPLAY_MS);
}
```

#### 3. v-show 替代 v-if

保持组件在 DOM 中，避免重复创建销毁：

```vue
<TimelineView
  v-show="currentViewMode === 'timeline'"
  :visible="currentViewMode === 'timeline'"
  :activation-trigger="activationTrigger"
/>
```

### 关键点

- `visible` prop：传递当前视图是否可见
- `activationTrigger` prop：父组件在 `onActivated` 时递增，通知子组件
- `oldVal !== undefined`：跳过首次挂载时的触发
- 300ms 最小显示时间：避免骨架屏闪烁

## 修改文件

- `src/components/views/HistoryView.vue` - 添加 activationTrigger 机制
- `src/components/views/TimelineView.vue` - 骨架屏显示逻辑

## 效果

- 从任何页面切换到时间线视图时，显示 300ms 骨架屏过渡
- 骨架屏平滑过渡到图片内容，无空白闪烁
- 与首次加载体验一致
