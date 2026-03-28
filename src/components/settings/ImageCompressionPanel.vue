<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import ToggleSwitch from 'primevue/toggleswitch';
import InputNumber from 'primevue/inputnumber';

import type { ImageCompressionConfig, CompressionPreset, CompressionOutputFormat } from '../../config/types';
import { DEFAULT_COMPRESSION_PRESET } from '../../config/types';
import { debounce } from '../../utils/debounce';
import { useConfirm } from '../../composables/useConfirm';
import CompressionPreviewDialog from '../dialogs/CompressionPreviewDialog.vue';

interface Props {
  imageCompression: ImageCompressionConfig;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:imageCompression': [config: ImageCompressionConfig];
}>();

const MAX_PRESETS = 5;

const expanded = ref(false);
const { confirmDelete } = useConfirm();

const FORMAT_LABEL: Record<string, string> = {
  original: '原格式',
  webp: 'WebP',
  jpeg: 'JPEG',
};

const statusDesc = computed(() => {
  if (!props.imageCompression.enabled) return '上传前自动压缩图片，减小体积';
  const p = activePreset.value;
  const parts = [p.name];
  parts.push(FORMAT_LABEL[p.outputFormat] || p.outputFormat);
  parts.push(`质量 ${p.quality}`);
  if (p.scalePercent && p.scalePercent < 100) parts.push(`缩放 ${p.scalePercent}%`);
  if (p.skipIfSmallerKB > 0) {
    const kb = p.skipIfSmallerKB;
    parts.push(kb >= 1024 ? `跳过 < ${Math.round(kb / 1024)}MB` : `跳过 < ${kb}KB`);
  }
  if (p.stripExif) parts.push('去 EXIF');
  return parts.join(' · ');
});

onBeforeUnmount(() => {
  debouncedQualityUpdate.cancel();
  debouncedScaleUpdate.cancel();
});

function toggleExpand() {
  expanded.value = !expanded.value;
}

const editingPresetId = ref<string | null>(null);
const editDraft = ref('');
const editInputRef = ref<HTMLInputElement | HTMLInputElement[] | null>(null);
const skipUnit = ref<'KB' | 'MB'>('KB');


function updateCompression(patch: Partial<ImageCompressionConfig>) {
  emit('update:imageCompression', { ...props.imageCompression, ...patch });
}

const activePreset = computed<CompressionPreset>(() => {
  const cfg = props.imageCompression;
  return cfg.presets?.find((p) => p.id === cfg.activePresetId)
    ?? cfg.presets?.[0]
    ?? { ...DEFAULT_COMPRESSION_PRESET };
});

const canAddPreset = computed(() => (props.imageCompression.presets?.length ?? 0) < MAX_PRESETS);

const outputFormatOptions: Array<{ value: CompressionOutputFormat; label: string; tooltip: string }> = [
  { value: 'original', label: '原格式', tooltip: '保持原始格式不转换，兼容性最好' },
  { value: 'webp', label: 'WebP', tooltip: '体积更小画质更高，但部分公共图床不支持' },
  { value: 'jpeg', label: 'JPEG', tooltip: '通用格式，所有图床都支持，不保留透明通道' },
];

function toggleEnabled(v: boolean) {
  updateCompression({ enabled: v });
}

function selectPreset(presetId: string) {
  updateCompression({ activePresetId: presetId });
}

function updateActivePreset(patch: Partial<CompressionPreset>) {
  const presets = props.imageCompression.presets.map((p) =>
    p.id === props.imageCompression.activePresetId ? { ...p, ...patch } : p,
  );
  updateCompression({ presets });
}

function createPresetName(base: string) {
  let candidate = base;
  let index = 2;
  const existing = new Set(props.imageCompression.presets.map((p) => p.name));
  while (existing.has(candidate)) {
    candidate = `${base} ${index}`;
    index += 1;
  }
  return candidate;
}

function addPreset() {
  if (!canAddPreset.value) return;
  const id = crypto.randomUUID();
  const name = createPresetName(`方案 ${props.imageCompression.presets.length + 1}`);
  const newPreset: CompressionPreset = { ...DEFAULT_COMPRESSION_PRESET, id, name };
  const presets = [...props.imageCompression.presets, newPreset];
  updateCompression({ presets, activePresetId: id });
}

function handleDeletePreset(presetId: string) {
  if (props.imageCompression.presets.length <= 1) return;
  const preset = props.imageCompression.presets.find((p) => p.id === presetId);
  if (!preset) return;

  confirmDelete(`确定要删除方案「${preset.name}」吗？`, () => {
    const presets = props.imageCompression.presets.filter((p) => p.id !== presetId);
    const activeId = props.imageCompression.activePresetId === presetId
      ? presets[0].id
      : props.imageCompression.activePresetId;
    updateCompression({ presets, activePresetId: activeId });
  });
}

function startEditing(presetId: string) {
  const preset = props.imageCompression.presets.find((p) => p.id === presetId);
  if (!preset) return;
  editingPresetId.value = presetId;
  editDraft.value = preset.name;
  nextTick(() => {
    const el = Array.isArray(editInputRef.value) ? editInputRef.value[0] : editInputRef.value;
    el?.focus();
    el?.select();
  });
}

function commitEdit() {
  const name = editDraft.value.trim();
  if (name && editingPresetId.value) {
    const presets = props.imageCompression.presets.map((p) =>
      p.id === editingPresetId.value ? { ...p, name } : p,
    );
    updateCompression({ presets });
  }
  editingPresetId.value = null;
}

