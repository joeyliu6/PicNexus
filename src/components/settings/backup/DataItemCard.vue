<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import Button from 'primevue/button';
import { useClickOutside } from '../../../composables/useClickOutside';
import type { ProfileSyncRecord } from '../../../config/types';

const MENU_OPEN_EVENT = 'sync-row-menu-open';

interface SyncStatusInfo {
  lastSync?: string | null;
  result?: 'success' | 'failed' | 'partial' | null;
  error?: string;
}

interface Props {
  type: 'config' | 'history';
  syncStatus: SyncStatusInfo;
  isCloudEnabled: boolean;
  localLoading: { export: boolean; import: boolean };
  cloudLoading: { upload: boolean; download: boolean };
  providerName?: string;
  otherProfiles?: ProfileSyncRecord[];
}

const props = withDefaults(defineProps<Props>(), {
  otherProfiles: () => [],
});

const emit = defineEmits<{
  'export-local': [];
  'import-local': [];
  'sync-to-cloud': [];
  'cloud-action': [action: string];
}>();

const uploadMenuVisible = ref(false);
const downloadMenuVisible = ref(false);
const instanceId = Math.random().toString(36).substr(2, 9);

function broadcastMenuOpen() {
  window.dispatchEvent(new CustomEvent(MENU_OPEN_EVENT, { detail: { instanceId } }));
}

function handleOtherMenuOpen(event: Event) {
  const customEvent = event as CustomEvent;
  if (customEvent.detail.instanceId !== instanceId) {
    closeAllMenus();
  }
}

onMounted(() => {
  window.addEventListener(MENU_OPEN_EVENT, handleOtherMenuOpen);
});

onUnmounted(() => {
  window.removeEventListener(MENU_OPEN_EVENT, handleOtherMenuOpen);
});

const { target: uploadMenuRef } = useClickOutside(() => { uploadMenuVisible.value = false; });
const { target: downloadMenuRef } = useClickOutside(() => { downloadMenuVisible.value = false; });

const STALE_DAYS_WARNING = 7;
const STALE_DAYS_DANGER = 30;

function getElapsedMs(dateStr: string): number {
  try {
    return Date.now() - new Date(dateStr).getTime();
  } catch {
    return -1;
  }
}

function formatRelativeTime(dateStr: string): string {
  const ms = getElapsedMs(dateStr);
  if (ms < 0) return '未知时间';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

const daysSinceLastSync = computed(() => {
  if (!props.syncStatus.lastSync) return -1;
  const ms = getElapsedMs(props.syncStatus.lastSync);
  return ms < 0 ? -1 : Math.floor(ms / (1000 * 60 * 60 * 24));
});

const statusClass = computed(() => {
  if (!props.syncStatus.lastSync) return 'not-synced';
  if (props.syncStatus.result === 'failed') return 'failed';
  if (props.syncStatus.result === 'partial') return 'partial';
  if (daysSinceLastSync.value >= STALE_DAYS_DANGER) return 'stale-danger';
  if (daysSinceLastSync.value >= STALE_DAYS_WARNING) return 'stale-warning';
  return 'synced';
});

const statusText = computed(() => {
  const prefix = props.providerName ? `${props.providerName} · ` : '';
  if (!props.syncStatus.lastSync) return `${prefix}尚未同步`;
  if (props.syncStatus.result === 'failed') return `${prefix}同步失败`;
  if (props.syncStatus.result === 'partial') return `${prefix}部分同步`;
  const relTime = formatRelativeTime(props.syncStatus.lastSync);
  return `${prefix}${relTime}同步`;
});

const shortStatusText = computed(() => {
  if (!props.syncStatus.lastSync) return '未同步';
  if (props.syncStatus.result === 'failed') return '同步失败';
  if (props.syncStatus.result === 'partial') return '部分同步';
  return formatRelativeTime(props.syncStatus.lastSync);
});

const isHistoryType = computed(() => props.type === 'history');

function formatDate(dateStr: string, includeYear = true): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return includeYear ? `${date.getFullYear()}/${m}/${d} ${h}:${min}` : `${m}/${d} ${h}:${min}`;
}

const tooltipContent = computed(() => {
  const lines: string[] = [];
  lines.push(statusText.value);
  if (props.syncStatus.lastSync) {
    lines.push(formatDate(props.syncStatus.lastSync));
  }
  if (props.otherProfiles?.length) {
    const isConfig = props.type === 'config';
    for (const r of props.otherProfiles) {
      const lastSync = isConfig ? r.configLastSync : r.historyLastSync;
      if (!lastSync) continue;
      const result = isConfig ? r.configSyncResult : r.historySyncResult;
      const status = result === 'failed' ? ' (失败)' : '';
      lines.push(`${r.providerName}: ${formatDate(lastSync, false)}${status}`);
    }
  }
  return lines.join('\n');
});

function closeAllMenus() {
  uploadMenuVisible.value = false;
  downloadMenuVisible.value = false;
}

function toggleMenu(menu: 'upload' | 'download') {
  const target = menu === 'upload' ? uploadMenuVisible : downloadMenuVisible;
  const wasVisible = target.value;
  closeAllMenus();
  target.value = !wasVisible;
  if (!wasVisible) broadcastMenuOpen();
}

function handleCloudAction(action: string) {
  closeAllMenus();
  emit('cloud-action', action);
}

</script>

