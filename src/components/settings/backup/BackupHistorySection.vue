<script setup lang="ts">
// 历史记录备份区域组件

import { ref, onMounted, onUnmounted } from 'vue';
import Button from 'primevue/button';
import ProgressBar from 'primevue/progressbar';
import type { SyncStatus, WebDAVProfile } from '../../../config/types';

// ==================== Props ====================

interface Props {
  syncStatus: SyncStatus;
  activeProfile: WebDAVProfile | null;
  loading: {
    exportLocal: boolean;
    importLocal: boolean;
    uploadCloud: boolean;
    downloadCloud: boolean;
  };
  importProgress: number;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  'export-local': [];
  'import-local': [];
  'upload-cloud-merge': [profile: WebDAVProfile];
  'upload-cloud-incremental': [profile: WebDAVProfile];
  'upload-cloud-force': [profile: WebDAVProfile];
  'download-cloud-merge': [profile: WebDAVProfile];
  'download-cloud-overwrite': [profile: WebDAVProfile];
}>();

// ==================== State ====================

const expanded = ref(false);
const uploadDropdownRef = ref<HTMLElement | null>(null);
const uploadMenuVisible = ref(false);
const downloadDropdownRef = ref<HTMLElement | null>(null);
const downloadMenuVisible = ref(false);

// ==================== Lifecycle ====================

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

// ==================== Methods ====================

function handleClickOutside(event: MouseEvent) {
  const target = event.target as Node;

  if (uploadMenuVisible.value && uploadDropdownRef.value && !uploadDropdownRef.value.contains(target)) {
    uploadMenuVisible.value = false;
  }

  if (downloadMenuVisible.value && downloadDropdownRef.value && !downloadDropdownRef.value.contains(target)) {
    downloadMenuVisible.value = false;
  }
}

function toggleUploadMenu() {
  uploadMenuVisible.value = !uploadMenuVisible.value;
  if (uploadMenuVisible.value) downloadMenuVisible.value = false;
}

function toggleDownloadMenu() {
  downloadMenuVisible.value = !downloadMenuVisible.value;
  if (downloadMenuVisible.value) uploadMenuVisible.value = false;
}

function handleUploadMerge() {
  if (props.activeProfile) {
    uploadMenuVisible.value = false;
    emit('upload-cloud-merge', props.activeProfile);
  }
}

function handleUploadIncremental() {
  if (props.activeProfile) {
    uploadMenuVisible.value = false;
    emit('upload-cloud-incremental', props.activeProfile);
  }
}

function handleUploadForce() {
  if (props.activeProfile) {
    uploadMenuVisible.value = false;
    emit('upload-cloud-force', props.activeProfile);
  }
}

function handleDownloadMerge() {
  if (props.activeProfile) {
    downloadMenuVisible.value = false;
    emit('download-cloud-merge', props.activeProfile);
  }
}

function handleDownloadOverwrite() {
  if (props.activeProfile) {
    downloadMenuVisible.value = false;
    emit('download-cloud-overwrite', props.activeProfile);
  }
}
</script>

