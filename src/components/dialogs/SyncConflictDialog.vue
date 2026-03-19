<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="同步冲突"
    :style="{ width: '460px' }"
    :closable="true"
    :draggable="false"
    @hide="handleCancel"
  >
    <div class="sync-conflict-content">
      <!-- 冲突徽章 -->
      <div class="conflict-badge">
        <i class="pi pi-exclamation-triangle" />
        <span>{{ conflict?.message || '检测到数据版本冲突' }}</span>
      </div>

      <!-- 双卡片对比 -->
      <div class="comparison-grid">
        <!-- 云端版本 -->
        <div class="version-card version-remote">
          <div class="version-header">
            <i class="pi pi-cloud" />
            <span>云端版本</span>
          </div>
          <div class="version-meta">
            <p v-if="conflict?.remoteTimestamp">
              修改时间: {{ formatTime(conflict.remoteTimestamp) }}
            </p>
          </div>
          <button class="version-action" @click="handleResolve('use_remote')">
            保留此版本
          </button>
        </div>

        <!-- 本地版本 -->
        <div class="version-card version-local">
          <div class="version-header">
            <i class="pi pi-desktop" />
            <span>本地版本</span>
          </div>
          <div class="version-meta">
            <p v-if="conflict?.localTimestamp">
              修改时间: {{ formatTime(conflict.localTimestamp) }}
            </p>
          </div>
          <button class="version-action version-action-primary" @click="handleResolve('use_local')">
            保留此版本
          </button>
        </div>
      </div>

      <!-- 智能合并（仅历史记录） -->
      <Button
        v-if="conflict?.target === 'history'"
        label="智能合并（合并两边数据）"
        icon="pi pi-sync"
        class="merge-btn"
        @click="handleResolve('merge')"
      />

      <!-- 提示 -->
      <div class="conflict-hint">
        <i class="pi pi-info-circle" />
        <span v-if="conflict?.target === 'settings'">配置合并时会保留本地的 WebDAV 设置</span>
        <span v-else>智能合并会根据时间戳保留较新的记录</span>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
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
.sync-conflict-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.conflict-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(234, 179, 8, 0.2);
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 700;
  color: var(--warning);
  align-self: flex-start;
}

.conflict-badge i {
  font-size: 13px;
}

.comparison-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.version-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 12px;
  border: none;
  background: var(--bg-input);
}

.version-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: white;
}

.version-header i {
  font-size: 16px;
}

.version-card:first-child .version-header i {
  color: #60a5fa;
}

.version-card:last-child .version-header i {
  color: #4ade80;
}

.version-meta {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

.version-action {
  width: 100%;
  padding: 8px;
  border-radius: 8px;
  border: none;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  background: var(--bg-button-secondary);
  color: white;
  margin-top: auto;
}

.version-action:hover {
  background: var(--bg-button-secondary-hover);
}

:deep(.merge-btn) {
  width: 100%;
  border-radius: 8px !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  padding: 12px 20px !important;
}

.conflict-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.conflict-hint i {
  font-size: 12px;
  opacity: 0.6;
}
</style>
