<script setup lang="ts">
// 开关 36×20（Controls.dc.html）
import { SwitchRoot, SwitchThumb } from 'reka-ui';

const model = defineModel<boolean>({ default: false });

withDefaults(defineProps<{
  disabled?: boolean;
  /** 没有可见文字标签时必须给 */
  label?: string;
  id?: string;
}>(), { disabled: false, label: undefined, id: undefined });
</script>

<template>
  <SwitchRoot :id="id" v-model="model" class="pn-switch" :disabled="disabled" :aria-label="label">
    <SwitchThumb class="pn-switch__thumb" />
  </SwitchRoot>
</template>

<style scoped>
.pn-switch {
  position: relative;
  display: block;
  flex: none;
  width: var(--pn-size-switch-w);
  height: var(--pn-size-switch-h);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-switch);
  background: var(--pn-track-off);
  transition: background-color var(--pn-dur-fast) var(--pn-ease-in);
}

.pn-switch[data-state='checked'] { background: var(--pn-brand); }
.pn-switch:disabled { opacity: var(--pn-opacity-disabled); }

.pn-switch__thumb {
  position: absolute;
  top: var(--pn-space-2);
  left: var(--pn-space-2);
  width: var(--pn-size-switch-thumb);
  height: var(--pn-size-switch-thumb);
  border-radius: 50%;
  background: var(--pn-on-fill);
  box-shadow: var(--pn-switch-thumb-shadow);
  transition: transform var(--pn-dur-fast) var(--pn-ease-in);
}

.pn-switch__thumb[data-state='checked'] {
  transform: translateX(var(--pn-size-switch-thumb));
}
</style>
