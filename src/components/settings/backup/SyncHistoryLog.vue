<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { historyDB, type SyncLogEntry, type SyncLogOperation } from '../../../services/HistoryDatabase';
import { useConfirm } from '../../../composables/useConfirm';

const entries = ref<SyncLogEntry[]>([]);
const { confirm } = useConfirm();

async function load() {
  entries.value = await historyDB.getSyncLogs(20);
}

async function handleClear() {
  const confirmed = await confirm('确定清空所有操作历史记录？', '清空历史');
  if (!confirmed) return;
  await historyDB.clearSyncLogs();
  entries.value = [];
}

function refresh() {
  load();
}

defineExpose({ refresh });

onMounted(load);

// ==================== 操作元信息 ====================

interface OpMeta {
  icon: string;
  label: string;
  color: string;
}

const OP_META: Record<SyncLogOperation, OpMeta> = {
  export_settings_local:   { icon: 'pi-upload',        label: '导出配置到本地',  color: 'var(--text-muted)' },
  import_settings_local:   { icon: 'pi-download',      label: '从本地导入配置',  color: 'var(--text-muted)' },
  export_history_local:    { icon: 'pi-upload',        label: '导出历史到本地',  color: 'var(--text-muted)' },
  import_history_local:    { icon: 'pi-download',      label: '从本地导入历史',  color: 'var(--text-muted)' },
  upload_settings_cloud:   { icon: 'pi-cloud-upload',  label: '上传配置到云端',  color: 'var(--primary)' },
  download_settings_cloud: { icon: 'pi-cloud-download', label: '从云端下载配置', color: 'var(--primary)' },
  sync_settings:           { icon: 'pi-arrows-v',      label: '双向同步配置',   color: 'var(--primary)' },
  upload_history_cloud:    { icon: 'pi-cloud-upload',  label: '上传记录到云端',  color: 'var(--primary)' },
  download_history_cloud:  { icon: 'pi-cloud-download', label: '从云端下载记录', color: 'var(--primary)' },
  sync_history:            { icon: 'pi-arrows-v',      label: '双向同步记录',   color: 'var(--primary)' },
};

function getOpMeta(op: SyncLogOperation): OpMeta {
  return OP_META[op] ?? { icon: 'pi-sync', label: op };
}

function isCloudOp(op: SyncLogOperation): boolean {
  return op.endsWith('_cloud') || op.startsWith('sync_');
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 2) return '昨天 ' + new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (days < 7) return `${days} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
    + ' ' + new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div class="sync-history-log">
    <div v-if="entries.length > 0" class="log-header">
      <span class="log-title">最近 {{ entries.length }} 条</span>
      <button class="clear-btn" @click="handleClear">清空</button>
    </div>

    <div v-if="entries.length > 0" class="log-divider" />

    <!-- 空状态 -->
    <div v-if="entries.length === 0" class="log-empty">
      <i class="pi pi-inbox empty-icon" />
      <span>暂无记录</span>
    </div>

    <!-- 记录列表 -->
    <template v-else>
      <div
        v-for="(entry, index) in entries"
        :key="entry.id"
        class="log-row-wrapper"
      >
        <div class="log-row">
          <i
            :class="['pi', getOpMeta(entry.operation).icon, 'op-icon']"
            :style="{ color: getOpMeta(entry.operation).color }"
          />

          <div class="row-info">
            <div class="row-main">
              <span class="op-label">{{ getOpMeta(entry.operation).label }}</span>
              <span
                v-if="isCloudOp(entry.operation) && entry.profileName"
                class="source-name"
              >· {{ entry.profileName }}</span>
            </div>
            <div class="row-meta">
              <span class="row-time">{{ formatRelativeTime(entry.timestamp) }}</span>
              <span v-if="entry.details && entry.result === 'success'" class="row-details-inline">
                · {{ entry.details }}
              </span>
            </div>
          </div>

          <i v-if="entry.result === 'success'" class="pi pi-check result-icon result-success" />
          <i
            v-else
            v-tooltip.left="{ value: entry.details || '操作失败', class: 'sync-error-tooltip' }"
            class="pi pi-exclamation-circle result-icon result-failed"
          />
        </div>

        <div v-if="index < entries.length - 1" class="row-divider" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.sync-history-log {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

/* ===== 头部 ===== */
.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px;
}

.log-title {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}

.clear-btn {
  font-size: 12px;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast), background var(--duration-fast);
}

.clear-btn:hover {
  color: var(--error);
  background: var(--error-soft);
}

/* ===== 分隔线 ===== */
.log-divider,
.row-divider {
  height: 1px;
  background: var(--border-subtle);
}

/* ===== 空状态 ===== */
.log-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 0;
  color: var(--text-muted);
  font-size: 13px;
}

.empty-icon {
  font-size: 20px;
  opacity: 0.4;
}

/* ===== 行 ===== */
.log-row-wrapper {
  /* 包装器，用于附加错误详情 */
}

.log-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 18px;
}

/* ===== 操作图标 ===== */
.op-icon {
  flex-shrink: 0;
  font-size: 15px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--bg-input);
}

/* ===== 行内容 ===== */
.row-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.row-main {
  display: flex;
  align-items: center;
  gap: 6px;
}

.op-label {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
}

.source-name {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

.row-meta {
  display: flex;
  align-items: center;
  gap: 4px;
}

.row-time {
  font-size: 11px;
  color: var(--text-muted);
}

.row-details-inline {
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 结果图标 ===== */
.result-icon {
  flex-shrink: 0;
  font-size: 14px;
}

.result-success {
  color: var(--success);
}

.result-failed {
  color: var(--error);
  cursor: help;
}
</style>

<!-- tooltip 渲染在 body 上，scoped 无法覆盖，需要全局样式 -->
<style>
.sync-error-tooltip.p-tooltip .p-tooltip-text {
  max-width: 320px;
  white-space: normal;
  word-break: break-word;
}
</style>
