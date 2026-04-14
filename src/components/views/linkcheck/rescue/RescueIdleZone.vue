<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import { createLogger } from '../../../../utils/logger';

const log = createLogger('MdRescue');

defineProps<{
  isAnalyzing: boolean;
  isChecking: boolean;
  includeSubfolders: boolean;
}>();

const emit = defineEmits<{
  (e: 'selectFile'): void;
  (e: 'selectFolder'): void;
  (e: 'update:includeSubfolders', val: boolean): void;
  (e: 'dropPaths', paths: string[]): void;
}>();

const isDragging = ref(false);
const isViewActive = ref(true);
let dropUnlisten: (() => void) | null = null;

async function setupDropListener() {
  try {
    const webview = getCurrentWebview();
    dropUnlisten = await webview.onDragDropEvent(async (event) => {
      if (!isViewActive.value) return;
      if (event.payload.type === 'over') {
        isDragging.value = true;
      } else if (event.payload.type === 'drop') {
        isDragging.value = false;
        emit('dropPaths', event.payload.paths);
      } else {
        isDragging.value = false;
      }
    });
  } catch (err) {
    log.error('设置拖放监听失败', err);
  }
}

onMounted(() => { setupDropListener(); });
onBeforeUnmount(() => { dropUnlisten?.(); });
onActivated(() => { isViewActive.value = true; });
onDeactivated(() => { isViewActive.value = false; });
</script>

<template>
  <div class="rescue-idle">
    <div class="idle-zone" :class="{ dragging: isDragging }">
      <div class="idle-icon-wrap"><i class="pi pi-upload" /></div>
      <p class="idle-feature-desc">扫描文档中的图片链接，检测失效并从历史备用链接自动修复</p>
      <span class="idle-main-text">拖放 Markdown 文件到此处</span>
      <div class="idle-buttons">
        <Button label="选择文件" :loading="isAnalyzing || isChecking" class="idle-btn-primary" @click="emit('selectFile')" />
        <div class="idle-folder-col">
          <Button label="选择文件夹" severity="secondary" outlined :loading="isAnalyzing || isChecking" class="idle-btn-secondary" @click="emit('selectFolder')" />
          <label class="idle-subfolder-option">
            <Checkbox :model-value="includeSubfolders" :binary="true" @update:model-value="emit('update:includeSubfolders', $event as boolean)" />
            <span>包含子文件夹</span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rescue-idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--space-2xl) var(--space-3xl);
}

.idle-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  width: 100%;
  max-width: 480px;
  padding: var(--space-3xl) var(--space-3xl) var(--space-2xl);
  border: 2px dashed var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: default;
  transition: border-color var(--duration-medium), background var(--duration-medium);
}

.idle-zone:hover { border-color: var(--primary-alpha-40); }

.idle-zone.dragging {
  border-color: var(--primary);
  background: var(--primary-alpha-5);
  border-style: solid;
}

.idle-icon-wrap {
  margin-bottom: var(--space-lg-xl);
  color: var(--primary);
  transition: transform var(--duration-medium) ease;
}

.idle-zone.dragging .idle-icon-wrap { transform: translateY(-4px) scale(1.1); }
.idle-icon-wrap i { font-size: var(--text-4xl); }

.idle-feature-desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0 0 var(--space-lg-xl);
  text-align: center;
  line-height: 1.5;
}

.idle-main-text {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  margin-bottom: var(--space-2xl);
}

.idle-buttons {
  display: flex;
  align-items: flex-start;
  gap: var(--space-md);
  width: 100%;
  max-width: 360px;
}

.idle-btn-primary.p-button {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 11px 无精确 spacing token */
  flex: 1; padding: 11px 0; font-size: var(--text-base); font-weight: var(--weight-semibold); border-radius: var(--radius-md);
  background: var(--primary-alpha-40); border-color: transparent; color: var(--primary);
}

.idle-btn-primary.p-button:hover { background: var(--primary-alpha-40); opacity: 0.85; }

.idle-btn-secondary.p-button {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 11px 无精确 spacing token */
  width: 100%; padding: 11px 0; font-size: var(--text-base); font-weight: var(--weight-medium); border-radius: var(--radius-md);
  border-color: var(--border-subtle); color: var(--text-muted);
}

.idle-btn-secondary.p-button:hover { background: var(--hover-overlay-subtle); }

.idle-folder-col {
  display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-xs); flex: 1;
}

.idle-subfolder-option {
  display: flex; align-items: center; gap: var(--space-xs-sm);
  font-size: var(--text-xs); color: var(--text-tertiary); cursor: pointer; user-select: none;
}
</style>
