<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="同步冲突"
    :style="{ width: '450px' }"
    :closable="true"
    :draggable="false"
    @hide="handleCancel"
  >
    <div class="flex flex-col gap-4">
      <!-- 冲突信息 -->
      <Message severity="warn" :closable="false">
        <template #icon>
          <i class="pi pi-exclamation-triangle" />
        </template>
        <span class="ml-2">{{ conflict?.message }}</span>
      </Message>

      <!-- 时间戳信息 -->
      <div class="text-sm text-surface-600 dark:text-surface-400">
        <p v-if="conflict?.localTimestamp" class="mb-1">
          <i class="pi pi-desktop mr-2" />
          本地最后同步: {{ formatTime(conflict.localTimestamp) }}
        </p>
        <p v-if="conflict?.remoteTimestamp">
          <i class="pi pi-cloud mr-2" />
          云端最后更新: {{ formatTime(conflict.remoteTimestamp) }}
        </p>
      </div>

      <Divider />

      <!-- 解决方式 -->
      <div class="text-sm font-medium mb-2">请选择解决方式：</div>

      <div class="flex flex-col gap-2">
        <!-- 使用本地数据 -->
        <Button
          label="使用本地数据（覆盖云端）"
          icon="pi pi-upload"
          severity="danger"
          outlined
          class="w-full justify-start"
          @click="handleResolve('use_local')"
        />

        <!-- 使用云端数据 -->
        <Button
          label="使用云端数据（覆盖本地）"
          icon="pi pi-download"
          severity="info"
          outlined
          class="w-full justify-start"
          @click="handleResolve('use_remote')"
        />

        <!-- 智能合并（仅历史记录） -->
        <Button
          v-if="conflict?.target === 'history'"
          label="智能合并（合并两边数据）"
          icon="pi pi-sync"
          severity="success"
          class="w-full justify-start"
          @click="handleResolve('merge')"
        />

        <!-- 取消 -->
        <Button
          label="取消"
          icon="pi pi-times"
          text
          class="w-full justify-start"
          @click="handleCancel"
        />
      </div>

      <!-- 提示信息 -->
      <div class="text-xs text-surface-500 dark:text-surface-500 mt-2">
        <p v-if="conflict?.target === 'settings'">
          <i class="pi pi-info-circle mr-1" />
          配置合并时会保留本地的 WebDAV 设置
        </p>
        <p v-else>
          <i class="pi pi-info-circle mr-1" />
          智能合并会根据时间戳保留较新的记录
        </p>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import Message from 'primevue/message';
import Divider from 'primevue/divider';
import type { SyncConflict, ConflictResolution } from '@/composables/useWebDAVSync';

// ==================== Props ====================

const props = defineProps<{
  /** 冲突信息，为 null 时隐藏对话框 */
  conflict: SyncConflict | null;
}>();

// ==================== Emits ====================

const emit = defineEmits<{
  /** 用户选择了解决方式 */
  (e: 'resolve', resolution: ConflictResolution): void;
  /** 用户取消 */
  (e: 'cancel'): void;
}>();

// ==================== 计算属性 ====================

const visible = computed(() => props.conflict !== null);

// ==================== 方法 ====================

/**
 * 处理解决方式选择
 */
function handleResolve(resolution: ConflictResolution): void {
  emit('resolve', resolution);
}

/**
 * 处理取消
 */
function handleCancel(): void {
  emit('cancel');
}

/**
 * 格式化时间戳
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
</script>

<style scoped>
/* 确保按钮文字左对齐 */
:deep(.p-button.justify-start) {
  justify-content: flex-start;
}

:deep(.p-button.justify-start .p-button-label) {
  flex: none;
}
</style>
