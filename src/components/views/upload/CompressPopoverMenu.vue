<script setup lang="ts">
import type { CompressionPreset } from '../../../config/types';
import { FORMAT_LABEL } from '../../../composables/settings/useCompressionPresets';

interface Props {
  presets: CompressionPreset[];
  activePreset: CompressionPreset | null;
  compressionEnabled: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'select-preset': [presetId: string];
  'go-settings': [];
}>();

function formatPresetDesc(p: CompressionPreset): string {
  return `${FORMAT_LABEL[p.outputFormat] ?? p.outputFormat} · 质量 ${p.quality}`;
}

function isActivePreset(presetId: string): boolean {
  return props.compressionEnabled && props.activePreset?.id === presetId;
}
</script>

<template>
  <div class="preset-popover-list">
    <!-- 预设列表（关闭态整组半透明，但仍可点：触发自动启用） -->
    <div class="popover-presets-group" :class="{ 'is-disabled': !compressionEnabled }">
      <button
        v-for="preset in presets"
        :key="preset.id"
        class="preset-popover-item"
        :class="{ active: isActivePreset(preset.id) }"
        v-tooltip.right="!compressionEnabled ? '点击启用并应用此预设' : ''"
        @click="emit('select-preset', preset.id)"
      >
        <i
          :class="['pi', isActivePreset(preset.id) ? 'pi-check' : 'pi-circle']"
          class="preset-check"
        />
        <span class="preset-item-name">{{ preset.name }}</span>
        <span class="preset-item-desc">{{ formatPresetDesc(preset) }}</span>
      </button>
    </div>

    <div class="preset-popover-divider" role="separator" />

    <!-- 压缩设置入口 -->
    <button
      class="preset-popover-item preset-popover-settings"
      @click="emit('go-settings')"
    >
      <i class="pi pi-cog preset-settings-icon" />
      <span class="preset-item-name">压缩设置</span>
      <i class="pi pi-arrow-right preset-settings-arrow" />
    </button>
  </div>
</template>

<style scoped>
.preset-popover-list {
  display: flex;
  flex-direction: column;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 2px 列表行间距，介于 --space-2xs(2px) 与 --space-xs(4px) 之间，无精确 token */
  gap: 2px;
  min-width: 0;
}

.popover-presets-group {
  display: flex;
  flex-direction: column;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 2px 列表行间距，与外层 list 一致 */
  gap: 2px;
  transition: opacity var(--duration-normal) ease;
}

.popover-presets-group.is-disabled {
  opacity: 0.55;
}

.preset-popover-item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px 上下内边距，介于 --space-2xs(2px) 与 --space-xs(4px) 之间，无精确 token */
  padding: 5px var(--space-sm);
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-xs);
  font-family: inherit;
  color: var(--text-primary);
  transition: background var(--duration-fast);
  white-space: nowrap;
}

.preset-popover-item:hover {
  background: var(--primary-alpha-10);
}

.preset-popover-item.active {
  background: var(--primary-alpha-8);
}

/* 行首图标列：所有行（含设置入口）共享同一占位宽度，保证文字垂直对齐
   默认（未选中 / 未启用）：半透明灰圆点；选中态切换为 primary 色实勾 */
.preset-check {
  font-size: var(--text-xs);
  width: 12px;
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0.45;
  transition: color var(--duration-fast) ease, opacity var(--duration-fast) ease;
}

.preset-popover-item.active .preset-check {
  color: var(--primary);
  opacity: 1;
}

.preset-item-name {
  font-weight: var(--weight-medium);
}

.preset-item-desc {
  margin-left: var(--space-sm);
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
}

/* Popover 分隔线 */
.preset-popover-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: var(--space-2xs) 0;
}

/* "压缩设置"入口 */
.preset-popover-settings {
  color: var(--text-secondary);
}

.preset-popover-settings:hover {
  color: var(--primary);
}

.preset-settings-icon {
  font-size: var(--text-xs);
  color: var(--text-muted);
  width: 12px;
  flex-shrink: 0;
}

.preset-popover-settings:hover .preset-settings-icon {
  color: var(--primary);
}

.preset-settings-arrow {
  margin-left: auto;
  font-size: var(--text-2xs);
  color: var(--text-muted);
  opacity: 0.6;
}

.preset-popover-settings:hover .preset-settings-arrow {
  color: var(--primary);
  opacity: 1;
}
</style>
