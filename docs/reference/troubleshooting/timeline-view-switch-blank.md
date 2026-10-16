# 图库加载与跳转时的占位策略

## 背景

图库网格面对数万张图，采用虚拟滚动 + 等高行布局 + 按天懒加载。不能用"整页骨架 → 所有照片一起出现"的二元模型，因为根本不存在"所有内容就绪"的那一刻。因此占位分三级：

| 层 | 触发场景 | 实现 | 对齐精度 |
|---|---|---|---|
| L1 整页骨架 | 冷启动：按天统计（`dayStats`）还没读完，超过 300ms | `GallerySkeleton.vue`（GalleryScreen.dc.html G12 的两组日期条 + 等高行） | 粗略（不对齐真图） |
| L2 日级占位 | `dayStats` 到了但某天的记录还没读回 | `visibleSkeletonSlots` 灰块（`.grid__slot`，按宽高比定位） | 较精（按布局） |
| L3 图级占位 | 记录到了、缩略图下载中 | 格子灰底（`--pn-skeleton`）+ `<img>` 加载完成才淡入（`.tile__img--loaded`） | **像素级**（就是真图位置） |

原则：**越往下越精准，高层仅在低层无法生效（无数据）时出现，一旦有数据立即让位**。

## 关键实现

### L1：出现条件（[GalleryView.vue](../../../src/views/gallery/GalleryView.vue)）

```ts
const showSkeleton = useDebouncedTrue(computed(() => !grid.hasLoadedStats.value), 300);
```

```html
<GallerySkeleton v-if="showSkeleton && !grid.hasLoadedStats.value" class="gallery__overlay" />
```

- 300ms 内读完就不出现，避免一闪而过（交接说明 6.2「超过 300ms 才出现骨架屏」）。
- 条件里再与一次 `!hasLoadedStats`：防抖的值要等下一轮才落回 false，数据一到骨架必须当场让位，否则会跟 L2 / L3 叠出"对不齐"。

### 跳转（刻度条点击 / 拖动）

跳转不再人为藏图：落点处已缓存的图直接显示，没缓存的天由 L2 / L3 自然接上。跳转逻辑在 [useTimelineJump.ts](../../../src/composables/timeline/useTimelineJump.ts)：

- 跳转中再来的请求只记最后一个，这次落地后接着跳（拖动刻度条时一路经过的月份作废，只去松手时停的那个月）。
- 跳转前暂停视口锚点（`suspendScrollAnchor`）、压住 fast 模式（`forceNormalMode`），落地后恢复——否则 scrollTop 跨数万 px 会被误判成高速滚动，整屏变灰块。

## 以前踩过的坑

- **骨架贴在滚动容器内部**：跳转到 scrollTop = 几万 px 时骨架"留在楼顶"，视口看不到。L1 只在冷启动出现，跳转不用它。
- **骨架强制最小显示时长**：数据到了还压着不让走 → 跟真实布局叠出错位。L1 用「300ms 后才出现」而不是「出现后至少停留」。
- **骨架块和真图对不齐**：通用骨架没对应具体照片，必然错位。L1 只在"还没有真图数据"时出现，错位问题就不存在。
- **跳转中来的请求直接丢弃**：拖动刻度条时，松手那个月若赶上上一次还没落地，画面会停在中途的月份。只留最后一个请求、落地后接着跳。

## 相关文件

- [src/views/gallery/GalleryView.vue](../../../src/views/gallery/GalleryView.vue) — L1 出现条件
- [src/views/gallery/GallerySkeleton.vue](../../../src/views/gallery/GallerySkeleton.vue) — L1 骨架版式
- [src/views/gallery/GalleryGrid.vue](../../../src/views/gallery/GalleryGrid.vue) — L2 `.grid__slot`
- [src/views/gallery/GalleryTile.vue](../../../src/views/gallery/GalleryTile.vue) — L3 灰底 / img 淡入
- [src/composables/timeline/useTimelineJump.ts](../../../src/composables/timeline/useTimelineJump.ts) — 跳转与「只跳最后一个」
