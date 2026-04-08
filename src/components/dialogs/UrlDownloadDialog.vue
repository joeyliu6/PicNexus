<template>
  <Dialog
    :visible="visible"
    :modal="true"
    header="从 URL 下载图片"
    :style="{ width: 'var(--dialog-width-md)' }"
    :draggable="false"
    @update:visible="handleClose"
  >
    <div class="url-download-dialog">
      <div class="field">
        <label class="section-label">图片 URL（每行一个）</label>
        <Textarea
          v-model="urlInput"
          placeholder="https://example.com/image.jpg"
          :rows="5"
          class="url-textarea"
          :disabled="isDownloading"
          @keydown="handleKeydown"
        />
      </div>

      <div class="dialog-note">
        <i class="pi pi-info-circle" />
        <span>支持 JPG、PNG、GIF、WEBP、BMP 格式，Ctrl+Enter 快捷提交</span>
      </div>
    </div>

    <template #footer>
      <Button
        label="取消"
        severity="secondary"
        outlined
        class="dialog-btn-reject"
        :disabled="isDownloading"
        @click="handleClose"
      />
      <Button
        :label="isDownloading ? '正在下载...' : '下载并上传'"
        :icon="isDownloading ? 'pi pi-spin pi-spinner' : 'pi pi-download'"
        class="dialog-btn-accept"
        :disabled="!urlInput.trim() || isDownloading"
        @click="handleConfirm"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import Textarea from 'primevue/textarea';

interface Props {
  visible: boolean;
  isDownloading: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  confirm: [input: string];
}>();

const urlInput = ref('');

watch(() => props.visible, async (val) => {
  if (val) {
    urlInput.value = '';
    await nextTick();
    const el = document.querySelector('.url-textarea') as HTMLTextAreaElement | null;
    el?.focus();
  }
});

function handleConfirm() {
  const trimmed = urlInput.value.trim();
  if (!trimmed) return;
  emit('confirm', trimmed);
}

function handleClose() {
  emit('update:visible', false);
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    handleConfirm();
  }
}
</script>

<style scoped>
.url-download-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

/* PrimeVue Textarea 直接渲染为 <textarea>，class 在元素自身上 */
.field :deep(.url-textarea) {
  width: 100%;
  border-radius: 8px;
  background: var(--bg-input);
  border: none;
  padding: 12px 16px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  resize: vertical;
  line-height: 1.6;
}

:root.light-theme .field :deep(.url-textarea) {
  background: var(--bg-input);
  color: var(--text-main);
}

.field :deep(.url-textarea:focus) {
  box-shadow: none;
  outline: none;
}

.field :deep(.url-textarea::placeholder) {
  color: var(--text-muted);
  opacity: 0.6;
}

.dialog-note {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.dialog-note i {
  font-size: 12px;
  flex-shrink: 0;
  margin-top: 2px;
  opacity: 0.7;
}

/* 按钮样式 - 对齐 BatchRenameDialog / BackupPasswordDialog */
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
