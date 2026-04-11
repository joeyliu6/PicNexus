<script setup lang="ts">
import { ref, toRef } from 'vue';
import ToggleSwitch from 'primevue/toggleswitch';
import InputNumber from 'primevue/inputnumber';

import type { ImageCompressionConfig } from '../../config/types';
import { useCompressionPresets, OUTPUT_FORMAT_OPTIONS } from '../../composables/settings/useCompressionPresets';
import CompressionPreviewDialog from '../dialogs/CompressionPreviewDialog.vue';

interface Props {
  imageCompression: ImageCompressionConfig;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:imageCompression': [config: ImageCompressionConfig];
}>();

const expanded = ref(false);

function toggleExpand() {
  expanded.value = !expanded.value;
}

function updateCompression(patch: Partial<ImageCompressionConfig>) {
  emit('update:imageCompression', { ...props.imageCompression, ...patch });
}

const editInputRef = ref<HTMLInputElement | HTMLInputElement[] | null>(null);

const {
  editingPresetId,
  editDraft,
  skipUnit,
  activePreset,
  canAddPreset,
  statusDesc,
  qualityLevel,
  scaleLevel,
  skipDisplayValue,
  selectPreset,
  addPreset,
  handleDeletePreset,
  updateActivePreset,
  startEditing,
  commitEdit,
  cancelEdit,
  handleQualityInput,
  handleScaleInput,
  commitQualityInput,
  commitScaleInput,
  handleSkipValueChange,
  toggleSkipUnit,
} = useCompressionPresets({
  imageCompression: toRef(props, 'imageCompression'),
  onUpdate: updateCompression,
  editInputRef,
});

const outputFormatOptions = OUTPUT_FORMAT_OPTIONS;

function toggleEnabled(v: boolean) {
  updateCompression({ enabled: v });
}

const previewDialogVisible = ref(false);

function openPreviewDialog() {
  previewDialogVisible.value = true;
}
</script>

<template>
  <div class="compression-collapsible" :class="{ expanded }">
    <button class="card-header" @click="toggleExpand">
      <div class="header-left">
        <span class="status-dot" :class="imageCompression.enabled ? 'active' : ''" v-tooltip.top="imageCompression.enabled ? '已启用' : '未启用'" />
        <div class="header-info">
          <span class="card-title">图片压缩</span>
          <span class="card-description">{{ statusDesc }}</span>
        </div>
      </div>
      <div class="header-right">
        <ToggleSwitch
          :modelValue="imageCompression.enabled"
          @update:modelValue="toggleEnabled"
          @click.stop
        />
        <i :class="expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
      </div>
    </button>

    <div class="card-content-wrapper">
      <div class="card-content">
        <div class="preset-tab-row">
          <div
            v-for="preset in imageCompression.presets"
            :key="preset.id"
            class="preset-tab"
            :class="{ active: imageCompression.activePresetId === preset.id, editing: editingPresetId === preset.id }"
            v-tooltip.top="editingPresetId !== preset.id ? '双击重命名' : undefined"
          >
            <span
              class="preset-tab-label"
              :style="editingPresetId === preset.id ? { visibility: 'hidden' } : {}"
              @click="selectPreset(preset.id)"
              @dblclick="startEditing(preset.id)"
            >{{ editingPresetId === preset.id ? editDraft : preset.name }}</span>
            <input
              v-if="editingPresetId === preset.id"
              ref="editInputRef"
              v-model.trim="editDraft"
              class="preset-tab-input"
              @blur="commitEdit"
              @keyup.enter="commitEdit"
              @keyup.escape="cancelEdit"
            />
          </div>
          <button
            class="preset-tab add-tab"
            :class="{ disabled: !canAddPreset }"
            v-tooltip.top="canAddPreset ? '新建方案' : '最多支持 5 个方案'"
            @click="addPreset"
          >
            <i class="pi pi-plus" />
          </button>
        </div>

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
              @click="updateActivePreset({ outputFormat: opt.value })"
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
                @update:modelValue="handleQualityInput"
                @blur="commitQualityInput"
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
                @update:modelValue="handleScaleInput"
                @blur="commitScaleInput"
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
              @update:modelValue="handleSkipValueChange"
            />
            <button class="skip-unit-btn" v-tooltip.top="'切换单位'" @click="toggleSkipUnit">
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
            @update:modelValue="(v: boolean) => updateActivePreset({ stripExif: v })"
          />
        </div>

        <CompressionPreviewDialog
          :visible="previewDialogVisible"
          :preset="activePreset"
          @update:visible="previewDialogVisible = $event"
        />

        <div class="preset-actions">
          <button class="preview-btn" @click="openPreviewDialog">
            <i class="pi pi-image" />
            试一试
          </button>
          <button
            class="delete-preset-btn"
            :disabled="imageCompression.presets.length <= 1"
            v-tooltip.top="imageCompression.presets.length <= 1 ? '至少保留一个方案' : undefined"
            @click="handleDeletePreset(imageCompression.activePresetId)"
          >
            <i class="pi pi-trash" />
            删除此方案
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('../../styles/settings-shared.css');

