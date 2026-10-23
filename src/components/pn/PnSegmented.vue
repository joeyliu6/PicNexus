<script setup lang="ts" generic="T extends string">
// 分段控件（Controls.dc.html）：切换「怎么看」。选中块浮起来，不用彩色。
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui';
import PnIcon from './PnIcon.vue';
import type { IconName } from './icons';

export interface PnSegment<V extends string> {
  value: V;
  /** 只有图标时作为 aria-label / 气泡 */
  label: string;
  icon?: IconName;
}

const model = defineModel<T>({ required: true });

defineProps<{
  segments: readonly PnSegment<T>[];
  label?: string;
}>();

// 单选分段不允许被点成「一个都不选」
function onUpdate(value: unknown) {
  if (typeof value === 'string' && value) model.value = value as T;
}
</script>

<template>
  <ToggleGroupRoot type="single" class="pn-segmented" :model-value="model" :aria-label="label" @update:model-value="onUpdate">
    <ToggleGroupItem
      v-for="segment in segments"
      :key="segment.value"
      class="pn-segmented__item"
      :class="{ 'pn-segmented__item--icon': segment.icon }"
      :value="segment.value"
      :aria-label="segment.icon ? segment.label : undefined"
      :title="segment.icon ? segment.label : undefined"
    >
      <PnIcon v-if="segment.icon" :name="segment.icon" :size="14" />
      <template v-else>{{ segment.label }}</template>
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>

<style scoped>
.pn-segmented {
  display: inline-flex;
  align-self: flex-start;
  gap: var(--pn-space-2);
  padding: var(--pn-space-2);
  border-radius: var(--pn-radius-seg);
  background: var(--pn-seg-track);
}

.pn-segmented__item {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--pn-size-seg-item);
  padding: 0 var(--pn-space-sidebar-x);
  border: 0;
  border-radius: var(--pn-radius-seg-item);
  background: transparent;
  color: var(--pn-text2);
  font: inherit;
  font-size: var(--pn-text-footnote);

  /* 选中块浮起 / 落下与文字变深一起渐变（交接说明 5.3「快 150ms：开关」） */
  transition:
    background-color var(--pn-dur-fast) var(--pn-ease-in),
    box-shadow var(--pn-dur-fast) var(--pn-ease-in),
    color var(--pn-dur-fast) var(--pn-ease-in);
}

.pn-segmented__item--icon { width: var(--pn-size-seg-icon); padding: 0; }

/* 未选的段：悬停字变深，按下底色比轨道深一级（深色下亮一级） */
.pn-segmented__item:not([data-state='on']):hover { color: var(--pn-text1); }
.pn-segmented__item:not([data-state='on']):active { background: var(--pn-ghost-press); }

.pn-segmented__item[data-state='on'] {
  background: var(--pn-seg-on);
  box-shadow: var(--pn-seg-shadow);
  color: var(--pn-text1);
  font-weight: var(--pn-weight-medium);
}
</style>
