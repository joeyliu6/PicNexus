<script setup lang="ts">
// 菜单项：普通项 / 危险项（红字 + 一行灰色说明，执行前会再确认的在文字后加「…」）
import { DropdownMenuItem } from 'reka-ui';

withDefaults(defineProps<{
  danger?: boolean;
  /** 一行灰色说明（危险项写清影响范围） */
  description?: string;
  /** 右侧快捷键提示 */
  hint?: string;
  /** 右侧当前取值（如「每 7 天」） */
  value?: string;
  disabled?: boolean;
}>(), {
  danger: false,
  description: undefined,
  hint: undefined,
  value: undefined,
  disabled: false,
});

defineEmits<{ select: [event: Event] }>();
</script>

<template>
  <DropdownMenuItem
    class="pn-menu__item"
    :class="{ 'pn-menu__item--danger': danger, 'pn-menu__item--described': description }"
    :disabled="disabled"
    @select="$emit('select', $event)"
  >
    <template v-if="description">
      <span class="pn-menu__label"><slot /></span>
      <span class="pn-menu__desc">{{ description }}</span>
    </template>
    <template v-else>
      <span class="pn-menu__label"><slot /></span>
      <span v-if="value" class="pn-menu__value">{{ value }}</span>
      <span v-if="hint" class="pn-menu__hint">{{ hint }}</span>
    </template>
  </DropdownMenuItem>
</template>
