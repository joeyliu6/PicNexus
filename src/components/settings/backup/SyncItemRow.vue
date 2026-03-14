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

interface LoadingState {
  upload: boolean;
  download: boolean;
}

interface Props {
  /** 同步项类型 */
  type: 'config' | 'history';

  /** 同步状态 */
  syncStatus: SyncStatusInfo;

  /** 是否启用云端操作 */
  isCloudEnabled: boolean;

  /** 加载状态 */
  loading: LoadingState;

  /** 服务商名称 */
  providerName?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'sync-to-cloud': [];
  'cloud-action': [action: string];
}>();

const uploadMenuVisible = ref(false);
const downloadMenuVisible = ref(false);

const instanceId = Math.random().toString(36).substr(2, 9);

function broadcastMenuOpen() {
  window.dispatchEvent(new CustomEvent(MENU_OPEN_EVENT, {
    detail: { instanceId }
  }));
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

const { target: uploadMenuRef } = useClickOutside(() => {
  uploadMenuVisible.value = false;
});
const { target: downloadMenuRef } = useClickOutside(() => {
  downloadMenuVisible.value = false;
});

defineExpose({ uploadMenuRef, downloadMenuRef });

const itemConfig = computed(() => {
  if (props.type === 'config') {
    return {
      title: '配置文件',
      icon: 'pi pi-cog',
      description: '包含图床密钥、Cookie 及偏好设置'
    };
  }
  return {
    title: '上传记录',
    icon: 'pi pi-history',
    description: '历史上传文件和 URL 记录'
  };
});

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
  const provider = props.providerName || '';
  const prefix = provider ? `${provider} · ` : '';

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
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}`;
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

function handleSimpleUpload() {
  emit('sync-to-cloud');
}
</script>

<template>
  <div class="sync-item-row">
    <!-- 左侧：图标 + 信息 -->
    <div class="item-left">
      <div class="item-icon">
        <i :class="itemConfig.icon"></i>
      </div>
      <div class="item-info">
        <div class="item-title">{{ itemConfig.title }}</div>
        <div class="item-desc">{{ itemConfig.description }}</div>
      </div>
    </div>

    <!-- 右侧：操作 + 状态 -->
    <div class="item-right">
      <!-- 操作按钮组 -->
      <div class="item-actions">
        <!-- 上传按钮 -->
        <template v-if="!isHistoryType">
          <Button
            @click="handleSimpleUpload"
            :loading="loading.upload"
            :disabled="!isCloudEnabled"
            :title="!isCloudEnabled ? '当前配置不完整' : ''"
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
              :loading="loading.upload"
              :disabled="!isCloudEnabled"
              :title="!isCloudEnabled ? '当前配置不完整' : ''"
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
            :loading="loading.download"
            :disabled="!isCloudEnabled"
            :title="!isCloudEnabled ? '当前配置不完整' : ''"
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

      <!-- 状态信息 -->
      <div class="item-status">
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
</template>

<style scoped>
.sync-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
  gap: 16px;
  transition: background-color 0.15s;
  margin: 0 -16px;
  padding-left: 16px;
  padding-right: 16px;
}

.sync-item-row:hover {
  background: var(--primary-hover-bg);
}

/* 左侧 */
.item-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.item-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-hover-bg);
  border-radius: 8px;
  color: var(--primary);
  flex-shrink: 0;
}

.item-icon i {
  font-size: 18px;
}

.item-info {
  min-width: 0;
}

.item-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.item-desc {
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 右侧 */
.item-right {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

/* 状态 */
.item-status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-width: 120px;
  flex-shrink: 0;
}

.status-text {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.status-text.synced {
  color: var(--success);
}

.status-text.not-synced {
  color: var(--text-muted);
}

.status-text.failed {
  color: var(--error);
}

.status-text.partial {
  color: var(--warning);
}

.status-text.stale-warning {
  color: var(--warning);
}

.status-text.stale-danger {
  color: var(--error);
}

.last-sync {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* 操作按钮 */
.item-actions {
  display: flex;
  align-items: center;
  gap: 6px;
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

.dropdown-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dropdown-item:not(:last-child) {
  border-bottom: 1px solid var(--border-subtle);
}

.dropdown-item i {
  font-size: 14px;
  color: var(--text-secondary);
}

.dropdown-item .item-label {
  flex: 1;
}

.dropdown-item .item-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.dropdown-item.danger {
  color: var(--error);
}

.dropdown-item.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.08);
}

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
</style>
