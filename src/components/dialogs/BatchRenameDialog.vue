<template>
  <Dialog visible :modal="true" header="批量重命名" :style="{ width: '80vw' }">
    <div class="batch-rename-dialog">
      <div class="input-group">
        <label for="template">重命名模板</label>
        <InputText
          id="template"
          v-model="template"
          placeholder="例如: {date}_{index}{ext}"
          @input="onTemplateChange"
        />
        <small class="text-gray-500">可用变量: {date}, {time}, {index}, {original}, {filename}, {ext}, {name}</small>
      </div>

      <div class="suggestions">
        <label>推荐模板:</label>
        <Button
          v-for="suggestion in suggestions"
          :key="suggestion"
          :label="suggestion"
          severity="secondary"
          size="small"
          @click="template = suggestion"
        />
      </div>

      <div class="preview-table">
        <DataTable :value="previewData" stripedRows>
          <Column field="original" header="原文件名" />
          <Column field="renamed" header="新文件名" />
          <Column field="isValid" header="有效">
            <template #body="{ data }">
              <Tag v-if="data.isValid" value="✓" severity="success" />
              <Tag v-else value="✗" severity="danger" />
            </template>
          </Column>
        </DataTable>
      </div>
    </div>

    <template #footer>
      <Button label="取消" severity="secondary" @click="$emit('close')" />
      <Button label="应用重命名" :disabled="!isValid || hasErrors" @click="applyRename" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
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
  padding: 20px;
}

.input-group {
  margin-bottom: 20px;
}

.input-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
}

.suggestions {
  margin-bottom: 20px;
}

.suggestions label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
}

.suggestions :deep(.p-button) {
  margin-right: 8px;
  margin-bottom: 8px;
}

.preview-table {
  max-height: 400px;
  overflow-y: auto;
}
</style>
