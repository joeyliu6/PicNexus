<template>
  <Dialog
    visible
    :modal="true"
    header="批量重命名"
    :style="{ width: '460px' }"
    :draggable="false"
  >
    <div class="batch-rename-dialog">
      <div class="template-section">
        <label for="template" class="section-label">重命名模板</label>
        <InputText
          id="template"
          v-model="template"
          placeholder="例如: {date}_{index}{ext}"
          class="template-input"
          @input="onTemplateChange"
        />
        <div class="variable-chips">
          <span
            v-for="v in availableVars"
            :key="v"
            class="var-chip"
            @click="insertVariable(v)"
          >{{ v }}</span>
        </div>
      </div>

      <div v-if="suggestions.length" class="suggestions">
        <label class="section-label">推荐模板</label>
        <div class="suggestion-chips">
          <span
            v-for="suggestion in suggestions"
            :key="suggestion"
            class="suggestion-chip"
            @click="template = suggestion; onTemplateChange()"
          >{{ suggestion }}</span>
        </div>
      </div>

      <div v-if="previewData.length" class="preview-section">
        <label class="section-label">预览</label>
        <div class="preview-list">
          <div
            v-for="item in previewData.slice(0, 5)"
            :key="item.original"
            class="preview-row"
          >
            <span class="preview-original">{{ item.original }}</span>
            <i class="pi pi-arrow-right preview-arrow" />
            <span class="preview-renamed" :class="{ invalid: !item.isValid }">{{ item.renamed }}</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <Button label="取消" severity="secondary" outlined class="dialog-btn-reject" @click="$emit('close')" />
      <Button label="应用重命名" :disabled="!isValid || hasErrors" class="dialog-btn-accept" @click="applyRename" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import {
  previewRename,
  validateTemplate,
  generateBatchRenameSuggestion
} from '@/utils/renameUtils';

const props = defineProps<{
  visible: boolean;
  files: string[];
  startIndex?: number;
}>();

const emit = defineEmits<{
  close: [];
  apply: [renamedFiles: Map<string, string>];
}>();

const template = ref('{date}_{index}{ext}');
const suggestions = ref<string[]>([]);
const previewData = ref<any[]>([]);
const availableVars = ['{date}', '{time}', '{index}', '{original}', '{filename}', '{ext}', '{name}'];

function insertVariable(v: string) {
  template.value += v;
  onTemplateChange();
}

const isValid = computed(() => validateTemplate(template.value).valid);
const hasErrors = computed(() => previewData.value.some((d: any) => !d.isValid));

function onTemplateChange() {
  if (props.files.length > 0) {
    const start = props.startIndex || 0;
    previewData.value = previewRename(props.files, template.value, start);
  }
}

function applyRename() {
  if (!isValid.value || hasErrors.value) return;

  const renamedMap = new Map<string, string>();
  previewData.value.forEach((item: any) => {
    if (item.isValid) {
      renamedMap.set(item.original, item.renamed);
    }
  });

  emit('apply', renamedMap);
  emit('close');
}

watch(() => props.files, (newFiles) => {
  if (newFiles.length > 0) {
    suggestions.value = generateBatchRenameSuggestion(newFiles);
    onTemplateChange();
  }
}, { immediate: true });
</script>

<style scoped>
.batch-rename-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.template-section :deep(.template-input) {
  width: 100%;
  border-radius: 8px;
  background: var(--bg-input);
  border: none;
  padding: 12px 16px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: white;
}

:root.light-theme .template-section :deep(.template-input) {
  background: #f1f5f9;
  color: #111827;
}

.template-section :deep(.template-input:focus) {
  box-shadow: 0 0 0 1px var(--primary);
}

.variable-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.var-chip {
  padding: 4px 12px;
  background: var(--primary-alpha-10);
  color: var(--primary);
  font-size: 12px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: var(--font-mono);
}

.var-chip:hover {
  background: var(--primary-alpha-15);
}

.suggestion-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.suggestion-chip {
  padding: 4px 12px;
  background: var(--bg-button-secondary);
  color: var(--text-secondary);
  font-size: 12px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: var(--font-mono);
}

.suggestion-chip:hover {
  background: var(--bg-button-secondary-hover);
  color: var(--text-primary);
}

.preview-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  background: var(--bg-input);
  border-radius: 8px;
}

.preview-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.preview-original {
  color: var(--text-muted);
  flex-shrink: 0;
}

.preview-arrow {
  color: var(--text-muted);
  font-size: 10px;
  opacity: 0.5;
}

.preview-renamed {
  color: var(--primary);
  font-family: var(--font-mono);
}

.preview-renamed.invalid {
  color: var(--error);
}

:deep(.dialog-btn-reject) {
  flex: 1;
  border-radius: 8px !important;
  padding: 12px 20px !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  background: var(--bg-button-secondary) !important;
  border: none !important;
  color: white !important;
}

:deep(.dialog-btn-reject:hover) {
  background: var(--bg-button-secondary-hover) !important;
}

:deep(.dialog-btn-accept) {
  flex: 1;
  border-radius: 8px !important;
  padding: 12px 20px !important;
  font-size: 14px !important;
  font-weight: 600 !important;
}
</style>
