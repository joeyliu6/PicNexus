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
  exportSettingsLoading,
  importSettingsLoading,
  uploadSettingsLoading,
  downloadSettingsLoading,
  exportHistoryLoading,
  importHistoryLoading,
  uploadHistoryLoading,
  downloadHistoryLoading,
  syncConfigLoading,
  syncHistoryLoading,
  loadSyncStatus,
  getProfileSyncRecord,
  getAllSyncRecords,
  exportSettingsLocal,
  importSettingsLocal,
  exportHistoryLocal,
  importHistoryLocal,
  syncConfig,
  syncHistory,
  uploadSettingsCloud,
  downloadSettingsOverwrite,
  uploadHistoryForce,
  downloadHistoryOverwrite,
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

const currentProfileRecord = computed(() => {
  const profile = activeWebDAVProfile.value;
  if (!profile) return null;
  return getProfileSyncRecord(profile.id);
});

const configSyncStatus = computed(() => {
  const record = currentProfileRecord.value;
  return {
    lastSync: record?.configLastSync ?? null,
    result: record?.configSyncResult ?? null,
    error: record?.configSyncError,
  };
});

const historySyncStatus = computed(() => {
  const record = currentProfileRecord.value;
  return {
    lastSync: record?.historyLastSync ?? null,
    result: record?.historySyncResult ?? null,
    error: record?.historySyncError,
  };
});

const otherProfileRecords = computed(() => {
  const currentId = activeWebDAVProfile.value?.id;
  const all = getAllSyncRecords();
  return Object.entries(all)
    .filter(([id]) => id !== currentId && id !== '__legacy__')
    .map(([, record]) => record);
});

onMounted(() => loadSyncStatus());

function handleConfigSync() {
  if (activeWebDAVProfile.value) syncConfig(activeWebDAVProfile.value);
}

function handleHistorySync() {
  if (activeWebDAVProfile.value) syncHistory(activeWebDAVProfile.value);
}

function handleConfigForceUpload() {
  if (activeWebDAVProfile.value) uploadSettingsCloud(activeWebDAVProfile.value);
}

function handleConfigForceDownload() {
  if (activeWebDAVProfile.value) downloadSettingsOverwrite(activeWebDAVProfile.value);
}

function handleHistoryForceUpload() {
  if (activeWebDAVProfile.value) uploadHistoryForce(activeWebDAVProfile.value);
}

function handleHistoryForceDownload() {
  if (activeWebDAVProfile.value) downloadHistoryOverwrite(activeWebDAVProfile.value);
}
</script>

<template>
  <div class="backup-sync-panel">
    <div class="section-header">
      <h2>备份与同步</h2>
      <p class="section-desc">管理你的设置和上传记录，支持多设备同步</p>
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
      配置 WebDAV 连接后即可使用云端同步
    </p>

    <!-- 配置文件 -->
    <div class="form-group">
      <label class="group-label">配置文件</label>
      <p class="helper-text">你的图床账号、偏好和所有设置项</p>
      <DataItemCard
        type="config"
        :sync-status="configSyncStatus"
        :is-cloud-enabled="isWebDAVConnected"
        :provider-name="activeWebDAVProfile?.name"
        :other-profiles="otherProfileRecords"
        :local-loading="{ export: exportSettingsLoading, import: importSettingsLoading }"
        :cloud-loading="{ sync: syncConfigLoading, forceUpload: uploadSettingsLoading, forceDownload: downloadSettingsLoading }"
        @export-local="exportSettingsLocal"
        @import-local="importSettingsLocal"
        @sync-cloud="handleConfigSync"
        @force-upload="handleConfigForceUpload"
        @force-download="handleConfigForceDownload"
      />
    </div>

    <!-- 上传记录 -->
    <div class="form-group">
      <label class="group-label">上传记录</label>
      <p class="helper-text">所有已上传的图片记录和链接</p>
      <DataItemCard
        type="history"
        menu-placement="top"
        :sync-status="historySyncStatus"
        :is-cloud-enabled="isWebDAVConnected"
        :provider-name="activeWebDAVProfile?.name"
        :other-profiles="otherProfileRecords"
        :local-loading="{ export: exportHistoryLoading, import: importHistoryLoading }"
        :cloud-loading="{ sync: syncHistoryLoading, forceUpload: uploadHistoryLoading, forceDownload: downloadHistoryLoading }"
        @export-local="exportHistoryLocal"
        @import-local="importHistoryLocal"
        @sync-cloud="handleHistorySync"
        @force-upload="handleHistoryForceUpload"
        @force-download="handleHistoryForceDownload"
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
  margin-top: 12px;
}

.warn-text i {
  color: var(--warning);
  font-size: 13px;
  flex-shrink: 0;
}
</style>
