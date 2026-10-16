<script setup lang="ts">
// 可勾选的菜单项：左侧对勾列。keepOpen = 勾选后菜单不关，方便连选（如「上传到」多选）
import { DropdownMenuCheckboxItem, DropdownMenuItemIndicator } from 'reka-ui';
import PnIcon from './PnIcon.vue';

const model = defineModel<boolean>({ default: false });

const props = withDefaults(defineProps<{
  keepOpen?: boolean;
  hint?: string;
  disabled?: boolean;
}>(), { keepOpen: false, hint: undefined, disabled: false });

function onSelect(event: Event) {
  if (props.keepOpen) event.preventDefault();
}
</script>

<template>
  <DropdownMenuCheckboxItem v-model="model" class="pn-menu__item pn-menu__item--indent" :disabled="disabled" @select="onSelect">
    <DropdownMenuItemIndicator class="pn-menu__check">
      <PnIcon name="check" :size="14" :stroke="2.4" />
    </DropdownMenuItemIndicator>
    <span class="pn-menu__label"><slot /></span>
    <span v-if="hint" class="pn-menu__hint">{{ hint }}</span>
  </DropdownMenuCheckboxItem>
</template>
