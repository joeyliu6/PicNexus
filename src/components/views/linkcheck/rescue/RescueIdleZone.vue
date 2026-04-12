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
      <span class="idle-sub-text">支持 .md 和 .markdown 文件</span>
      <div class="idle-buttons">
        <Button label="选择文件" :loading="isAnalyzing || isChecking" class="idle-btn-primary" @click="emit('selectFile')" />
        <Button label="选择文件夹" severity="secondary" outlined :loading="isAnalyzing || isChecking" class="idle-btn-secondary" @click="emit('selectFolder')" />
      </div>
      <label class="idle-subfolder-option">
        <Checkbox :model-value="includeSubfolders" :binary="true" @update:model-value="emit('update:includeSubfolders', $event as boolean)" />
        <span>选择文件夹时包含子文件夹</span>
      </label>
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
  padding: 20px 40px 0 16px;
}

.idle-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  width: 100%;
  max-width: 480px;
  padding: 40px 40px 36px;
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
/* stylelint-disable-next-line declaration-property-value-allowed-list -- 空闲区域大图标，字号介于 --text-3xl(28) 与 --text-4xl(36) 之间，属无 token 特例 */
.idle-icon-wrap i { font-size: 32px; }

.idle-feature-desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0 0 var(--space-lg-xl);
  text-align: center;
  line-height: 1.5;
}

.idle-main-text {
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  color: var(--text-muted);
  margin-bottom: var(--space-xs-sm);
}

.idle-sub-text {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-bottom: 36px;
}

.idle-buttons {
  display: flex;
  align-items: flex-start;
  gap: var(--space-md);
  width: 100%;
  max-width: 360px;
}

.idle-btn-primary.p-button {
  flex: 1; padding: 11px 0; font-size: var(--text-base); font-weight: var(--weight-semibold); border-radius: var(--radius-md);
}

.idle-btn-secondary.p-button {
  flex: 1; padding: 11px 0; font-size: var(--text-base); font-weight: var(--weight-medium); border-radius: var(--radius-md);
  border-color: var(--border-subtle); color: var(--text-muted);
}

.idle-btn-secondary.p-button:hover { background: var(--hover-overlay-subtle); }

.idle-subfolder-option {
  display: flex; align-items: center; gap: var(--space-xs-sm); margin-top: var(--space-lg);
  font-size: var(--text-xs); color: var(--text-tertiary); cursor: pointer; user-select: none;
}
</style>
