<script setup lang="ts">
// 备份与同步设置面板 - 列表工具型布局

import { computed, onMounted } from 'vue';
import { useBackupSync } from '../../composables/useBackupSync';
import type { WebDAVConfig } from '../../config/types';

import DataItemCard from './backup/DataItemCard.vue';
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

    <!-- 未配置时：WebDAV 配置面板优先显示 -->
    <template v-if="!isWebDAVConnected">
      <WebDAVConfigCollapsible
        v-model="localWebDAVConfig"
        :testing="webdavTesting"
        @save="handleSave"
        @test="handleTestWebDAV"
      />

      <div class="cloud-disabled-hint">
        <i class="pi pi-info-circle"></i>
        <span>请先完成 WebDAV 配置后再进行云端同步操作</span>
      </div>
    </template>

    <!-- 配置文件卡片 -->
    <DataItemCard
      type="config"
      :sync-status="configSyncStatus"
      :is-cloud-enabled="isWebDAVConnected"
      :provider-name="activeWebDAVProfile?.name"
      :local-loading="{ export: exportSettingsLoading, import: importSettingsLoading }"
      :cloud-loading="{ upload: uploadSettingsLoading, download: downloadSettingsLoading }"
      @export-local="exportSettingsLocal"
      @import-local="importSettingsLocal"
      @sync-to-cloud="handleConfigSyncToCloud"
      @cloud-action="handleConfigCloudAction"
    />

    <!-- 上传记录卡片 -->
    <DataItemCard
      type="history"
      :sync-status="historySyncStatus"
      :is-cloud-enabled="isWebDAVConnected"
      :provider-name="activeWebDAVProfile?.name"
      :local-loading="{ export: exportHistoryLoading, import: importHistoryLoading }"
      :cloud-loading="{ upload: uploadHistoryLoading, download: downloadHistoryLoading }"
      @export-local="exportHistoryLocal"
      @import-local="importHistoryLocal"
      @cloud-action="handleHistoryCloudAction"
    />

    <!-- 已配置时：WebDAV 配置面板在底部 -->
    <template v-if="isWebDAVConnected">
      <WebDAVConfigCollapsible
        v-model="localWebDAVConfig"
        :testing="webdavTesting"
        @save="handleSave"
        @test="handleTestWebDAV"
      />
    </template>
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

.backup-sync-panel {
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 标题区 */
.section-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 4px;
}

.header-left h2 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px 0;
}

/* 未配置提示 */
.cloud-disabled-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--bg-secondary);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-muted);
}

.cloud-disabled-hint i {
  color: var(--warning);
  font-size: 14px;
  flex-shrink: 0;
}

</style>
