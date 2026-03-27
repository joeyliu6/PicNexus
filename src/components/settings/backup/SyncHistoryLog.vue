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
}

const OP_META: Record<SyncLogOperation, OpMeta> = {
  export_settings_local:   { icon: 'pi-upload',        label: '导出配置到本地' },
  import_settings_local:   { icon: 'pi-download',      label: '从本地导入配置' },
  export_history_local:    { icon: 'pi-upload',        label: '导出历史到本地' },
  import_history_local:    { icon: 'pi-download',      label: '从本地导入历史' },
  upload_settings_cloud:   { icon: 'pi-cloud-upload',  label: '上传配置' },
  download_settings_cloud: { icon: 'pi-cloud-download', label: '下载配置' },
  sync_settings:           { icon: 'pi-refresh',       label: '双向同步配置' },
  upload_history_cloud:    { icon: 'pi-cloud-upload',  label: '上传历史' },
  download_history_cloud:  { icon: 'pi-cloud-download', label: '下载历史' },
  sync_history:            { icon: 'pi-refresh',       label: '双向同步历史' },
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
      <span class="log-count">{{ entries.length }}</span>
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
          <div class="op-icon-wrap">
            <i :class="['pi', getOpMeta(entry.operation).icon, 'op-icon']" />
          </div>

          <div class="row-info">
            <div class="row-main">
              <span class="op-label">{{ getOpMeta(entry.operation).label }}</span>
              <span
                v-if="isCloudOp(entry.operation) && entry.profileName"
                class="source-pill"
              >{{ entry.profileName }}</span>
            </div>
            <div class="row-meta">
              <span class="row-time">{{ formatRelativeTime(entry.timestamp) }}</span>
              <span v-if="entry.details && entry.result === 'success'" class="row-details-inline">
                · {{ entry.details }}
              </span>
            </div>
          </div>

          <span :class="['result-badge', entry.result === 'success' ? 'badge-success' : 'badge-failed']">
            {{ entry.result === 'success' ? '成功' : '失败' }}
          </span>
        </div>

        <!-- 失败错误详情 -->
        <div v-if="entry.result === 'failed' && entry.details" class="error-detail">
          {{ entry.details }}
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

.log-count {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--hover-overlay-subtle);
  border-radius: var(--radius-full);
  padding: 1px 7px;
  border: 1px solid var(--border-subtle);
}

.clear-btn {
  font-size: 12px;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: color 0.15s, background 0.15s;
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
.op-icon-wrap {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
}

.op-icon {
  font-size: 13px;
  color: var(--text-muted);
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

.source-pill {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--hover-overlay-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
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

/* ===== 结果 Badge ===== */
.result-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
}

.badge-success {
  background: var(--success-soft);
  color: var(--state-success-text);
}

.badge-failed {
  background: var(--error-soft);
  color: var(--state-error-text);
}

/* ===== 错误详情 ===== */
.error-detail {
  padding: 5px 18px 9px 60px;
  font-size: 11px;
  color: var(--state-error-text);
  opacity: 0.8;
  background: var(--error-alpha-8);
}
</style>
