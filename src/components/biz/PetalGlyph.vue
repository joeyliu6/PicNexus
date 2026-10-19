<script setup lang="ts">
// 花瓣标 PetalGlyph（PetalScale.dc.html）：一瓣 = 一个图床。已完成亮蓝、上传中半透明、排队灰、失败红、可能受限琥珀。
// 几个图床传完亮几片；哪片变红就是哪个图床出了问题。最小 12px。动效规则见 decisions/motion.md。
import { computed, nextTick, ref, watch } from 'vue';
import { layoutPetals, type PetalState } from '@/utils/petals';
import { shouldBloom } from '@/utils/petalMotion';

const props = withDefaults(defineProps<{
  states: readonly PetalState[];
  size?: number;
  /** 读屏文字（如「3 个图床：京东、R2 已完成，微博上传失败」）；不给则视为装饰 */
  label?: string;
  /** 盖在图片上（图库格子）：亮的白色、未亮的 30% 白 */
  onImage?: boolean;
  /** ⑥ 完成绽放：每次复制成功时新建的那份结果；换成新的非空值时绽放一次（规则见 utils/petalMotion） */
  bloomKey?: unknown;
}>(), { size: 16, label: undefined, onImage: false, bloomKey: undefined });

const layout = computed(() => layoutPetals(props.states));

const svg = ref<SVGSVGElement>();
const blooming = ref(false);
watch(() => props.bloomKey, async (next, previous) => {
  // 不在页面上（首页在 KeepAlive 里、人在别的页面）时不播：挂上的动画会等回到首页才开始，成了补播
  if (!shouldBloom(previous, next) || !svg.value?.isConnected) return;
  // 上一次还没播完时从头再播：先摘掉、让浏览器排一次版，再挂上
  blooming.value = false;
  await nextTick();
  svg.value?.getBoundingClientRect();
  blooming.value = true;
});
</script>

<template>
  <span class="petals" :class="{ 'petals--on-image': onImage, 'petals--bloom': blooming }" :style="{ width: `${size}px`, height: `${size}px` }" :role="label ? 'img' : undefined" :aria-label="label">
    <span v-if="blooming" class="petals__ripple" aria-hidden="true" />
    <svg ref="svg" :width="size" :height="size" viewBox="-4 -4 136 136" aria-hidden="true" focusable="false" @animationend.self="blooming = false">
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

/* ③ 逐片点亮（M03）：图床传完、失败时这片渐变到新颜色；只在状态真的变了才播，打开页面时不播 */
.petals__petal {
  transition:
    fill var(--pn-dur-petal-light) var(--pn-ease-in),
    fill-opacity var(--pn-dur-petal-light) var(--pn-ease-in);
}

.petals__petal--ok { fill: var(--pn-brand); }
.petals__petal--uploading { fill: var(--pn-brand); fill-opacity: var(--pn-opacity-petal-uploading); }
.petals__petal--waiting { fill: var(--pn-petal-wait); }
.petals__petal--failed { fill: var(--pn-danger-fill); }
.petals__petal--limited { fill: var(--pn-warning-fill); }
.petals__petal--empty { fill: var(--pn-petal-empty); }
.petals--on-image .petals__petal--ok { fill: var(--pn-media-fg); }
.petals--on-image .petals__petal--empty { fill: var(--pn-media-fg-dim); }

/* ⑥ 完成绽放（M06）：先往回收一点，再带回弹转正；一圈涟漪同时散开。0.6 秒内播完 */
.petals--bloom > svg { animation: petals-bloom var(--pn-dur-bloom) var(--pn-ease-in) both; }

.petals__ripple {
  position: absolute;
  inset: var(--pn-bloom-ripple-inset);
  border: var(--pn-bloom-ripple-width) solid var(--pn-grad-a);
  border-radius: 50%;
  opacity: 0;
  pointer-events: none;
  animation: petals-ripple var(--pn-dur-bloom) var(--pn-ease-in) both;
}

@keyframes petals-bloom {
  0%, 100% { transform: none; }
  30% { transform: rotate(var(--pn-bloom-turn-back)) scale(var(--pn-bloom-scale-back)); }
  70% { transform: rotate(var(--pn-bloom-turn-over)) scale(var(--pn-bloom-scale-over)); }
}

@keyframes petals-ripple {
  0% { opacity: 0; transform: scale(var(--pn-bloom-ripple-from)); }
  20% { opacity: var(--pn-bloom-ripple-peak); }
  100% { opacity: 0; transform: scale(var(--pn-bloom-ripple-to)); }
}

/* 「减少动态效果」：不转、不散，花瓣颜色和「已复制」文字照样说明结果 */
@media (prefers-reduced-motion: reduce) {
  .petals--bloom > svg,
  .petals__ripple { animation: none; }
}

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
