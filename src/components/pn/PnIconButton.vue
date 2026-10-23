<script setup lang="ts">
// 纯图标按钮 28×28（Controls.dc.html）：必须带 aria-label，并配悬停气泡
import PnIcon from './PnIcon.vue';
import PnTooltip from './PnTooltip.vue';
import type { IconName } from './icons';

// 根节点是气泡（不渲染元素），@click、class 这类透传属性要手动交给按钮，否则会被丢掉
defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{
  icon: IconName;
  label: string;
  /** subtle = 浅灰底；ghost = 透明底（如「⋯」更多操作） */
  tone?: 'subtle' | 'ghost';
  iconSize?: number;
  stroke?: number;
  disabled?: boolean;
  /** 不配气泡（例如按钮旁边已经有文字说明） */
  noTooltip?: boolean;
}>(), {
  tone: 'ghost',
  iconSize: 14,
  stroke: 1.8,
  disabled: false,
  noTooltip: false,
});
</script>

<template>
  <PnTooltip :text="label" :disabled="noTooltip || disabled">
    <button v-bind="$attrs" type="button" class="pn-icon-button" :class="`pn-icon-button--${tone}`" :aria-label="label" :disabled="disabled">
      <PnIcon :name="icon" :size="iconSize" :stroke="stroke" />
    </button>
  </PnTooltip>
</template>

<style scoped>
.pn-icon-button {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-icon-button);
  height: var(--pn-size-icon-button);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.pn-icon-button:disabled { cursor: default; opacity: var(--pn-opacity-disabled); }

.pn-icon-button--subtle { background: var(--pn-subtle); color: var(--pn-text1); }
.pn-icon-button--subtle:not(:disabled):hover { background: var(--pn-ghost-press); }

.pn-icon-button--ghost { background: transparent; color: var(--pn-text2); }
.pn-icon-button--ghost:not(:disabled):hover { background: var(--pn-ghost-hover); color: var(--pn-text1); }
</style>
