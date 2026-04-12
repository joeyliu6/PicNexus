<script setup lang="ts">
import ToggleSwitch from 'primevue/toggleswitch';
import InputNumber from 'primevue/inputnumber';

import type { CompressionPreset } from '../../../config/types';
import { OUTPUT_FORMAT_OPTIONS } from '../../../composables/settings/useCompressionPresets';

interface Props {
  activePreset: CompressionPreset;
  qualityLevel: { label: string; cls: string };
  scaleLevel: { label: string; cls: string };
  skipDisplayValue: number;
  skipUnit: 'KB' | 'MB';
}

defineProps<Props>();

const emit = defineEmits<{
  updatePreset: [patch: Partial<CompressionPreset>];
  qualityInput: [v: number | null];
  commitQuality: [];
  scaleInput: [v: number | null];
  commitScale: [];
  skipValueChange: [v: number | null];
  toggleSkipUnit: [];
}>();

const outputFormatOptions = OUTPUT_FORMAT_OPTIONS;
</script>

<template>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">输出格式</span>
      <span class="settings-row-desc">不同格式在体积、画质和兼容性上各有取舍</span>
    </div>
    <div class="format-tabs">
      <button
        v-for="opt in outputFormatOptions"
        :key="opt.value"
        class="format-tab"
        :class="{ active: activePreset.outputFormat === opt.value }"
        v-tooltip.top="opt.tooltip"
        @click="emit('updatePreset', { outputFormat: opt.value })"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>

  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">压缩质量</span>
      <span class="settings-row-desc">1-100，数值越大画质越高</span>
    </div>
    <div class="quality-input-group">
      <span class="quality-badge" :class="qualityLevel.cls">{{ qualityLevel.label }}</span>
      <div class="narrow-input">
        <InputNumber
          :modelValue="activePreset.quality"
          :min="1"
          :max="100"
          :useGrouping="false"
          @update:modelValue="(v) => emit('qualityInput', v)"
          @blur="emit('commitQuality')"
        />
      </div>
    </div>
  </div>

  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">图片缩放</span>
      <span class="settings-row-desc">等比缩放，100% 为原始尺寸</span>
    </div>
    <div class="scale-input-group">
      <span class="quality-badge" :class="scaleLevel.cls">{{ scaleLevel.label }}</span>
      <div class="narrow-input">
        <InputNumber
          :modelValue="activePreset.scalePercent ?? 100"
          :min="1"
          :max="100"
          :useGrouping="false"
          suffix="%"
          @update:modelValue="(v) => emit('scaleInput', v)"
          @blur="emit('commitScale')"
        />
      </div>
    </div>
  </div>

  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">跳过小文件</span>
      <span class="settings-row-desc">低于阈值的文件不做压缩处理，避免越压越大</span>
    </div>
    <div class="skip-input-group">
      <InputNumber
        :modelValue="skipDisplayValue"
        :min="0"
        :max="skipUnit === 'MB' ? 100 : 102400"
        :maxFractionDigits="skipUnit === 'MB' ? 1 : 0"
        :useGrouping="false"
        class="skip-number"
        @update:modelValue="(v) => emit('skipValueChange', v)"
      />
      <button class="skip-unit-btn" v-tooltip.top="'切换单位'" @click="emit('toggleSkipUnit')">
        {{ skipUnit }}
        <i class="pi pi-arrows-v" />
      </button>
    </div>
  </div>

  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">去除 EXIF 元数据</span>
      <span class="settings-row-desc">上传到公共图床时，EXIF 通常会被自动去除；私有图床建议开启以保护隐私</span>
    </div>
    <ToggleSwitch
      :modelValue="activePreset.stripExif"
      @update:modelValue="(v: boolean) => emit('updatePreset', { stripExif: v })"
    />
  </div>
</template>

<style scoped>
@import url('../../../styles/settings-shared.css');

.settings-row {
  border-bottom: 1px solid var(--border-subtle);
}

/* --- Format Tabs --- */

.format-tabs {
  display: flex;
  gap: var(--space-xs-sm);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.format-tab {
  padding: var(--space-xs-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 999px 为药丸形圆角 */
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: all var(--duration-fast);
}

.format-tab:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.format-tab.active {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-alpha-8);
  text-shadow: 0 0 0.5px currentcolor;
}

/* --- Quality Badge --- */

.quality-input-group,
.scale-input-group {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
}

.quality-badge {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  padding: var(--space-2xs) var(--space-sm);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 999px 为药丸形圆角 */
  border-radius: 999px;
  white-space: nowrap;
  transition: all var(--duration-normal);
}

.quality-badge.quality-low {
  color: var(--error);
  background: var(--error-soft);
}

.quality-badge.quality-medium {
  color: var(--warning);
  background: var(--warning-soft);
}

.quality-badge.quality-good {
  color: var(--success);
  background: var(--success-soft);
}

.quality-badge.quality-high {
  color: var(--primary);
  background: var(--primary-alpha-8);
}

/* --- Scale Badge --- */

.quality-badge.scale-original {
  color: var(--success);
  background: var(--success-soft);
}

.quality-badge.scale-light {
  color: var(--primary);
  background: var(--primary-alpha-8);
}

.quality-badge.scale-moderate {
  color: var(--warning);
  background: var(--warning-soft);
}

.quality-badge.scale-heavy {
  color: var(--error);
  background: var(--error-alpha-8);
}

/* --- Input widths --- */

.narrow-input {
  width: 110px;
  flex-shrink: 0;
}

.narrow-input :deep(.p-inputnumber) {
  width: 100%;
  display: flex;
}

.narrow-input :deep(.p-inputnumber-input) {
  width: 100%;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  text-align: center;
}

/* --- Skip file size (unified input with clickable unit) --- */

.skip-input-group {
  display: flex;
  align-items: stretch;
  width: 110px;
  flex-shrink: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
  overflow: hidden;
  transition: border-color var(--duration-fast);
}

.skip-input-group:focus-within {
  border-color: var(--border-focus);
}

.skip-input-group .skip-number {
  flex: 1;
  min-width: 0;
}

.skip-input-group .skip-number :deep(.p-inputnumber) {
  width: 100%;
  display: flex;
}

.skip-input-group .skip-number :deep(.p-inputnumber-input) {
  width: 100%;
  min-width: 0;
  border: none;
  background: var(--bg-input);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  text-align: center;
  outline: none;
  box-shadow: none;
}

.skip-unit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2xs);
  width: 42px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-left: 1px solid var(--border-subtle);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: all var(--duration-fast);
  white-space: nowrap;
}

.skip-unit-btn:hover {
  color: var(--primary);
  background: var(--primary-alpha-8);
}

.skip-unit-btn .pi {
  font-size: var(--text-2xs);
  opacity: 0.6;
}

/* --- Responsive --- */

@media (width <= 900px) {
  .settings-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .narrow-input,
  .skip-input-group {
    width: 100%;
  }

  .format-tabs {
    justify-content: flex-start;
  }
}
</style>
