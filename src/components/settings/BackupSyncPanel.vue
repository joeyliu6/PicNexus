<script setup lang="ts">
import { computed, onMounted } from 'vue';
import Divider from 'primevue/divider';
import { useBackupSync } from '../../composables/useBackupSync';
import type { WebDAVConfig, AutoSyncConfig } from '../../config/types';

import WebDAVConfigSection from './backup/WebDAVConfigSection.vue';
import AutoSyncConfigSection from './backup/AutoSyncConfigSection.vue';
import BackupConfigSection from './backup/BackupConfigSection.vue';
import BackupHistorySection from './backup/BackupHistorySection.vue';

// ==================== Props ====================

interface Props {
  /** WebDAV 配置 */
  webdavConfig: WebDAVConfig;

  /** 自动同步配置 */
  autoSyncConfig: AutoSyncConfig;
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
  importHistoryProgress,
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

// ==================== Computed ====================

const activeWebDAVProfile = computed(() => {
  return props.webdavConfig.profiles.find(p => p.id === props.webdavConfig.activeId) || null;
});

const localWebDAVConfig = computed({
  get: () => props.webdavConfig,
  set: (val) => emit('update:webdavConfig', val)
});

const localAutoSyncConfig = computed({
  get: () => props.autoSyncConfig,
  set: (val) => emit('update:autoSyncConfig', val)
});

// ==================== Lifecycle ====================

onMounted(async () => {
  await loadSyncStatus();
});

// ==================== Methods ====================

function handleSave() {
  emit('save');
}

function handleTestWebDAV() {
  emit('testWebDAV');
}
</script>

<template>
  <div class="backup-sync-panel">
    <div class="section-header">
      <h2>备份与同步</h2>
      <p class="section-desc">基于 WebDAV 的配置管理与数据流转服务，支持多端环境同步。</p>
    </div>

    <!-- 配置文件区域 -->
    <BackupConfigSection
      :sync-status="syncStatus"
      :active-profile="activeWebDAVProfile"
      :loading="{
        exportLocal: exportSettingsLoading,
        importLocal: importSettingsLoading,
        uploadCloud: uploadSettingsLoading,
        downloadCloud: downloadSettingsLoading
      }"
      @export-local="exportSettingsLocal"
      @import-local="importSettingsLocal"
      @upload-cloud="uploadSettingsCloud"
      @download-cloud-merge="downloadSettingsMerge"
      @download-cloud-overwrite="downloadSettingsOverwrite"
    />

    <Divider />

    <!-- 上传记录区域 -->
    <BackupHistorySection
      :sync-status="syncStatus"
      :active-profile="activeWebDAVProfile"
      :loading="{
        exportLocal: exportHistoryLoading,
        importLocal: importHistoryLoading,
        uploadCloud: uploadHistoryLoading,
        downloadCloud: downloadHistoryLoading
      }"
      :import-progress="importHistoryProgress"
      @export-local="exportHistoryLocal"
      @import-local="importHistoryLocal"
      @upload-cloud-merge="uploadHistoryMerge"
      @upload-cloud-incremental="uploadHistoryIncremental"
      @upload-cloud-force="uploadHistoryForce"
      @download-cloud-merge="downloadHistoryMerge"
      @download-cloud-overwrite="downloadHistoryOverwrite"
    />

    <Divider />

    <!-- WebDAV 配置区域 -->
    <WebDAVConfigSection
      v-model="localWebDAVConfig"
      @save="handleSave"
      @test="handleTestWebDAV"
    />

    <Divider />

    <!-- 自动同步配置区域 -->
    <AutoSyncConfigSection
      v-model="localAutoSyncConfig"
      :active-profile="activeWebDAVProfile"
      @save="handleSave"
      @sync-settings="() => uploadSettingsCloud(activeWebDAVProfile)"
      @sync-history="() => uploadHistoryMerge(activeWebDAVProfile)"
    />
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';
</style>
