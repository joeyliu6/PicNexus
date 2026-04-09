# 时间线视图快速滚动优化记录

## 问题描述

在时间线视图中，当用户快速滚动时，已加载的图片会突然变成 Skeleton 动画，给用户带来突兀的体验。

## 问题根源

### 根本问题：fast mode 切换 DOM 结构

原实现在 fast mode 和 normal mode 之间切换不同的模板：

```html
<!-- fast mode -->
<template v-if="displayMode === 'fast'">
  <div v-for="item in fastModeItems" ...>
</template>

<!-- normal mode -->
<template v-else>
  <div v-for="visible in visibleItems" ...>
</template>
```

**导致的问题**：
- Vue 销毁旧 DOM 并创建新 DOM
- 即使图片已加载，也会重新创建 img 标签
- 浏览器需要重新渲染图片，导致闪烁

### 次要问题
- `loadedImages` 清理策略过于激进
- 超过 500 张时清空所有非可见图片状态

## 解决方案

### 核心思路
1. **不切换 DOM 结构**：始终使用 visibleItems 渲染
2. **优化 visibleItems 计算**：缓存 itemMap，避免每帧重建
3. **保留速度检测**：只用于控制图片加载行为，不切换模板

### 具体实现

#### 1. itemMap 缓存优化

**问题**：每次滚动都重建 itemMap（O(n) 操作）

```typescript
// 优化前 ❌
const visibleItems = computed(() => {
  const itemMap = new Map();  // 每次都重建！
  for (const group of groups.value) {
    for (const item of group.items) {
      itemMap.set(item.id, item);
    }
  }
  // ...
});

// 优化后 ✅
const itemMap = computed(() => {
  const map = new Map<string, HistoryItem>();
  for (const group of groups.value) {
    for (const item of group.items) {
      map.set(item.id, item);
    }
  }
  return map;
});

const visibleItems = computed(() => {
  const map = itemMap.value;  // 使用缓存
  // ...
});
```

#### 2. 移除 fast mode DOM 切换

删除 `<template v-if="displayMode === 'fast'">` 分支，统一使用 visibleItems 渲染。

#### 3. 延迟销毁策略（2.5 秒）

滚动离开可见区域的图片不立即从 loadedImages 中移除，延迟 2.5 秒再清理：

```typescript
const lastVisibleTime = new Map<string, number>();
const DESTROY_DELAY = 2500;

function cleanupExpiredImages() {
  const now = Date.now();
  const visibleIds = new Set(visibleItems.value.map(v => v.item.id));

  // 更新当前可见图片的时间戳
  for (const id of visibleIds) {
    lastVisibleTime.set(id, now);
  }

  // 清理超时的图片状态
  for (const id of loadedImages.value) {
    const lastTime = lastVisibleTime.get(id);
    if (!visibleIds.has(id) && lastTime && now - lastTime > DESTROY_DELAY) {
      // 从 loadedImages 中移除
    }
  }
}

// 每秒执行一次清理检查
setInterval(cleanupExpiredImages, 1000);
```

#### 4. 图片加载节流

快速滚动时，新图片不触发加载请求，已加载的图片始终显示：

```html
<img
  v-if="thumbCache.getThumbUrl(visible.item) && (isImageLoaded(visible.item.id) || displayMode !== 'fast')"
  :src="thumbCache.getThumbUrl(visible.item)"
  ...
/>
```

#### 5. 图片加载失败重试

最多重试 1 次，延迟 500ms：

```typescript
const imageRetryCount = new Map<string, number>();
const MAX_RETRY = 1;

function onImageError(event: Event, id: string) {
  const img = event.target as HTMLImageElement;
  const currentRetry = imageRetryCount.get(id) || 0;

  if (currentRetry < MAX_RETRY) {
    imageRetryCount.set(id, currentRetry + 1);
    setTimeout(() => {
      img.src = '';
      img.src = originalSrc;
    }, 500);
  } else {
    img.style.display = 'none';
  }
}
```

#### 6. LRU 淘汰策略

loadedImages 超过 500 时，优先移除不在可见区域的图片：

```typescript
if (newSet.size > MAX_LOADED_CACHE) {
  const visibleIds = new Set(visibleItems.value.map(v => v.item.id));
  for (const existingId of newSet) {
    if (!visibleIds.has(existingId) && existingId !== id) {
      newSet.delete(existingId);
      break;
    }
  }
}
```

## 修改文件

1. **useVirtualTimeline.ts**
   - 提取 itemMap 为独立的 computed
   - visibleItems 使用缓存的 itemMap

2. **TimelineView.vue**
   - 删除 fast mode 模板分支
   - 实现延迟销毁策略
   - 添加图片加载节流
   - 添加图片加载失败重试
   - 使用 LRU 淘汰策略

## 参数配置

| 参数 | 值 | 说明 |
|------|-----|------|
| `MAX_LOADED_CACHE` | 500 | loadedImages 缓存上限 |
| `DESTROY_DELAY` | 2500ms | 延迟销毁时间 |
| `MAX_RETRY` | 1 | 图片加载失败最大重试次数 |
| `overscan` | 3 | 可见区域上下预渲染行数 |
| `thumbUrlCache` | 500 | 缩略图 URL 缓存上限 |

## 效果

- ✅ 已加载图片在滚动时保持显示（不再闪烁）
- ✅ 快速滚动到新区域时显示 Skeleton
- ✅ 性能良好（itemMap 缓存优化）
- ✅ 内存可控（LRU 淘汰 + 延迟销毁 + 合理上限）
- ✅ 图片加载失败自动重试
