<script setup lang="ts">
import { ref, toRef, inject, watch, onMounted, type Ref } from 'vue';

import type { ImageCompressionConfig } from '../../config/types';
import { useCompressionPresets } from '../../composables/settings/useCompressionPresets';
import CompressionPreviewDialog from '../dialogs/CompressionPreviewDialog.vue';
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue';
import CompressionPresetTabs from './image-compression/CompressionPresetTabs.vue';
import CompressionSettingsForm from './image-compression/CompressionSettingsForm.vue';

interface Props {
  imageCompression: ImageCompressionConfig;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:imageCompression': [config: ImageCompressionConfig];
}>();

const expanded = ref(false);

// 外部跳转自动展开：当上游 set settingsTargetSection='imageCompression' 时主动展开本卡片
const settingsTargetSection = inject<Ref<string | null> | null>('settingsTargetSection', null);

function applyTargetSection() {
  if (settingsTargetSection?.value === 'imageCompression') {
    expanded.value = true;
    settingsTargetSection.value = null;
  }
}

onMounted(applyTargetSection);
if (settingsTargetSection) {
  watch(settingsTargetSection, applyTargetSection);
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

function toggleEnabled(v: boolean) {
  updateCompression({ enabled: v });
}

const previewDialogVisible = ref(false);

function openPreviewDialog() {
  previewDialogVisible.value = true;
}

function handleEditInputMount(el: HTMLInputElement | null) {
  editInputRef.value = el;
}
</script>

<template>
  <CollapsibleSettingsCard
    title="图片压缩"
    :description="statusDesc"
    :enabled="imageCompression.enabled"
    :expanded="expanded"
    @update:enabled="toggleEnabled"
    @update:expanded="(v: boolean) => expanded = v"
  >
    <CompressionPresetTabs
      :presets="imageCompression.presets"
      :activePresetId="imageCompression.activePresetId"
      :editingPresetId="editingPresetId"
      :editDraft="editDraft"
      :canAddPreset="canAddPreset"
      @update:editDraft="(v) => editDraft = v"
      @select="selectPreset"
      @add="addPreset"
      @startEdit="startEditing"
      @commitEdit="commitEdit"
      @cancelEdit="cancelEdit"
      @editInputMount="handleEditInputMount"
    />

    <CompressionSettingsForm
      :activePreset="activePreset"
      :qualityLevel="qualityLevel"
      :scaleLevel="scaleLevel"
      :skipDisplayValue="skipDisplayValue"
      :skipUnit="skipUnit"
      @updatePreset="updateActivePreset"
      @qualityInput="handleQualityInput"
      @commitQuality="commitQualityInput"
      @scaleInput="handleScaleInput"
      @commitScale="commitScaleInput"
      @skipValueChange="handleSkipValueChange"
      @toggleSkipUnit="toggleSkipUnit"
    />

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
  </CollapsibleSettingsCard>
</template>

<style scoped>
@import url('../../styles/settings-shared.css');

/* --- Preset Actions --- */

.preset-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
  padding: var(--space-sm) var(--space-lg) var(--space-md);
}

.delete-preset-btn {
  margin: 0;
  padding: var(--space-xs) 0;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: var(--text-xs);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
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
  font-size: var(--text-xs);
}

/* --- Compression Preview --- */

.preview-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  padding: var(--space-xs) var(--space-md-lg);
  border: 1px solid var(--primary-alpha-15);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 全圆角药丸形，无对应 radius token */
  border-radius: 999px;
  background: var(--primary-alpha-8);
  color: var(--primary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: all var(--duration-fast);
  flex-shrink: 0;
}

.preview-btn .pi {
  font-size: var(--text-xs);
  line-height: 1;
}

.preview-btn:hover:not(:disabled) {
  background: var(--primary-alpha-12);
}

.preview-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

</style>
