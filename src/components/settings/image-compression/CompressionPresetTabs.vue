<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import type { CompressionPreset } from '../../../config/types';

interface Props {
  presets: CompressionPreset[];
  activePresetId: string;
  editingPresetId: string | null;
  editDraft: string;
  canAddPreset: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  'update:editDraft': [value: string];
  select: [presetId: string];
  add: [];
  startEdit: [presetId: string];
  commitEdit: [];
  cancelEdit: [];
  editInputMount: [el: HTMLInputElement | null];
}>();

function onEditInputRef(el: Element | ComponentPublicInstance | null) {
  emit('editInputMount', el as HTMLInputElement | null);
}

function onEditInput(e: Event) {
  const target = e.target as HTMLInputElement;
  emit('update:editDraft', target.value.trim());
}
</script>

<template>
  <div class="preset-tab-row">
    <div
      v-for="preset in presets"
      :key="preset.id"
      class="preset-tab"
      :class="{ active: activePresetId === preset.id, editing: editingPresetId === preset.id }"
      v-tooltip.top="editingPresetId !== preset.id ? '双击重命名' : undefined"
    >
      <span
        class="preset-tab-label"
        :style="editingPresetId === preset.id ? { visibility: 'hidden' } : {}"
        @click="emit('select', preset.id)"
        @dblclick="emit('startEdit', preset.id)"
      >{{ editingPresetId === preset.id ? editDraft : preset.name }}</span>
      <input
        v-if="editingPresetId === preset.id"
        :ref="onEditInputRef"
        :value="editDraft"
        class="preset-tab-input"
        @input="onEditInput"
        @blur="emit('commitEdit')"
        @keyup.enter="emit('commitEdit')"
        @keyup.escape="emit('cancelEdit')"
      />
    </div>
    <button
      class="preset-tab add-tab"
      :class="{ disabled: !canAddPreset }"
      v-tooltip.top="canAddPreset ? '新建方案' : '最多支持 5 个方案'"
      @click="emit('add')"
    >
      <i class="pi pi-plus" />
    </button>
  </div>
</template>

<style scoped>
@import url('../../../styles/settings-shared.css');

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
</style>
