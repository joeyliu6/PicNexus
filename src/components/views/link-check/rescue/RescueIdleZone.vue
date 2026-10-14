<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import RescueRecentList from './RescueRecentList.vue';
import RescueLastRepairCard from './RescueLastRepairCard.vue';
import { type MruEntry } from '@/composables/md-rescue/useMdRescueMru';
import { useLastRepair } from '@/composables/md-rescue/useMdRescueLastRepair';
import { createLogger } from '@/utils/logger';

const log = createLogger('MdRescue');

const props = defineProps<{
  isAnalyzing: boolean;
  isChecking: boolean;
  includeSubfolders: boolean;
  includeCodeBlocks: boolean;
}>();

const emit = defineEmits<{
  (e: 'selectFile'): void;
  (e: 'selectFolder'): void;
  (e: 'selectAny'): void;
  (e: 'update:includeSubfolders', val: boolean): void;
  (e: 'update:includeCodeBlocks', val: boolean): void;
  (e: 'dropPaths', paths: string[]): void;
  (e: 'pickRecent', entry: MruEntry): void;
}>();

const isDragging = ref(false);
const isViewActive = ref(true);
let dropUnlisten: (() => void) | null = null;
// 卸载标志：若异步 onDragDropEvent 在 unmount 之后才 resolve，需立即 unlisten 防止监听器泄漏
let isUnmounted = false;

const { record: lastRepairRecord } = useLastRepair();

function handleZoneClick() {
  if (props.isAnalyzing || props.isChecking) return;
  emit('selectAny');
}

async function setupDropListener() {
  try {
    const webview = getCurrentWebview();
    const unlisten = await webview.onDragDropEvent(async (event) => {
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
    if (isUnmounted) {
      unlisten();
      return;
    }
    dropUnlisten = unlisten;
  } catch (err) {
    log.error('设置拖放监听失败', err);
  }
}

onMounted(() => { setupDropListener(); });
onBeforeUnmount(() => {
  isUnmounted = true;
  dropUnlisten?.();
});
onActivated(() => { isViewActive.value = true; });
onDeactivated(() => { isViewActive.value = false; });
</script>

<template>
  <div class="rescue-idle" :class="{ dragging: isDragging }">
    <div class="idle-zone-wrapper">
      <div class="idle-zone" :class="{ dragging: isDragging }" @click="handleZoneClick">
        <div class="idle-zone__icon-wrap">
          <i class="idle-zone__icon pi pi-file-import" />
        </div>
        <span class="idle-zone__text">
          <template v-if="isDragging">松开就开始检查</template>
          <template v-else>把 Markdown 文件或文件夹拖到这里</template>
        </span>
        <span class="idle-zone__desc">
          找出文档里打不开的图片，换成你在其他图床上的备份
        </span>
        <div class="idle-zone__actions" @click.stop>
          <Button
            label="选择文件夹"
            icon="pi pi-folder-open"
            :loading="isAnalyzing || isChecking"
            class="idle-btn-primary"
            @click="emit('selectFolder')"
          />
          <button
            type="button"
            class="idle-secondary-link"
            :disabled="isAnalyzing || isChecking"
            @click="emit('selectFile')"
          >
            选择单个文件
          </button>
        </div>
      </div>
      <div class="option-row-group">
        <label class="subfolder-option-row" @click.stop>
          <Checkbox
            :model-value="includeSubfolders"
            :binary="true"
            @update:model-value="emit('update:includeSubfolders', $event as boolean)"
          />
          <span>包含子文件夹</span>
        </label>
        <label
          class="subfolder-option-row"
          v-tooltip.top="'代码块里的图片链接通常是示例代码，默认不检查'"
          @click.stop
        >
          <Checkbox
            :model-value="includeCodeBlocks"
            :binary="true"
            @update:model-value="emit('update:includeCodeBlocks', $event as boolean)"
          />
          <span>包含代码块里的图片</span>
        </label>
        <span class="scope-hint">只修复用 PicNexus 上传过的图片 · 修改前自动备份，可撤销</span>
      </div>
    </div>

    <RescueLastRepairCard v-if="lastRepairRecord" />

    <RescueRecentList
      :disabled="isAnalyzing || isChecking"
      @pick="emit('pickRecent', $event)"
    />
  </div>
</template>

<style scoped>
.rescue-idle {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: var(--space-xl);
  width: 100%;
  max-width: 850px;
  height: 100%;
  margin: 0 auto;
  padding: var(--space-lg-xl) var(--space-lg-xl) var(--space-lg-xl) 0;
  overflow-y: auto;
}

.idle-zone-wrapper {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: 100%;
  flex-shrink: 0;
}

.idle-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-2xl) var(--space-xl);
  background: var(--bg-card);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1.5px 在"虚线细"和"可见度"之间取折中，token 仅有 1/2/3px */
  border: 1.5px dashed var(--border-subtle);
  border-radius: var(--radius-lg);
  text-align: center;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    border-color var(--duration-medium),
    background var(--duration-medium);
}

.idle-zone:hover {
  border-color: var(--primary);
  background: var(--primary-alpha-5);
}

.idle-zone.dragging,
.rescue-idle.dragging .idle-zone {
  border-color: var(--primary);
  background: var(--primary-alpha-10);
  border-style: solid;
}

.idle-zone__icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: var(--space-xs);
  border-radius: 50%;
  background: var(--primary-alpha-10);
  transition: transform var(--duration-medium) var(--ease-standard);
}

.idle-zone__icon {
  font-size: var(--text-2xl);
  color: var(--primary);
}

.idle-zone.dragging .idle-zone__icon-wrap,
.rescue-idle.dragging .idle-zone__icon-wrap { transform: translateY(-2px) scale(1.08); }

.idle-zone__text {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  color: var(--text-main);
}

.idle-zone__desc {
  max-width: 460px;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--text-muted);
}

.idle-zone__actions {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-top: var(--space-sm);
}

.idle-btn-primary.p-button {
  height: 34px;
  padding: 0 var(--space-lg);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  border-radius: var(--radius-md);
}

.idle-btn-primary.p-button:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.idle-secondary-link {
  padding: var(--space-xs) var(--space-sm);
  background: transparent;
  border: 0;
  font-family: inherit;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast) var(--ease-standard);
}

.idle-secondary-link:hover:not(:disabled) { color: var(--primary); }
.idle-secondary-link:disabled { opacity: 0.5; cursor: not-allowed; }
.idle-secondary-link:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.option-row-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-lg);
  padding: 0 var(--space-xs);
}

.subfolder-option-row {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  transition: color var(--duration-fast) var(--ease-standard);
}

.subfolder-option-row:hover {
  color: var(--text-main);
}

.scope-hint {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