function cancelEdit() {
  editingPresetId.value = null;
}

const debouncedQualityUpdate = debounce((q: number) => {
  updateActivePreset({ quality: q });
}, 300);

const debouncedScaleUpdate = debounce((s: number) => {
  updateActivePreset({ scalePercent: s });
}, 300);

function handleQualityInput(v: number | null) {
  const q = v === null ? 80 : Math.round(Math.min(100, Math.max(1, v)));
  debouncedQualityUpdate(q);
}

function handleScaleInput(v: number | null) {
  const s = v === null ? 100 : Math.round(Math.min(100, Math.max(1, v)));
  debouncedScaleUpdate(s);
}

function commitQualityInput() {
  debouncedQualityUpdate.cancel();
  const q = Math.round(Math.min(100, Math.max(1, activePreset.value.quality)));
  updateActivePreset({ quality: q });
}

function commitScaleInput() {
  debouncedScaleUpdate.cancel();
  const s = Math.round(Math.min(100, Math.max(1, activePreset.value.scalePercent ?? 100)));
  updateActivePreset({ scalePercent: s });
}

watch(
  () => activePreset.value.id,
  () => {
    const kb = activePreset.value.skipIfSmallerKB;
    skipUnit.value = (kb >= 1024 && kb % 1024 === 0) ? 'MB' : 'KB';
  },
  { immediate: true },
);

const skipDisplayValue = computed(() => {
  const kb = activePreset.value.skipIfSmallerKB;
  if (skipUnit.value === 'MB') {
    return Math.round((kb / 1024) * 10) / 10;
  }
  return kb;
});

function handleSkipValueChange(v: number | null) {
  const raw = v ?? 0;
  const kb = skipUnit.value === 'MB' ? Math.round(raw * 1024) : raw;
  updateActivePreset({ skipIfSmallerKB: kb });
}

function handleSkipUnitChange(newUnit: 'KB' | 'MB') {
  skipUnit.value = newUnit;
}

function toggleSkipUnit() {
  handleSkipUnitChange(skipUnit.value === 'KB' ? 'MB' : 'KB');
}

const qualityLevel = computed(() => {
  const q = activePreset.value.quality;
  if (q <= 30) return { label: '低', cls: 'quality-low' };
  if (q <= 60) return { label: '中', cls: 'quality-medium' };
  if (q <= 80) return { label: '良好', cls: 'quality-good' };
  return { label: '高', cls: 'quality-high' };
});

const scaleLevel = computed(() => {
  const s = activePreset.value.scalePercent ?? 100;
  if (s >= 100) return { label: '原图', cls: 'scale-original' };
  if (s >= 75) return { label: '轻微', cls: 'scale-light' };
  if (s >= 50) return { label: '适中', cls: 'scale-moderate' };
  return { label: '激进', cls: 'scale-heavy' };
});

const previewDialogVisible = ref(false);

function openPreviewDialog() {
  previewDialogVisible.value = true;
}
</script>

<template>
  <div class="compression-collapsible" :class="{ expanded }">
    <button class="collapsible-header" @click="toggleExpand">
      <div class="header-left">
        <span class="status-dot" :class="imageCompression.enabled ? 'active' : ''" v-tooltip.top="imageCompression.enabled ? '已启用' : '未启用'" />
        <div class="header-info">
          <span class="header-title">图片压缩</span>
          <span class="header-desc">{{ statusDesc }}</span>
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

    <div class="collapsible-content-wrapper">
      <div class="collapsible-content">
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
@import '../../styles/settings-shared.css';

/* --- Collapsible Container --- */

.compression-collapsible {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--settings-card-radius, 12px);
  overflow: hidden;
}

.collapsible-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-primary);
  text-align: left;
  transition: background 0.15s;
}

.collapsible-header:hover {
  background: var(--hover-overlay-subtle);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
  transition: all 0.2s ease;
  box-shadow: 0 0 0 2px var(--bg-card);
}

.status-dot.active {
  background: var(--success);
  box-shadow: 0 0 0 2px var(--bg-card), 0 0 6px var(--success-border);
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.header-title {
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.3;
}

.header-desc {
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.3;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* CSS Grid auto-height 动画 */
.collapsible-content-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.25s ease;
}

.expanded .collapsible-content-wrapper {
  grid-template-rows: 1fr;
}

.collapsible-content {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.expanded .collapsible-content {
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
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.preset-tab:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.preset-tab.active {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-alpha-8);
  text-shadow: 0 0 0.5px currentColor;
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
  font-size: 11px;
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
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: color 0.15s;
}

.delete-preset-btn:hover:not(:disabled) {
  color: var(--error);
}

.delete-preset-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.delete-preset-btn .pi {
  font-size: 11px;
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
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
  transition: all 0.2s;
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
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.format-tab:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.format-tab.active {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-alpha-8);
  text-shadow: 0 0 0.5px currentColor;
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
  font-size: 13px;
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
  transition: border-color 0.15s;
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
  font-size: 13px;
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
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.skip-unit-btn:hover {
  color: var(--primary);
  background: var(--primary-alpha-8);
}

.skip-unit-btn .pi {
  font-size: 10px;
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
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.preview-btn .pi {
  font-size: 11px;
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

@media (max-width: 900px) {
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
