<script setup lang="ts" generic="T extends string">
// 单选组（Controls.dc.html）：16px 圆，选中蓝底 + 6px 白点
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui';

export interface PnRadioOption<V extends string> {
  value: V;
  label: string;
  /** 一行灰色说明 */
  description?: string;
  disabled?: boolean;
}

const model = defineModel<T>({ required: true });

withDefaults(defineProps<{
  options: readonly PnRadioOption<T>[];
  label?: string;
  orientation?: 'vertical' | 'horizontal';
}>(), { label: undefined, orientation: 'vertical' });
</script>

<template>
  <RadioGroupRoot v-model="model" class="pn-radio-group" :class="`pn-radio-group--${orientation}`" :aria-label="label" :orientation="orientation">
    <label v-for="option in options" :key="option.value" class="pn-radio" :class="{ 'pn-radio--disabled': option.disabled }">
      <RadioGroupItem class="pn-radio__dot" :value="option.value" :disabled="option.disabled">
        <RadioGroupIndicator class="pn-radio__indicator" />
      </RadioGroupItem>
      <span class="pn-radio__text">
        <span>{{ option.label }}</span>
        <span v-if="option.description" class="pn-radio__desc">{{ option.description }}</span>
      </span>
    </label>
  </RadioGroupRoot>
</template>

<style scoped>
.pn-radio-group { display: flex; gap: var(--pn-space-8); }
.pn-radio-group--vertical { flex-direction: column; }
.pn-radio-group--horizontal { flex-wrap: wrap; gap: var(--pn-space-16); }

.pn-radio {
  display: inline-flex;
  align-items: flex-start;
  gap: var(--pn-space-8);
  cursor: pointer;
}

.pn-radio--disabled { cursor: default; color: var(--pn-disabled); }

.pn-radio__dot {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-check);
  height: var(--pn-size-check);
  margin-top: var(--pn-space-2);
  box-sizing: border-box;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--pn-field);
  box-shadow: inset 0 0 0 1px var(--pn-check-border);
  cursor: inherit;
}

.pn-radio__dot[data-state='checked'] { background: var(--pn-brand); box-shadow: none; }
.pn-radio__dot:disabled:not([data-state='checked']) { background: var(--pn-subtle); box-shadow: inset 0 0 0 1px var(--pn-border); }
.pn-radio__dot:disabled[data-state='checked'] { opacity: var(--pn-opacity-disabled); }

.pn-radio__indicator {
  width: var(--pn-size-radio-dot);
  height: var(--pn-size-radio-dot);
  border-radius: 50%;
  background: var(--pn-on-fill);
}

.pn-radio__text { display: flex; flex-direction: column; }

.pn-radio__desc {
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
  color: var(--pn-text3);
}
</style>
