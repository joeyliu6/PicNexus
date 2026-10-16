<script setup lang="ts" generic="T extends string">
// 下拉选择（Controls.dc.html）：触发器 32 高；选项 32 高，选中的左侧蓝色对勾，右侧可带一段等宽示例
import {
  SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectPortal,
  SelectRoot, SelectTrigger, SelectValue, SelectViewport,
} from 'reka-ui';
import PnIcon from './PnIcon.vue';

export interface PnSelectOption<V extends string> {
  value: V;
  label: string;
  hint?: string;
  disabled?: boolean;
}

const model = defineModel<T>({ required: true });

withDefaults(defineProps<{
  options: readonly PnSelectOption<T>[];
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}>(), { label: undefined, placeholder: '', disabled: false });
</script>

<template>
  <SelectRoot v-model="model" :disabled="disabled">
    <SelectTrigger class="pn-select" :aria-label="label">
      <SelectValue :placeholder="placeholder" />
      <svg class="pn-select__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
      </svg>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="pn-layer pn-select-menu" position="popper" :side-offset="4">
        <SelectViewport>
          <SelectItem v-for="option in options" :key="option.value" class="pn-select-menu__item" :value="option.value" :disabled="option.disabled">
            <span class="pn-select-menu__check">
              <SelectItemIndicator><PnIcon name="check" :size="14" :stroke="2.4" /></SelectItemIndicator>
            </span>
            <SelectItemText class="pn-select-menu__label">{{ option.label }}</SelectItemText>
            <span v-if="option.hint" class="pn-select-menu__hint">{{ option.hint }}</span>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style scoped>
.pn-select {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--pn-space-8);
  min-width: 0;
  height: var(--pn-size-control);
  box-sizing: border-box;
  padding: 0 var(--pn-space-8) 0 var(--pn-space-input-x);
  border: 0;
  border-radius: var(--pn-radius-md);
  background: var(--pn-field);
  box-shadow: inset 0 0 0 1px var(--pn-border-strong);
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-body);
  cursor: pointer;
}

.pn-select:disabled { cursor: default; opacity: var(--pn-opacity-disabled); }
.pn-select__chevron { flex: none; color: var(--pn-text3); }
</style>

<!-- 选项列表传送到 body，scoped 样式够不到 -->
<style>
.pn-select-menu {
  z-index: var(--pn-z-popover);
  min-width: var(--reka-select-trigger-width);
  box-sizing: border-box;
  padding: var(--pn-space-4);
  border-radius: var(--pn-radius-lg);
  background: var(--pn-elevated);
  box-shadow: var(--pn-e3);
}

.pn-select-menu__item {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  height: var(--pn-size-menu-item);
  padding: 0 var(--pn-space-8);
  border-radius: var(--pn-radius-sm);
  outline: none;
  cursor: pointer;
  user-select: none;
}

.pn-select-menu__item[data-highlighted] { background: var(--pn-menu-sel); }
.pn-select-menu__item[data-disabled] { color: var(--pn-disabled); cursor: default; }

.pn-select-menu__check {
  display: flex;
  flex: none;
  width: var(--pn-size-icon-sm);
  color: var(--pn-brand-text);
}

.pn-select-menu__label { flex: 1; }

.pn-select-menu__hint {
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-caption);
  color: var(--pn-text3);
}
</style>
