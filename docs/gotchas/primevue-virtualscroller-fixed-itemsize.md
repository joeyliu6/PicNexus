# PrimeVue VirtualScroller 固定 itemSize 与动态内容高度冲突

## 现象

上传队列启用虚拟滚动后（20+ 项），卡片出现以下问题：
- 图床少（1-4 个）时卡片之间有大片空白
- 图床多（8+ 个）时卡片内容被截断、互相重叠
- 滚动越多偏移越大，底部卡片位置完全错乱

## 陷阱原因

PrimeVue VirtualScroller 的 `itemSize` **只接受固定数字**（不支持函数、不支持动态高度）。它用 `index * itemSize` 精确定位每个 slot。

两个叠加的坑：

1. **写死了 `itemSize=180`，但卡片高度取决于图床数量**。1 行图床 ~140px，3 行 ~250px，180px 只对 2 行左右的情况恰好合适。

2. **用了 `margin-bottom: 12px` 做卡片间距**。VirtualScroller 按 `itemSize` 分配每个 slot 的空间，`margin` 是盒模型之外的间距，不被包含在 slot 高度中。N 个卡片后累积 `N × 12px` 的定位偏差。

## 正确做法

1. **动态计算 itemSize**：根据队列中实际的图床数量算出卡片高度
2. **用 `padding-bottom` 替代 `margin-bottom`**：padding 在盒模型内部，被 `box-sizing: border-box` 包含

## 错误示例

```vue
<!-- UploadQueue.vue -->
<script setup>
const ITEM_HEIGHT = 180; // 写死高度，不管实际内容多高
</script>

<VirtualScroller :items="queueItems" :itemSize="ITEM_HEIGHT">
  <template v-slot:item="{ item }">
    <QueueCard :item="item" class="virtual-card" />
  </template>
</VirtualScroller>

<style scoped>
.virtual-card {
  margin-bottom: 12px; /* margin 不在 itemSize 计算内 */
}
</style>
```

## 正确示例

```vue
<!-- UploadQueue.vue -->
<script setup>
// 基于实际 DOM 结构的高度常量
const CARD_PADDING = 28;    // 14px * 2
const HEADER_SECTION = 62;  // header(50px) + margin-bottom(12px)
const CHANNEL_CARD_H = 44;  // 单个 ChannelCard
const CHANNEL_GAP = 8;      // grid gap
const CARD_GAP = 12;        // 卡片间距
const HEIGHT_BUFFER = 6;    // 浏览器渲染安全余量

// 动态计算：扫描队列找最大图床数 → 算行数 → 算总高
const dynamicItemHeight = computed(() => {
  let maxServices = 0;
  for (const item of queueItems.value) {
    const count = item.enabledServices?.length ?? 0;
    if (count > maxServices) maxServices = count;
  }
  if (maxServices === 0) maxServices = 4;

  const rows = Math.ceil(maxServices / 4);
  const gridHeight = rows * CHANNEL_CARD_H + Math.max(0, rows - 1) * CHANNEL_GAP;
  return CARD_PADDING + HEADER_SECTION + gridHeight + CARD_GAP + HEIGHT_BUFFER;
});
</script>

<VirtualScroller :items="queueItems" :itemSize="dynamicItemHeight">
  <template v-slot:item="{ item }">
    <QueueCard :item="item" class="virtual-card" />
  </template>
</VirtualScroller>

<style scoped>
.virtual-card {
  padding-bottom: 12px;    /* padding 在 box-sizing 内，被 itemSize 包含 */
  box-sizing: border-box;
}
</style>
```

## 关键要点

- `itemSize` 不支持函数或 `autoSize` 动态高度（autoSize 只调整容器尺寸，不处理项目高度）
- 如果内容高度真的随项不同（比如每张卡片图床数不同），需要自定义虚拟滚动实现
- 本项目中同一批上传的图床列表相同，所以取"最大图床数"计算即可覆盖所有卡片
- 间距必须用 `padding`（在盒模型内）而非 `margin`（在盒模型外）