<template>
  <div class="sub-section collapsible">
    <div class="section-header-collapsible" @click="expanded = !expanded">
      <div class="section-title-row">
        <h3>上传记录</h3>
        <i :class="expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
      </div>
      <p class="helper-text">图片外链与上传记录，建议定期同步确保多端一致。</p>
    </div>

    <Transition name="collapse">
      <div v-if="expanded" class="section-content">
        <div class="backup-group">
          <span class="backup-group-label">本地</span>
          <div class="backup-actions">
            <Button
              @click="emit('export-local')"
              :loading="loading.exportLocal"
              icon="pi pi-upload"
              label="导出"
              outlined
              size="small"
            />
            <Button
              @click="emit('import-local')"
              :loading="loading.importLocal"
              icon="pi pi-download"
              :label="loading.importLocal && importProgress > 0 ? `${importProgress}%` : '导入'"
              outlined
              size="small"
            />
          </div>
          <!-- 导入进度条 -->
          <ProgressBar
            v-if="loading.importLocal && importProgress > 0"
            :value="importProgress"
            :showValue="false"
            class="import-progress-bar"
          />
        </div>

        <div class="backup-group">
          <span class="backup-group-label">云端</span>
          <div class="backup-actions">
            <!-- 上传记录上传下拉菜单 -->
            <div class="upload-dropdown-wrapper" ref="uploadDropdownRef">
              <Button
                @click.stop="toggleUploadMenu"
                :loading="loading.uploadCloud"
                :disabled="!activeProfile"
                icon="pi pi-cloud-upload"
                label="上传"
                size="small"
              />
              <Transition name="dropdown">
                <div v-if="uploadMenuVisible" class="upload-menu">
                  <button class="upload-menu-item" @click="handleUploadMerge">
                    <i class="pi pi-sync"></i>
                    <div class="menu-item-content">
                      <span class="menu-item-title">智能合并</span>
                      <span class="menu-item-desc">对比并合并双端差异 (推荐)</span>
                    </div>
                  </button>
                  <button class="upload-menu-item" @click="handleUploadIncremental">
                    <i class="pi pi-plus"></i>
                    <div class="menu-item-content">
                      <span class="menu-item-title">仅上传新增</span>
                      <span class="menu-item-desc">只上传云端没有的记录</span>
                    </div>
                  </button>
                  <button class="upload-menu-item danger" @click="handleUploadForce">
                    <i class="pi pi-exclamation-triangle"></i>
                    <div class="menu-item-content">
                      <span class="menu-item-title">强制覆盖云端</span>
                      <span class="menu-item-desc">丢弃云端数据，以本地为准</span>
                    </div>
                  </button>
                </div>
              </Transition>
            </div>
            <!-- 上传记录下载下拉菜单 -->
            <div class="upload-dropdown-wrapper" ref="downloadDropdownRef">
              <Button
                @click.stop="toggleDownloadMenu"
                :loading="loading.downloadCloud"
                :disabled="!activeProfile"
                icon="pi pi-cloud-download"
                label="下载"
                size="small"
              />
              <Transition name="dropdown">
                <div v-if="downloadMenuVisible" class="upload-menu">
                  <button class="upload-menu-item" @click="handleDownloadMerge">
                    <i class="pi pi-sync"></i>
                    <div class="menu-item-content">
                      <span class="menu-item-title">智能合并</span>
                      <span class="menu-item-desc">与本地记录合并 (推荐)</span>
                    </div>
                  </button>
                  <button class="upload-menu-item danger" @click="handleDownloadOverwrite">
                    <i class="pi pi-exclamation-triangle"></i>
                    <div class="menu-item-content">
                      <span class="menu-item-title">覆盖本地</span>
                      <span class="menu-item-desc">丢弃本地数据，以云端为准</span>
                    </div>
                  </button>
                </div>
              </Transition>
            </div>
          </div>
        </div>
        <!-- 同步状态 -->
        <div class="sync-status-line">
          <template v-if="syncStatus.historyLastSync">
            <span v-if="syncStatus.historySyncResult === 'success'" class="status-success">
              ✓ 上次同步: {{ syncStatus.historyLastSync }}
            </span>
            <span v-else class="status-error">
              ✗ 同步失败: {{ syncStatus.historyLastSync }} ({{ syncStatus.historySyncError }})
            </span>
          </template>
          <span v-else class="status-pending">尚未同步</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
@import '../../../styles/settings-shared.css';

/* 备份组 */
.backup-group {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.backup-group:last-child {
  border-bottom: none;
}

.backup-group-label {
  width: 100px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.backup-actions {
  display: flex;
  gap: 8px;
}

.import-progress-bar {
  margin-top: 8px;
  height: 4px;
  border-radius: 2px;
}

/* 下拉菜单 */
.upload-dropdown-wrapper {
  position: relative;
  display: inline-block;
}

.upload-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 260px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
}

.upload-menu-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s;
}

.upload-menu-item:hover {
  background: var(--hover-overlay-subtle);
}

.upload-menu-item:not(:last-child) {
  border-bottom: 1px solid var(--border-subtle);
}

.upload-menu-item i {
  font-size: 16px;
  color: var(--primary);
  margin-top: 2px;
  flex-shrink: 0;
}

.menu-item-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.menu-item-title {
  font-size: 13px;
  font-weight: 500;
}

.menu-item-desc {
  font-size: 11px;
  color: var(--text-muted);
}

.upload-menu-item.danger {
  color: var(--error);
}

.upload-menu-item.danger i {
  color: var(--error);
}

.upload-menu-item.danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

/* 同步状态 */
.sync-status-line {
  margin-top: 12px;
  font-size: 12px;
  font-family: var(--font-mono);
}

.status-success {
  color: var(--success);
}

.status-error {
  color: var(--error);
}

.status-pending {
  color: var(--text-muted);
}

.helper-text {
  margin: -3px 0 0 0;
}
</style>
