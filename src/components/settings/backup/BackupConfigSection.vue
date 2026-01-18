<script setup lang="ts">
// src/components/settings/backup/BackupConfigSection.vue
// 备份配置区域组件 (本地导出/导入 + 云端上传/下载)

import { ref, onMounted, onUnmounted } from 'vue';
import Button from 'primevue/button';
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
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  'export-local': [];
  'import-local': [];
  'upload-cloud': [profile: WebDAVProfile];
  'download-cloud-merge': [profile: WebDAVProfile];
  'download-cloud-overwrite': [profile: WebDAVProfile];
}>();

// ==================== State ====================

const expanded = ref(false);
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
  if (downloadMenuVisible.value && downloadDropdownRef.value && !downloadDropdownRef.value.contains(target)) {
    downloadMenuVisible.value = false;
  }
}

function toggleDownloadMenu() {
  downloadMenuVisible.value = !downloadMenuVisible.value;
}

function handleUploadCloud() {
  if (props.activeProfile) {
    emit('upload-cloud', props.activeProfile);
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
        <h3>配置文件</h3>
        <i :class="expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
      </div>
      <p class="helper-text">包含图床密钥、cookie 及偏好设置，用于迁移配置。</p>
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
              label="导入"
              outlined
              size="small"
            />
          </div>
        </div>

        <div class="backup-group">
          <span class="backup-group-label">云端</span>
          <div class="backup-actions">
            <Button
              @click="handleUploadCloud"
              :loading="loading.uploadCloud"
              :disabled="!activeProfile"
              icon="pi pi-cloud-upload"
              label="上传"
              size="small"
            />
            <!-- 配置文件下载下拉菜单 -->
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
                      <span class="menu-item-title">保留当前 WebDAV 配置</span>
                      <span class="menu-item-desc">其他配置采用云端 (推荐)</span>
                    </div>
                  </button>
                  <button class="upload-menu-item danger" @click="handleDownloadOverwrite">
                    <i class="pi pi-exclamation-triangle"></i>
                    <div class="menu-item-content">
                      <span class="menu-item-title">完全覆盖本地</span>
                      <span class="menu-item-desc">丢弃所有本地配置</span>
                    </div>
                  </button>
                </div>
              </Transition>
            </div>
          </div>
        </div>
        <!-- 同步状态 -->
        <div class="sync-status-line">
          <template v-if="syncStatus.configLastSync">
            <span v-if="syncStatus.configSyncResult === 'success'" class="status-success">
              ✓ 上次同步: {{ syncStatus.configLastSync }}
            </span>
            <span v-else class="status-error">
              ✗ 同步失败: {{ syncStatus.configLastSync }} ({{ syncStatus.configSyncError }})
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
