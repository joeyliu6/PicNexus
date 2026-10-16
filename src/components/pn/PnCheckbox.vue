<script setup lang="ts">
// 复选框 16px（Controls.dc.html）：已选蓝底白勾，部分选中蓝底白横线；有文字时放在默认插槽
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui';
import PnIcon from './PnIcon.vue';

const model = defineModel<boolean | 'indeterminate'>({ default: false });

withDefaults(defineProps<{
  disabled?: boolean;
  label?: string;
  id?: string;
}>(), { disabled: false, label: undefined, id: undefined });
</script>

<template>
  <label class="pn-checkbox" :class="{ 'pn-checkbox--disabled': disabled }">
    <CheckboxRoot :id="id" v-model="model" class="pn-checkbox__box" :disabled="disabled" :aria-label="$slots.default ? undefined : label">
      <CheckboxIndicator class="pn-checkbox__indicator">
        <PnIcon v-if="model === 'indeterminate'" name="linuxMinimize" :size="10" :stroke="3" />
        <PnIcon v-else name="check" :size="11" :stroke="3" />
      </CheckboxIndicator>
    </CheckboxRoot>
    <span v-if="$slots.default" class="pn-checkbox__label"><slot /></span>
  </label>
</template>

<style scoped>
.pn-checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--pn-space-8);
  cursor: pointer;
}

.pn-checkbox--disabled { cursor: default; color: var(--pn-disabled); }

.pn-checkbox__box {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-check);
  height: var(--pn-size-check);
  box-sizing: border-box;
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-check);
  background: var(--pn-field);
  box-shadow: inset 0 0 0 1px var(--pn-check-border);
  color: var(--pn-on-fill);
  cursor: inherit;
}

.pn-checkbox__box[data-state='checked'],
.pn-checkbox__box[data-state='indeterminate'] {
  background: var(--pn-brand);
  box-shadow: none;
}

.pn-checkbox__box:disabled:not([data-state='checked']) {
  background: var(--pn-subtle);
  box-shadow: inset 0 0 0 1px var(--pn-border);
}

.pn-checkbox__box:disabled[data-state='checked'] { opacity: var(--pn-opacity-disabled); }

.pn-checkbox__indicator { display: flex; }
</style>
