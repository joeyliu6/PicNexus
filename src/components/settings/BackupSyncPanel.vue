<script setup lang="ts">
// 备份与同步设置面板 - 列表工具型布局

import { computed, onMounted } from 'vue';
import Divider from 'primevue/divider';
import { useBackupSync } from '../../composables/useBackupSync';
import type { WebDAVConfig } from '../../config/types';

import SyncItemRow from './backup/SyncItemRow.vue';
import LocalBackupRow from './backup/LocalBackupRow.vue';
import WebDAVConfigCollapsible from './backup/WebDAVConfigCollapsible.vue';

// ==================== Props ====================

interface Props {
  /** WebDAV 配置 */
  webdavConfig: WebDAVConfig;

  /** WebDAV 测试中状态（由父组件管理） */
  webdavTesting?: boolean;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  /** WebDAV 配置变更 */
  'update:webdavConfig': [config: WebDAVConfig];

  /** 保存设置 */
  'save': [];

  /** 测试 WebDAV 连接 */
  'testWebDAV': [];
}>();

// ==================== Composables ====================

const {
  syncStatus,
  exportSettingsLoading,
  importSettingsLoading,
  uploadSettingsLoading,
  downloadSettingsLoading,
  exportHistoryLoading,
  importHistoryLoading,
  uploadHistoryLoading,
  downloadHistoryLoading,
  loadSyncStatus,
  exportSettingsLocal,
  importSettingsLocal,
  exportHistoryLocal,
  importHistoryLocal,
  uploadSettingsCloud,
  downloadSettingsOverwrite,
  downloadSettingsMerge,
  uploadHistoryForce,
  uploadHistoryMerge,
  uploadHistoryIncremental,
  downloadHistoryOverwrite,
  downloadHistoryMerge
} = useBackupSync();

const activeWebDAVProfile = computed(() => {
  return props.webdavConfig.profiles.find(p => p.id === props.webdavConfig.activeId) || null;
});

const isWebDAVConnected = computed(() => {
  const profile = activeWebDAVProfile.value;
  return !!(profile && profile.url && profile.username);
});

const localWebDAVConfig = computed({
  get: () => props.webdavConfig,
  set: (val) => emit('update:webdavConfig', val)
});

const configSyncStatus = computed(() => ({
  lastSync: syncStatus.value.configLastSync,
  result: syncStatus.value.configSyncResult,
  error: syncStatus.value.configSyncError
}));

const historySyncStatus = computed(() => ({
  lastSync: syncStatus.value.historyLastSync,
  result: syncStatus.value.historySyncResult,
  error: syncStatus.value.historySyncError
}));

onMounted(async () => {
  await loadSyncStatus();
});

function handleSave() {
  emit('save');
}

function handleTestWebDAV() {
  emit('testWebDAV');
}

function handleConfigCloudAction(action: string) {
  if (!activeWebDAVProfile.value) return;

  switch (action) {
    case 'download-merge':
      downloadSettingsMerge(activeWebDAVProfile.value);
      break;
    case 'download-overwrite':
      downloadSettingsOverwrite(activeWebDAVProfile.value);
      break;
  }
}

function handleConfigSyncToCloud() {
  if (activeWebDAVProfile.value) {
    uploadSettingsCloud(activeWebDAVProfile.value);
  }
}

function handleHistoryCloudAction(action: string) {
  if (!activeWebDAVProfile.value) return;

  switch (action) {
    case 'upload-merge':
      uploadHistoryMerge(activeWebDAVProfile.value);
      break;
    case 'upload-incremental':
      uploadHistoryIncremental(activeWebDAVProfile.value);
      break;
    case 'upload-force':
      uploadHistoryForce(activeWebDAVProfile.value);
      break;
    case 'download-merge':
      downloadHistoryMerge(activeWebDAVProfile.value);
      break;
    case 'download-overwrite':
      downloadHistoryOverwrite(activeWebDAVProfile.value);
      break;
  }
}
</script>

<template>
  <div class="backup-sync-panel">
    <!-- 标题区 -->
    <div class="section-header-row">
      <div class="header-left">
        <h2>备份与同步</h2>
        <p class="section-desc">基于 WebDAV 的配置管理与数据流转服务</p>
      </div>
    </div>

    <!-- 分组标题：本地备份 -->
    <div class="group-title">本地备份</div>

    <!-- 配置文件本地备份行 -->
    <LocalBackupRow
      type="config"
      :loading="{ export: exportSettingsLoading, import: importSettingsLoading }"
      @export-local="exportSettingsLocal"
      @import-local="importSettingsLocal"
    />

    <Divider />

    <!-- 上传记录本地备份行 -->
    <LocalBackupRow
      type="history"
      :loading="{ export: exportHistoryLoading, import: importHistoryLoading }"
      @export-local="exportHistoryLocal"
      @import-local="importHistoryLocal"
    />

    <!-- 分组标题：WebDAV 同步 -->
    <div class="group-title" style="margin-top: 24px;">WebDAV 同步</div>

    <!-- 配置文件云端同步行 -->
    <SyncItemRow
      type="config"
      :sync-status="configSyncStatus"
      :is-cloud-enabled="isWebDAVConnected"
      :provider-name="activeWebDAVProfile?.name"
      :loading="{
        upload: uploadSettingsLoading,
        download: downloadSettingsLoading
      }"
      @sync-to-cloud="handleConfigSyncToCloud"
      @cloud-action="handleConfigCloudAction"
    />

    <Divider />

    <!-- 上传记录云端同步行 -->
    <SyncItemRow
      type="history"
      :sync-status="historySyncStatus"
      :is-cloud-enabled="isWebDAVConnected"
      :provider-name="activeWebDAVProfile?.name"
      :loading="{
        upload: uploadHistoryLoading,
        download: downloadHistoryLoading
      }"
      @cloud-action="handleHistoryCloudAction"
    />

    <Divider />

    <!-- WebDAV 配置（可折叠） -->
    <WebDAVConfigCollapsible
      v-model="localWebDAVConfig"
      :testing="webdavTesting"
      @save="handleSave"
      @test="handleTestWebDAV"
    />
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

.backup-sync-panel {
  padding: 0;
}

/* 标题区融合状态 */
.section-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 16px;
}

.header-left h2 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px 0;
}

/* 分组标题 */
.group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 16px;
  margin-bottom: 12px;
}

</style>
