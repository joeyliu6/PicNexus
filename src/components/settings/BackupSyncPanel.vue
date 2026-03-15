<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useBackupSync } from '../../composables/useBackupSync';
import type { WebDAVConfig } from '../../config/types';

import DataItemCard from './backup/DataItemCard.vue';
import WebDAVConfigCollapsible from './backup/WebDAVConfigCollapsible.vue';

interface Props {
  webdavConfig: WebDAVConfig;
  webdavTesting?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:webdavConfig': [config: WebDAVConfig];
  'save': [];
  'testWebDAV': [];
}>();

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

const activeWebDAVProfile = computed(() =>
  props.webdavConfig.profiles.find(p => p.id === props.webdavConfig.activeId) || null
);

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

onMounted(() => loadSyncStatus());

function handleConfigSyncToCloud() {
  if (activeWebDAVProfile.value) {
    uploadSettingsCloud(activeWebDAVProfile.value);
  }
}

function handleConfigCloudAction(action: string) {
  if (!activeWebDAVProfile.value) return;
  const profile = activeWebDAVProfile.value;

  if (action === 'download-merge') downloadSettingsMerge(profile);
  else if (action === 'download-overwrite') downloadSettingsOverwrite(profile);
}

function handleHistoryCloudAction(action: string) {
  if (!activeWebDAVProfile.value) return;
  const profile = activeWebDAVProfile.value;

  const actions: Record<string, () => void> = {
    'upload-merge': () => uploadHistoryMerge(profile),
    'upload-incremental': () => uploadHistoryIncremental(profile),
    'upload-force': () => uploadHistoryForce(profile),
    'download-merge': () => downloadHistoryMerge(profile),
    'download-overwrite': () => downloadHistoryOverwrite(profile)
  };
  actions[action]?.();
}
</script>

<template>
  <div class="backup-sync-panel">
    <div class="section-header">
      <h2>备份与同步</h2>
      <p class="section-desc">基于 WebDAV 的配置管理与数据流转服务</p>
    </div>

    <!-- WebDAV 连接 -->
    <div class="form-group">
      <label class="group-label">WebDAV 连接</label>
      <WebDAVConfigCollapsible
        v-model="localWebDAVConfig"
        :testing="webdavTesting"
        @save="emit('save')"
        @test="emit('testWebDAV')"
      />
    </div>

    <p v-if="!isWebDAVConnected" class="helper-text warn-text">
      <i class="pi pi-info-circle"></i>
      请先完成 WebDAV 配置后再进行云端同步操作
    </p>

    <!-- 配置文件 -->
    <div class="form-group">
      <label class="group-label">配置文件</label>
      <p class="helper-text">包含图床密钥、Cookie 及偏好设置</p>
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
    </div>

    <!-- 上传记录 -->
    <div class="form-group">
      <label class="group-label">上传记录</label>
      <p class="helper-text">历史上传文件和 URL 记录</p>
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
    </div>
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

.warn-text {
  display: flex;
  align-items: center;
  gap: 6px;
}

.warn-text i {
  color: var(--warning);
  font-size: 13px;
  flex-shrink: 0;
}
</style>
