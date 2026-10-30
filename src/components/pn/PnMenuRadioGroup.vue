<script setup lang="ts" generic="T extends string">
// 单选菜单（如「复制为」「压缩」）：当前选中的打勾；可带一行说明或右侧等宽示例
import { DropdownMenuItemIndicator, DropdownMenuRadioGroup, DropdownMenuRadioItem } from 'reka-ui';
import PnIcon from './PnIcon.vue';

interface PnMenuRadioOption<V extends string> {
  value: V;
  label: string;
  description?: string;
  hint?: string;
  disabled?: boolean;
}

const model = defineModel<T>({ required: true });

defineProps<{ options: readonly PnMenuRadioOption<T>[] }>();
</script>

<template>
  <DropdownMenuRadioGroup v-model="model">
    <DropdownMenuRadioItem
      v-for="option in options"
      :key="option.value"
      class="pn-menu__item pn-menu__item--indent"
      :class="{ 'pn-menu__item--described': option.description }"
      :value="option.value"
      :disabled="option.disabled"
    >
      <DropdownMenuItemIndicator class="pn-menu__check">
        <PnIcon name="check" :size="14" :stroke="2.4" />
      </DropdownMenuItemIndicator>
      <span class="pn-menu__label">{{ option.label }}</span>
      <span v-if="option.description" class="pn-menu__desc">{{ option.description }}</span>
      <span v-else-if="option.hint" class="pn-menu__hint">{{ option.hint }}</span>
    </DropdownMenuRadioItem>
  </DropdownMenuRadioGroup>
</template>
