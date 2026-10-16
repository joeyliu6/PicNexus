<script setup lang="ts">
// 花瓣标 PetalGlyph（PetalScale.dc.html）：一瓣 = 一个图床。已完成亮蓝、上传中半透明、排队灰、失败红、可能受限琥珀。
// 几个图床传完亮几片；哪片变红就是哪个图床出了问题。最小 12px。
import { computed } from 'vue';
import { layoutPetals, type PetalState } from '@/utils/petals';

const props = withDefaults(defineProps<{
  states: readonly PetalState[];
  size?: number;
  /** 读屏文字（如「3 个图床：京东、R2 已完成，微博上传失败」）；不给则视为装饰 */
  label?: string;
  /** 盖在图片上（图库格子）：亮的白色、未亮的 30% 白 */
  onImage?: boolean;
}>(), { size: 16, label: undefined, onImage: false });

const layout = computed(() => layoutPetals(props.states));
</script>

<template>
  <span class="petals" :class="{ 'petals--on-image': onImage }" :style="{ width: `${size}px`, height: `${size}px` }" :role="label ? 'img' : undefined" :aria-label="label">
    <svg :width="size" :height="size" viewBox="-4 -4 136 136" aria-hidden="true" focusable="false">
      <path
        v-for="(petal, i) in layout.petals"
        :key="i"
        :d="petal.d"
        :transform="petal.transform"
        class="petals__petal"
        :class="`petals__petal--${petal.state}`"
      />
    </svg>
    <span v-if="layout.overflowCount" class="petals__count" aria-hidden="true">
      {{ layout.overflowCount }}
    </span>
  </span>
</template>

<style scoped>
.petals {
  position: relative;
  display: inline-flex;
  flex: none;
}

.petals__petal--ok { fill: var(--pn-brand); }
.petals__petal--uploading { fill: var(--pn-brand); fill-opacity: var(--pn-opacity-petal-uploading); }
.petals__petal--waiting { fill: var(--pn-petal-wait); }
.petals__petal--failed { fill: var(--pn-danger-fill); }
.petals__petal--limited { fill: var(--pn-warning-fill); }
.petals__petal--empty { fill: var(--pn-petal-empty); }
.petals--on-image .petals__petal--ok { fill: var(--pn-media-fg); }
.petals--on-image .petals__petal--empty { fill: var(--pn-media-fg-dim); }

.petals__count {
  position: absolute;
  right: var(--pn-petal-badge-offset-x);
  bottom: var(--pn-petal-badge-offset-y);
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: var(--pn-size-petal-badge);
  height: var(--pn-size-petal-badge);
  box-sizing: border-box;
  padding: 0 var(--pn-space-petal-badge-x);
  border-radius: var(--pn-size-petal-badge);
  background: var(--pn-text1);
  box-shadow: 0 0 0 var(--pn-ring-offset) var(--pn-canvas);
  color: var(--pn-canvas);
  font-size: var(--pn-size-petal-badge-text);
  font-weight: var(--pn-weight-semibold);
  line-height: 1;
}
</style>