/* --- Collapsible Container --- */

.compression-collapsible {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--settings-card-radius, 12px);
  overflow: hidden;
}

.expanded .card-content-wrapper {
  grid-template-rows: 1fr;
}

.card-content {
  display: flex;
  flex-direction: column;
}

.expanded .card-content {
  border-top: 1px solid var(--border-subtle);
}

/* settings-row 分割线（原来由 .settings-card 提供） */
.compression-collapsible .settings-row {
  border-bottom: 1px solid var(--border-subtle);
}

.compression-collapsible .settings-row:last-child {
  border-bottom: none;
}

/* --- Preset Tabs --- */

.preset-tab-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  flex-wrap: wrap;
}

.preset-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 64px;
  min-height: 28px;
  padding: 5px 14px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-fast);
}

.preset-tab:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.preset-tab.active {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-alpha-8);
  text-shadow: 0 0 0.5px currentcolor;
}

.preset-tab.add-tab {
  border-style: dashed;
  color: var(--text-muted);
  padding: 5px 10px;
  min-width: auto;
}

.preset-tab.add-tab:hover:not(.disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.preset-tab.add-tab.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.preset-tab.add-tab .pi {
  font-size: var(--text-2xs-xs);
}

/* --- Preset Tab Inline Edit & Delete --- */

.preset-tab-label {
  user-select: none;
  cursor: pointer;
  text-align: center;
}

.preset-tab.editing {
  border-color: var(--primary);
}

.preset-tab-input {
  position: absolute;
  inset: 0;
  background: transparent;
  border: none;
  outline: none;
  color: inherit;
  font: inherit;
  padding: 5px 14px;
  box-sizing: border-box;
  text-align: center;
}

.preset-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
  padding: 8px 16px 12px;
}

.delete-preset-btn {
  margin: 0;
  padding: 4px 0;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: var(--text-xs);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: color var(--duration-fast);
}

.delete-preset-btn:hover:not(:disabled) {
  color: var(--error);
}

.delete-preset-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.delete-preset-btn .pi {
  font-size: var(--text-2xs-xs);
}

/* --- Quality Badge --- */

.quality-input-group,
.scale-input-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.quality-badge {
  font-size: var(--text-xs);
  font-weight: 500;
  padding: 2px 8px;
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

/* --- Format Tabs --- */

.format-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.format-tab {
  padding: 6px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 500;
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
  border-radius: 6px;
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
  gap: 2px;
  width: 42px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-left: 1px solid var(--border-subtle);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--text-xs);
  font-weight: 500;
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

/* --- Compression Preview --- */

.preview-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border: 1px solid var(--primary-alpha-15);
  border-radius: 999px;
  background: var(--primary-alpha-8);
  color: var(--primary);
  font-size: var(--text-xs);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-fast);
  flex-shrink: 0;
}

.preview-btn .pi {
  font-size: var(--text-2xs-xs);
  line-height: 1;
}

.preview-btn:hover:not(:disabled) {
  background: var(--primary-alpha-12);
}

.preview-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
