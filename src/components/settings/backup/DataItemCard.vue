<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import Button from 'primevue/button';
import { useClickOutside } from '../../../composables/useClickOutside';

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
}

const props = defineProps<Props>();

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
defineExpose({ uploadMenuRef, downloadMenuRef });

const ITEM_CONFIGS = {
  config: { title: '配置文件', icon: 'pi pi-cog', description: '包含图床密钥、Cookie 及偏好设置' },
  history: { title: '上传记录', icon: 'pi pi-history', description: '历史上传文件和 URL 记录' }
} as const;

const itemConfig = computed(() => ITEM_CONFIGS[props.type]);

const STALE_DAYS_WARNING = 7;
const STALE_DAYS_DANGER = 30;

const daysSinceLastSync = computed(() => {
  if (!props.syncStatus.lastSync) return -1;
  try {
    const lastSync = new Date(props.syncStatus.lastSync);
    return Math.floor((Date.now() - lastSync.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return -1;
  }
});

const isStale = computed(() => daysSinceLastSync.value >= STALE_DAYS_WARNING);
const isDangerouslyStale = computed(() => daysSinceLastSync.value >= STALE_DAYS_DANGER);

const statusClass = computed(() => {
  if (!props.syncStatus.lastSync) return 'not-synced';
  if (props.syncStatus.result === 'failed') return 'failed';
  if (props.syncStatus.result === 'partial') return 'partial';
  if (isDangerouslyStale.value) return 'stale-danger';
  if (isStale.value) return 'stale-warning';
  return 'synced';
});

const statusText = computed(() => {
  const prefix = props.providerName ? `${props.providerName} · ` : '';
  if (!props.syncStatus.lastSync) return `${prefix}尚未同步`;
  if (props.syncStatus.result === 'failed') return `${prefix}同步失败`;
  if (props.syncStatus.result === 'partial') return `${prefix}部分同步`;
  if (isStale.value) return `${prefix}${daysSinceLastSync.value} 天前同步`;
  return `${prefix}同步完成`;
});

const isHistoryType = computed(() => props.type === 'history');

function formatDetailedDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${d} ${h}:${min}`;
  } catch {
    return dateStr;
  }
}

function closeAllMenus() {
  uploadMenuVisible.value = false;
  downloadMenuVisible.value = false;
}

function toggleUploadMenu() {
  const wasVisible = uploadMenuVisible.value;
  closeAllMenus();
  uploadMenuVisible.value = !wasVisible;
  if (!wasVisible) broadcastMenuOpen();
}

function toggleDownloadMenu() {
  const wasVisible = downloadMenuVisible.value;
  closeAllMenus();
  downloadMenuVisible.value = !wasVisible;
  if (!wasVisible) broadcastMenuOpen();
}

function handleCloudAction(action: string) {
  closeAllMenus();
  emit('cloud-action', action);
}
</script>

<template>
  <div class="data-item-card">
    <!-- 卡片头部：图标 + 标题 + 描述 -->
    <div class="card-header">
      <div class="card-icon">
        <i :class="itemConfig.icon"></i>
      </div>
      <div class="card-info">
        <div class="card-title">{{ itemConfig.title }}</div>
        <div class="card-desc">{{ itemConfig.description }}</div>
      </div>
    </div>

    <!-- 操作区域：本地 + 云端并列 -->
    <div class="card-actions">
      <!-- 本地操作 -->
      <div class="action-group">
        <span class="action-label">本地</span>
        <div class="action-buttons">
          <Button
            @click="emit('export-local')"
            :loading="localLoading.export"
            label="导出"
            icon="pi pi-download"
            outlined
            size="small"
          />
          <Button
            @click="emit('import-local')"
            :loading="localLoading.import"
            label="导入"
            icon="pi pi-upload"
            outlined
            size="small"
          />
        </div>
      </div>

      <div class="action-divider"></div>

      <!-- 云端操作 -->
      <div class="action-group">
        <span class="action-label">云端</span>
        <div class="action-buttons">
          <!-- 上传按钮 -->
          <template v-if="!isHistoryType">
            <Button
              @click="emit('sync-to-cloud')"
              :loading="cloudLoading.upload"
              :disabled="!isCloudEnabled"
              :title="!isCloudEnabled ? '请先配置 WebDAV 连接' : ''"
              label="上传"
              icon="pi pi-cloud-upload"
              outlined
              size="small"
            />
          </template>
          <template v-else>
            <div class="dropdown-wrapper" ref="uploadMenuRef">
              <Button
                @click.stop="toggleUploadMenu"
                :loading="cloudLoading.upload"
                :disabled="!isCloudEnabled"
                :title="!isCloudEnabled ? '请先配置 WebDAV 连接' : ''"
                label="上传"
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
              @click.stop="toggleDownloadMenu"
              :loading="cloudLoading.download"
              :disabled="!isCloudEnabled"
              :title="!isCloudEnabled ? '请先配置 WebDAV 连接' : ''"
              label="拉取"
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

        <!-- 同步状态 -->
        <div v-if="isCloudEnabled" class="sync-status">
          <span class="status-text" :class="statusClass">
            <span class="status-dot"></span>
            {{ statusText }}
          </span>
          <span v-if="syncStatus.lastSync" class="last-sync">
            {{ formatDetailedDate(syncStatus.lastSync) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.data-item-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 16px;
  transition: border-color 0.15s;
}

.data-item-card:hover {
  border-color: var(--primary-hover-bg);
}

/* 卡片头部 */
.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.card-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-hover-bg);
  border-radius: 8px;
  color: var(--primary);
  flex-shrink: 0;
}

.card-icon i {
  font-size: 16px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.card-desc {
  font-size: 12px;
  color: var(--text-muted);
}

/* 操作区域 */
.card-actions {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.action-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
  min-width: 28px;
  flex-shrink: 0;
}

.action-buttons {
  display: flex;
  align-items: center;
  gap: 6px;
}

.action-divider {
  width: 1px;
  height: 28px;
  background: var(--border-subtle);
  flex-shrink: 0;
  align-self: center;
}

/* 同步状态 */
.sync-status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  margin-left: 4px;
  flex-shrink: 0;
}

.status-text {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.status-text.synced { color: var(--success); }
.status-text.not-synced { color: var(--text-muted); }
.status-text.failed { color: var(--error); }
.status-text.partial { color: var(--warning); }
.status-text.stale-warning { color: var(--warning); }
.status-text.stale-danger { color: var(--error); }

.last-sync {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
}

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
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
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

/* 响应式：窄屏时操作区换行 */
@media (max-width: 640px) {
  .card-actions {
    flex-direction: column;
    gap: 10px;
  }

  .action-divider {
    width: 100%;
    height: 1px;
  }
}
</style>
