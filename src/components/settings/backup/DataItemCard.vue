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
const isAnyCloudLoading = computed(() => props.cloudLoading.upload || props.cloudLoading.download);

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

function handleQuickSync() {
  if (isHistoryType.value) {
    emit('cloud-action', 'upload-merge');
  } else {
    emit('sync-to-cloud');
  }
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

    <div class="card-divider"></div>

    <!-- 云端同步行 -->
    <div class="card-row">
      <span class="row-label">云端同步</span>
      <div class="row-actions">
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
              @click.stop="toggleMenu('upload')"
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
            @click.stop="toggleMenu('download')"
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
    </div>

    <!-- 同步状态栏 -->
    <template v-if="isCloudEnabled">
      <div class="card-divider"></div>
      <div class="card-status-bar">
        <div class="status-left">
          <span class="status-text" :class="statusClass">
            <span class="status-dot"></span>
            {{ statusText }}
          </span>
          <button
            v-if="isStale"
            class="quick-sync-btn"
            :disabled="isAnyCloudLoading"
            @click="handleQuickSync"
          >
            立即同步
          </button>
        </div>
        <span v-if="syncStatus.lastSync" class="last-sync">
          {{ formatDetailedDate(syncStatus.lastSync) }}
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 卡片容器 */
.data-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  overflow: hidden;
}

/* 行布局 */
.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
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

/* 分隔线 */
.card-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 0 16px;
}

/* 状态栏 */
.card-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
}

.status-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-text {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
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
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

/* 立即同步按钮 */
.quick-sync-btn {
  padding: 2px 8px;
  background: transparent;
  border: 1px solid var(--primary);
  border-radius: 4px;
  color: var(--primary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.quick-sync-btn:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.1);
}

.quick-sync-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

  .card-status-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
}
</style>
