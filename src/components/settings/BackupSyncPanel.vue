<script setup lang="ts">
// 备份与同步设置面板 - 列表工具型布局

import { computed, onMounted } from 'vue';
import Divider from 'primevue/divider';
import ToggleSwitch from 'primevue/toggleswitch';
import { useBackupSync } from '../../composables/useBackupSync';
import type { WebDAVConfig, AutoSyncConfig } from '../../config/types';

import SyncItemRow from './backup/SyncItemRow.vue';
import WebDAVConfigCollapsible from './backup/WebDAVConfigCollapsible.vue';

// ==================== Props ====================

interface Props {
  /** WebDAV 配置 */
  webdavConfig: WebDAVConfig;

  /** 自动同步配置 */
  autoSyncConfig: AutoSyncConfig;

  /** WebDAV 测试中状态（由父组件管理） */
  webdavTesting?: boolean;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  /** WebDAV 配置变更 */
  'update:webdavConfig': [config: WebDAVConfig];

  /** 自动同步配置变更 */
  'update:autoSyncConfig': [config: AutoSyncConfig];

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

const connectionStatusClass = computed(() => {
  if (!props.webdavConfig.profiles.length) return 'not-configured';
  if (!isWebDAVConnected.value) return 'disconnected';
  return 'connected';
});

const connectionStatusText = computed(() => {
  if (!props.webdavConfig.profiles.length) return '未配置';
  if (!activeWebDAVProfile.value) return '未选择';
  if (!isWebDAVConnected.value) return '当前配置不完整';
  return `${activeWebDAVProfile.value.name} · 启用`;
});

const localWebDAVConfig = computed({
  get: () => props.webdavConfig,
  set: (val) => emit('update:webdavConfig', val)
});

const localAutoSyncConfig = computed({
  get: () => props.autoSyncConfig,
  set: (val) => emit('update:autoSyncConfig', val)
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

const autoSyncEnabled = computed({
  get: () => localAutoSyncConfig.value.enabled,
  set: (val) => {
    localAutoSyncConfig.value = { ...localAutoSyncConfig.value, enabled: val };
    handleSave();
  }
});

const autoSyncIntervalText = computed(() => {
  const hours = localAutoSyncConfig.value.intervalHours || 24;
  return `每 ${hours} 小时`;
});

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
    <!-- 标题区（融合状态） -->
    <div class="section-header-row">
      <div class="header-left">
        <h2>备份与同步</h2>
        <p class="section-desc">基于 WebDAV 的配置管理与数据流转服务</p>
      </div>
      <div class="header-right">
        <span class="status-indicator" :class="connectionStatusClass">
          <span class="status-dot"></span>
          {{ connectionStatusText }}
        </span>
      </div>
    </div>

    <!-- 分组标题：同步项目 -->
    <div class="group-title">同步项目</div>

    <!-- 配置文件同步行 -->
    <SyncItemRow
      type="config"
      :sync-status="configSyncStatus"
      :is-cloud-enabled="isWebDAVConnected"
      :loading="{
        upload: uploadSettingsLoading,
        download: downloadSettingsLoading,
        exportLocal: exportSettingsLoading,
        importLocal: importSettingsLoading
      }"
      @sync-to-cloud="handleConfigSyncToCloud"
      @cloud-action="handleConfigCloudAction"
      @export-local="exportSettingsLocal"
      @import-local="importSettingsLocal"
    />

    <Divider />

    <!-- 上传记录同步行 -->
    <SyncItemRow
      type="history"
      :sync-status="historySyncStatus"
      :is-cloud-enabled="isWebDAVConnected"
      :loading="{
        upload: uploadHistoryLoading,
        download: downloadHistoryLoading,
        exportLocal: exportHistoryLoading,
        importLocal: importHistoryLoading
      }"
      @cloud-action="handleHistoryCloudAction"
      @export-local="exportHistoryLocal"
      @import-local="importHistoryLocal"
    />

    <Divider />

    <!-- 分组标题：自动化 -->
    <div class="group-title">自动化</div>

    <!-- 自动同步开关行 -->
    <div class="auto-sync-container">
      <div class="auto-sync-row" :title="!isWebDAVConnected ? '当前配置不完整' : ''">
        <div class="row-left">
          <div class="row-info">
            <div class="row-title">自动同步</div>
            <div class="row-desc">
              <template v-if="autoSyncEnabled">
                {{ autoSyncIntervalText }}同步一次
              </template>
              <template v-else>
                定时自动备份配置和历史记录
              </template>
            </div>
          </div>
        </div>
        <div class="row-right">
          <ToggleSwitch v-model="autoSyncEnabled" :disabled="!isWebDAVConnected" />
        </div>
      </div>
    </div>

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
  margin-bottom: 24px;
}

.header-left h2 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

/* 状态指示器 */
.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.status-indicator.connected {
  color: var(--success);
}

.status-indicator.disconnected,
.status-indicator.not-configured {
  color: var(--text-muted);
}

/* 分组标题 */
.group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 14px;
  margin-bottom: 14px;
}

/* 自动同步容器 */
.auto-sync-container {
  overflow: hidden;
}

/* 自动同步行 */
.auto-sync-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  gap: 16px;
  transition: background-color 0.15s;
}

.auto-sync-row:hover {
  background: var(--primary-hover-bg);
}

.row-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.row-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-hover-bg);
  border-radius: 8px;
  color: var(--primary);
}

.row-icon i {
  font-size: 18px;
}

.row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.row-desc {
  font-size: 13px;
  color: var(--text-muted);
}

.row-right {
  flex-shrink: 0;
}
</style>
