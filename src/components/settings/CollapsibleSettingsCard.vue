<script setup lang="ts">
import ToggleSwitch from 'primevue/toggleswitch';

interface Props {
  title: string;
  description: string;
  enabled: boolean;
  expanded: boolean;
  /** 展开后内容区允许溢出（用于包含下拉框的场景） */
  allowOverflow?: boolean;
  /** 需要用户关注（前置条件未满足），边框和状态点会变为 warning 色 */
  needsAttention?: boolean;
  /** needsAttention 激活时，状态点 tooltip 的提示文案 */
  attentionTooltip?: string;
  /** 禁用头部开关，但仍允许折叠/展开 */
  toggleDisabled?: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  'update:enabled': [value: boolean];
  'update:expanded': [value: boolean];
}>();
</script>

<template>
  <div
    class="collapsible-card"
    :class="{ expanded, 'allow-overflow': allowOverflow, 'needs-attention': needsAttention }"
  >
    <button class="card-header" @click="emit('update:expanded', !expanded)">
      <div class="header-left">
        <span
          class="status-dot"
          :class="{ active: enabled && !needsAttention, 'needs-attention': needsAttention && enabled }"
          v-tooltip.top="needsAttention && enabled ? (attentionTooltip || '需要配置') : (enabled ? '已启用' : '未启用')"
        />
        <div class="header-info">
          <span class="card-title">{{ title }}</span>
          <span class="card-description" v-tooltip.top="description">{{ description }}</span>
        </div>
      </div>
      <div class="header-right">
        <ToggleSwitch
          :modelValue="enabled"
          :disabled="toggleDisabled"
          @update:modelValue="(v: boolean) => emit('update:enabled', v)"
          @click.stop
        />
        <i class="expand-icon pi" :class="expanded ? 'pi-chevron-up' : 'pi-chevron-down'" />
      </div>
    </button>

    <div class="card-content-wrapper">
      <div class="card-content">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('../../styles/settings-shared.css');

.collapsible-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--settings-card-radius, var(--radius-lg));
  overflow: hidden;
  transition: border-color var(--duration-normal) ease;
}

.collapsible-card:hover {
  border-color: var(--primary);
}

.collapsible-card.expanded {
  border-color: var(--primary);
}

.collapsible-card.needs-attention,
.collapsible-card.needs-attention:hover,
.collapsible-card.needs-attention.expanded {
  border-color: var(--warning);
}

.status-dot.needs-attention {
  background: var(--warning);
}

.collapsible-card.allow-overflow {
  overflow: visible;
}

.collapsible-card:hover .expand-icon {
  color: var(--text-secondary);
}

.collapsible-card.expanded .expand-icon {
  color: var(--primary);
}

.collapsible-card.expanded .card-content-wrapper {
  grid-template-rows: 1fr;
}

.card-content {
  display: flex;
  flex-direction: column;
}

@keyframes show-overflow {
  to { overflow: visible; }
}

.collapsible-card.allow-overflow.expanded .card-content {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 0s 延迟无对应 duration token */
  animation: show-overflow 0s var(--duration-normal) forwards;
}

.card-content > :deep(:first-child) {
  border-top: 1px solid var(--border-subtle);
}
</style>
