<script setup lang="ts">
// 冷启动骨架（GalleryScreen.dc.html G12）：超过 300ms 还没读完才出现（由页面控制），
// 按「日期标题 + 等高行」排两组；格子宽度比例照抄设计稿。
import PnSkeleton from '@/components/pn/PnSkeleton.vue';

const GROUPS: readonly { wide: boolean; rows: readonly (readonly number[])[] }[] = [
  { wide: false, rows: [[178, 178, 133, 58, 100], [178, 160, 300]] },
  { wide: true, rows: [[160, 69, 240, 100, 133]] },
];
</script>

<template>
  <div class="skeleton" aria-busy="true" aria-label="正在读取图片">
    <template v-for="(group, g) in GROUPS" :key="g">
      <PnSkeleton
        class="skeleton__heading"
        :class="{ 'skeleton__heading--next': g > 0 }"
        :width="group.wide ? 'var(--pn-size-skeleton-heading-w2)' : 'var(--pn-size-skeleton-heading-w)'"
        height="var(--pn-size-skeleton-heading)"
      />
      <div v-for="(row, r) in group.rows" :key="r" class="skeleton__row">
        <PnSkeleton v-for="(grow, i) in row" :key="i" shape="block" height="100%" :style="{ flex: `${grow} 1 0` }" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.skeleton {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-6);
  min-width: 0;
  padding: var(--pn-space-4) var(--pn-space-skeleton-right) 0 var(--pn-space-24);
}

.skeleton__heading { margin: var(--pn-space-skeleton-first) 0 var(--pn-space-8); }
.skeleton__heading--next { margin-top: var(--pn-space-skeleton-next); }

.skeleton__row {
  display: flex;
  gap: var(--pn-space-6);
  height: var(--pn-size-skeleton-row);
}
</style>