<template>
  <div class="data-card">
    <!-- 本地操作行 -->
    <div class="card-row">
      <span class="row-label">本地操作</span>
      <div class="row-actions">
        <Button
          @click="emit('export-local')"
          :loading="localLoading.export"
          label="备份到本地"
          icon="pi pi-download"
          text
          severity="secondary"
          size="small"
        />
        <Button
          @click="emit('import-local')"
          :loading="localLoading.import"
          label="从本地恢复"
          icon="pi pi-upload"
          text
          severity="secondary"
          size="small"
        />
      </div>
    </div>

    <!-- 云端同步行 -->
    <div class="card-row cloud-row">
      <div class="row-label-group">
        <span class="row-label">云端同步</span>
        <span
          v-if="isCloudEnabled"
          v-tooltip.bottom="tooltipContent"
          class="status-badge"
          :class="statusClass"
        >
          <span class="status-dot"></span>
          {{ shortStatusText }}
        </span>
      </div>
      <div class="row-actions">
        <!-- 上传按钮 -->
        <template v-if="!isHistoryType">
          <Button
            @click="emit('sync-to-cloud')"
            :loading="cloudLoading.upload"
            :disabled="!isCloudEnabled"
            :title="!isCloudEnabled ? '请先配置 WebDAV 连接' : ''"
            label="备份到云端"
            icon="pi pi-cloud-upload"
            outlined
            size="small"
          />
        </template>
        <template v-else>
          <div class="dropdown-wrapper" ref="uploadMenuRef">
            <Button
              @click.stop="toggleMenu('upload')"
              :loading="cloudLoading.upload"
              :disabled="!isCloudEnabled"
              :title="!isCloudEnabled ? '请先配置 WebDAV 连接' : ''"
              label="备份到云端"
              icon="pi pi-cloud-upload"
              outlined
              size="small"
            />
            <Transition name="dropdown">
              <div v-if="uploadMenuVisible" class="dropdown-menu">
                <button class="dropdown-item" @click="handleCloudAction('upload-merge')">
                  <span class="item-label">智能合并</span>
                  <span class="item-hint">推荐</span>
                </button>
                <button class="dropdown-item" @click="handleCloudAction('upload-incremental')">
                  <span class="item-label">仅上传新增</span>
                </button>
                <button class="dropdown-item danger" @click="handleCloudAction('upload-force')">
                  <span class="item-label">强制覆盖云端</span>
                </button>
              </div>
            </Transition>
          </div>
        </template>

        <!-- 下载按钮 -->
        <div class="dropdown-wrapper" ref="downloadMenuRef">
          <Button
            @click.stop="toggleMenu('download')"
            :loading="cloudLoading.download"
            :disabled="!isCloudEnabled"
            :title="!isCloudEnabled ? '请先配置 WebDAV 连接' : ''"
            label="从云端恢复"
            icon="pi pi-cloud-download"
            outlined
            size="small"
          />
          <Transition name="dropdown">
            <div v-if="downloadMenuVisible" class="dropdown-menu">
              <template v-if="!isHistoryType">
                <button class="dropdown-item" @click="handleCloudAction('download-merge')">
                  <span class="item-label">保留 WebDAV 配置</span>
                  <span class="item-hint">推荐</span>
                </button>
                <button class="dropdown-item danger" @click="handleCloudAction('download-overwrite')">
                  <span class="item-label">完全覆盖本地</span>
                </button>
              </template>
              <template v-else>
                <button class="dropdown-item" @click="handleCloudAction('download-merge')">
                  <span class="item-label">智能合并</span>
                  <span class="item-hint">推荐</span>
                </button>
                <button class="dropdown-item danger" @click="handleCloudAction('download-overwrite')">
                  <span class="item-label">覆盖本地</span>
                </button>
              </template>
            </div>
          </Transition>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* 卡片容器 */
.data-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
}

/* 行布局 */
.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
}

.card-row:first-child {
  border-radius: 12px 12px 0 0;
}

.card-row.cloud-row {
  background: var(--hover-overlay-subtle);
  border-radius: 0 0 12px 12px;
}

.row-label {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
  flex-shrink: 0;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 标签分组（标签 + 状态 Badge 内联） */
.row-label-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.status-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}

.status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.status-badge.synced { background: rgba(34, 197, 94, 0.12); color: var(--success); }
.status-badge.not-synced { background: var(--hover-overlay-subtle); color: var(--text-muted); }
.status-badge.failed { background: rgba(239, 68, 68, 0.1); color: var(--error); }
.status-badge.partial { background: rgba(245, 158, 11, 0.1); color: var(--warning); }
.status-badge.stale-warning { background: rgba(245, 158, 11, 0.1); color: var(--warning); }
.status-badge.stale-danger { background: rgba(230, 126, 34, 0.1); color: #e67e22; }

/* 下拉菜单 */
.dropdown-wrapper {
  position: relative;
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 160px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  box-shadow: var(--shadow-float);
  z-index: 1000;
  overflow: hidden;
}

.dropdown-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s;
}

.dropdown-item:hover:not(:disabled) {
  background: var(--hover-overlay-subtle);
}

.dropdown-item:not(:last-child) {
  border-bottom: 1px solid var(--border-subtle);
}

.dropdown-item .item-label { flex: 1; }
.dropdown-item .item-hint { font-size: 11px; color: var(--text-muted); }
.dropdown-item.danger { color: var(--error); }
.dropdown-item.danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.08); }

/* 下拉动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* 响应式 */
@media (max-width: 480px) {
  .card-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .row-label-group {
    flex-wrap: wrap;
  }
}
</style>
