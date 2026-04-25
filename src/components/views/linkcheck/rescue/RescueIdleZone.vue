<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import RescueRecentList from './RescueRecentList.vue';
import RescueLastRepairCard from './RescueLastRepairCard.vue';
import { type MruEntry } from '../../../../composables/md-rescue/useMdRescueMru';
import { useLastRepair } from '../../../../composables/md-rescue/useMdRescueLastRepair';
import { createLogger } from '../../../../utils/logger';

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
        <div class="idle-zone__main">
          <div class="idle-zone__headline">
            <i class="idle-zone__icon pi pi-file-import" />
            <span class="idle-zone__text">
              <template v-if="isDragging">松开以载入</template>
              <template v-else>拖入文件夹或 Markdown 文件</template>
            </span>
          </div>
          <div class="idle-zone__actions" @click.stop>
            <button
              type="button"
              class="idle-secondary-link"
              :disabled="isAnalyzing || isChecking"
              @click="emit('selectFile')"
            >
              选择单个文件
            </button>
            <Button
              label="选择文件夹"
              :loading="isAnalyzing || isChecking"
              class="idle-btn-primary"
              @click="emit('selectFolder')"
            />
          </div>
        </div>
      </div>
      <div class="option-row-group">
        <label
          class="subfolder-option-row"
          @click.stop
        >
          <Checkbox
            :model-value="includeSubfolders"
            :binary="true"
            @update:model-value="emit('update:includeSubfolders', $event as boolean)"
          />
          <i class="pi pi-folder subfolder-option-row__icon" aria-hidden="true" />
          <span>包含子文件夹</span>
        </label>
        <label class="subfolder-option-row" @click.stop>
          <Checkbox
            :model-value="includeCodeBlocks"
            :binary="true"
            @update:model-value="emit('update:includeCodeBlocks', $event as boolean)"
          />
          <span>包含代码块内的图片链接</span>
        </label>
      </div>
    </div>

    <RescueRecentList
      :disabled="isAnalyzing || isChecking"
      @pick="emit('pickRecent', $event)"
    />

    <RescueLastRepairCard v-if="lastRepairRecord" />
    <div v-else class="last-repair-empty">
      <i class="pi pi-history" />
      <span>还没有修复记录 · 从上方拖入文件即可开始</span>
    </div>

    <div class="scope-hint">
      <i class="pi pi-info-circle scope-hint__icon" />
      <span>仅修复 PicNexus 上传过的图片，修复前自动备份、随时可撤销</span>
    </div>
  </div>
</template>

<style scoped>
.rescue-idle {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: var(--space-lg-xl);
  width: 100%;
  max-width: 850px;
  height: 100%;
  margin: 0 auto;
  padding: var(--space-lg-xl) var(--space-lg-xl) var(--space-lg-xl) 0;
  overflow-y: auto;
}

.idle-zone {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-3xl) var(--space-xl);
  background: var(--bg-card);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1.5px 在"虚线细"和"可见度"之间取折中，token 仅有 1/2/3px */
  border: 1.5px dashed var(--border-subtle);
  border-radius: var(--radius-lg);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    border-color var(--duration-medium),
    background var(--duration-medium);
}

.idle-zone__main {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  gap: var(--space-md);
  width: 100%;
  min-height: 36px;
}

.idle-zone__headline {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: var(--space-sm-md);
  min-width: 0;
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

.idle-zone__icon {
  font-size: var(--text-xl);
  color: var(--primary);
  flex-shrink: 0;
  transition: transform var(--duration-medium) ease;
}

.idle-zone.dragging .idle-zone__icon,
.rescue-idle.dragging .idle-zone__icon { transform: translateY(-2px) scale(1.1); }

.option-row-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.idle-zone-wrapper {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 100%;
  flex-shrink: 0;
}

.subfolder-option-row {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: var(--space-sm);
  padding: var(--space-xs-sm) var(--space-sm-md);
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.subfolder-option-row:hover {
  color: var(--text-main);
  border-color: var(--primary);
}

.subfolder-option-row__icon {
  font-size: var(--text-xs);
  color: var(--primary);
  flex-shrink: 0;
}

.idle-zone__text {
  min-width: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  line-height: var(--leading-tight);
  letter-spacing: 0.01em;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.idle-zone__actions {
  display: flex;
  align-items: center;
  justify-self: end;
  gap: var(--space-sm);
}

.idle-btn-primary.p-button {
  height: 32px; padding: 0 var(--space-md); font-size: var(--text-sm); font-weight: var(--weight-semibold);
  border-radius: var(--radius-sm-md);
  background: var(--primary-alpha-15); border-color: transparent; color: var(--primary);
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}

.idle-btn-primary.p-button:hover { background: var(--primary-alpha-15); filter: brightness(0.94); }
.idle-btn-primary.p-button:active { background: var(--primary-alpha-15); filter: brightness(0.88); }
.idle-btn-primary.p-button:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.idle-secondary-link {
  padding: var(--space-2xs) var(--space-xs);
  background: transparent;
  border: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast) var(--ease-standard);
}

.idle-secondary-link:hover:not(:disabled) { color: var(--primary); }
.idle-secondary-link:disabled { opacity: 0.5; cursor: not-allowed; }
.idle-secondary-link:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.last-repair-empty {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  background: var(--primary-alpha-8);
  border: 1px dashed var(--primary-alpha-30);
  border-radius: var(--radius-md);
}

.last-repair-empty i {
  font-size: var(--text-base);
  color: var(--primary);
  flex-shrink: 0;
}

/* 底部一行功能提示：合并原两行 + 去除关闭按钮 */
.scope-hint {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm-md) var(--space-md);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--success);
  background: var(--success-alpha-8);
  border: 1px solid var(--success-border);
  border-radius: var(--radius-md);
  width: 100%;
}

.scope-hint__icon {
  font-size: var(--text-base);
  color: var(--success);
  flex-shrink: 0;
}

</style>
