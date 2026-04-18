# 时间线视图切换/跳转时的骨架屏策略

## 背景

PicNexus 时间轴有 33K+ 照片，采用虚拟滚动 + Justified Layout + 懒加载。不能用"传统骨架屏 → 所有照片一起出现"的二元模型，因为根本不存在"所有内容就绪"的那一刻。因此采用**三级骨架降级**：

| 层 | 触发场景 | 实现 | 对齐精度 |
|---|---|---|---|
| L1 整页 overlay | 冷启动、`dayStats` 查询中且 `groups` 为空 | `TimelineSkeleton.vue`（viewport 尺寸的通用骨架） | 粗略（不对齐真图） |
| L2 日级占位 | `dayStats` 到了但某天元数据未到 | `visibleSkeletonSlots` 灰块（按 aspectRatios 定位） | 较精（按布局） |
| L3 图级占位 | 元数据到了、真图下载中 / 跳转期间已缓存图 | `.photo-item` 灰底 + `<img>` opacity 过渡 / `.is-jumping` + shimmer | **像素级**（就是真图位置） |

原则：**越往下越精准，高层仅在低层无法生效（无数据）时出现，一旦有数据立即降级让位**。

## 关键实现

### L1：[TimelineView.vue](../../../src/components/views/TimelineView.vue) overlay 出现条件

```html
<TimelineSkeleton v-show="isLoadingStats && groups.length === 0" ... />
```

`isLoadingStats` 单独不够（数据到了但 `groups` 还没刷新的瞬间 overlay 还在，会跟 L3 叠出"对不齐"）；`groups.length === 0` 兜住这个边界——有了数据就立刻让位给 L3。

### L3（跳转）：`.is-jumping` 类驱动

点击时间轴指示器跳到已缓存月时，图片已解码好，下一帧就绘出 → 闪眼。解法是人为制造"图片未加载态"：

```ts
// useTimelineDragAndSkeleton.ts
const isJumping = ref(false);
const SKELETON_MIN_DISPLAY_MS = 400;  // 至少 400ms 缓冲窗口

async function handleJumpToPeriod(year, month) {
  const start = Date.now();
  isJumping.value = true;  // → .timeline-view.is-jumping
  try {
    // 做跳转工作
  } finally {
    const remaining = SKELETON_MIN_DISPLAY_MS - (Date.now() - start);
    if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
    isJumping.value = false;
  }
}
```

```css
/* TimelineView.vue */
.timeline-view.is-jumping :deep(.photo-img.loaded) { opacity: 0; }
.timeline-view.is-jumping :deep(.photo-item) {
  background-image: linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-titlebar) 50%, var(--bg-secondary) 100%);
  background-size: 200% 100%;
  animation: timeline-skeleton-shimmer 1.5s linear infinite;
}
```

效果：已加载的 `<img>` 变透明 → 露出 photo-item 灰底 + shimmer 动画 → 天然按真图位置对齐。

## 以前踩过的坑

- **overlay 贴在 scroll 容器内部**：跳转到 scrollTop=几万 px 时 overlay 内容"留在楼顶"，视口看不到。后放弃 overlay 参与跳转，改走 L3 `.is-jumping`。
- **overlay 强制 300ms 最小显示**：数据到了还压着 overlay 不让走 → 跟真实布局叠出错位。解法：v-show 条件收窄到 `groups.length === 0`。
- **overlay 骨架块和真图对不齐**：generic skeleton 用通用 aspectRatios，根本没对应具体照片 → 必然错位。L1 只在"还没有真图数据"时出现，错位问题就不存在。

## 相关文件

- [src/components/views/TimelineView.vue](../../../src/components/views/TimelineView.vue) — overlay v-show 条件、`.is-jumping` CSS、shimmer keyframe
- [src/composables/timeline/useTimelineDragAndSkeleton.ts](../../../src/composables/timeline/useTimelineDragAndSkeleton.ts) — `isJumping` ref、跳转 min-display 计时
- [src/components/views/timeline/TimelinePhotoItem.vue](../../../src/components/views/timeline/TimelinePhotoItem.vue) — L3 photo-item 灰底 / img opacity 过渡
- [src/components/views/timeline/TimelineSkeleton.vue](../../../src/components/views/timeline/TimelineSkeleton.vue) — L1 通用骨架（generic）
