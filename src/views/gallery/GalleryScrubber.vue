<script setup lang="ts">
// 图库刻度条（交接说明 8.2 + GalleryScreen.dc.html）：一块毛玻璃浮在图片右缘，图片照常铺满宽度。
// 滚动或鼠标靠近右缘时出现，停止 1.5 秒后淡出（显隐由页面按鼠标位置控制）；拖动或点刻度跳到那个年月，悬停出同样毛玻璃的「2026 年 10 月」。
import { computed, ref } from 'vue';
import { SCRUBBER_TICK_HEIGHT, type ScrubberTick } from './scrubberTicks';

const props = defineProps<{
  ticks: readonly ScrubberTick[];
  visible: boolean;
}>();

const emit = defineEmits<{
  jump: [year: number, month: number | undefined];
}>();

const PAD_TOP = 8;

const offsets = computed(() => {
  let y = PAD_TOP;
  return props.ticks.map((tick) => {
    const top = y;
    y += SCRUBBER_TICK_HEIGHT[tick.kind];
    return top;
  });
});

const markerTop = computed(() => {
  const index = props.ticks.findIndex((t) => t.current);
  return index < 0 ? null : offsets.value[index] + 2;
});

const hovered = ref<{ index: number; y: number } | null>(null);
let dragging = false;
let lastJumped = -1;

function tickAt(clientY: number, el: HTMLElement): { index: number; y: number } | null {
  const y = clientY - el.getBoundingClientRect().top;
  for (let i = props.ticks.length - 1; i >= 0; i--) {
    if (y >= offsets.value[i]) return { index: i, y: offsets.value[i] };
  }
  return props.ticks.length ? { index: 0, y: offsets.value[0] } : null;
}

function jumpTo(index: number): void {
  if (index === lastJumped) return;
  lastJumped = index;
  const tick = props.ticks[index];
  emit('jump', tick.year, tick.month);
}

function onPointerDown(event: PointerEvent): void {
  const el = event.currentTarget as HTMLElement;
  el.setPointerCapture(event.pointerId);
  dragging = true;
  lastJumped = -1;
  const hit = tickAt(event.clientY, el);
  hovered.value = hit;
  if (hit) jumpTo(hit.index);
}

function onPointerMove(event: PointerEvent): void {
  const hit = tickAt(event.clientY, event.currentTarget as HTMLElement);
  hovered.value = hit;
  if (dragging && hit) jumpTo(hit.index);
}

function onPointerUp(): void {
  dragging = false;
}

function onLeave(): void {
  if (!dragging) hovered.value = null;
}

const tipText = computed(() => {
  if (!hovered.value) return '';
  const tick = props.ticks[hovered.value.index];
  return tick.month === undefined ? `${tick.year} 年` : `${tick.year} 年 ${tick.month + 1} 月`;
});
</script>

<template>
  <div
    class="scrubber"
    :class="{ 'scrubber--visible': visible || !!hovered }"
    role="slider"
    aria-label="时间刻度"
    aria-orientation="vertical"
    :aria-valuetext="ticks.find((t) => t.current)?.label"
    @pointerleave="onLeave"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div
      v-for="tick in ticks"
      :key="`${tick.year}-${tick.month ?? 'y'}`"
      class="scrubber__tick"
      :class="[`scrubber__tick--${tick.kind}`, { 'scrubber__tick--current': tick.current }]"
    >
      {{ tick.label }}
    </div>
    <span v-if="markerTop !== null" class="scrubber__marker" :style="{ top: `${markerTop}px` }" />
    <span v-if="hovered" class="scrubber__tip" :style="{ top: `${hovered.y}px` }">{{ tipText }}</span>
  </div>
</template>

<style scoped>
.scrubber {
  position: absolute;
  top: var(--pn-space-8);
  right: var(--pn-space-8);
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  width: var(--pn-size-scrubber-w);
  box-sizing: border-box;
  padding: var(--pn-space-8) var(--pn-space-8) var(--pn-space-6) 0;
  border-radius: var(--pn-radius-scrubber);
  background: var(--pn-glass);
  backdrop-filter: var(--pn-glass-blur);
  box-shadow: 0 0 0 1px var(--pn-hairline), var(--pn-glass-drop);
  opacity: 0;
  pointer-events: none;
  touch-action: none;
  user-select: none;
  transition: opacity var(--pn-dur-standard) var(--pn-ease-in);
}

.scrubber--visible {
  opacity: 1;
  pointer-events: auto;
}

.scrubber__tick {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  color: var(--pn-text3);
  font-size: var(--pn-text-caption);
  white-space: nowrap;
  cursor: pointer;
}

.scrubber__tick--year {
  height: var(--pn-size-scrubber-year);
  color: var(--pn-text1);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-semibold);
}

.scrubber__tick--month { height: var(--pn-size-scrubber-month); }

.scrubber__tick--current {
  color: var(--pn-brand-text);
  font-weight: var(--pn-weight-semibold);
}

.scrubber__marker {
  position: absolute;
  right: var(--pn-space-2);
  width: var(--pn-size-scrubber-marker-w);
  height: var(--pn-size-scrubber-marker-h);
  border-radius: calc(var(--pn-size-scrubber-marker-h) / 2);
  background: var(--pn-brand);
}

.scrubber__tip {
  position: absolute;
  right: var(--pn-space-scrubber-tip-gap);
  display: flex;
  align-items: center;
  height: var(--pn-size-scrubber-tip);
  padding: 0 var(--pn-space-scrubber-tip-x);
  border-radius: var(--pn-size-scrubber-tip);
  background: var(--pn-glass);
  backdrop-filter: var(--pn-glass-blur);
  box-shadow: 0 0 0 1px var(--pn-hairline), var(--pn-glass-drop);
  color: var(--pn-text1);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
  white-space: nowrap;
  transform: translateY(-30%);
  pointer-events: none;
}
</style>
