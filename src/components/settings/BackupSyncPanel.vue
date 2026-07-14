<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import Divider from 'primevue/divider';
import { useConfirm } from 'primevue/useconfirm';
import { useBackupSync } from '../../composables/useBackupSync';
import type { WebDAVConfig } from '../../config/types';

import DataItemCard from './backup/DataItemCard.vue';
import WebDAVConfigCollapsible from './backup/WebDAVConfigCollapsible.vue';
import BackupPasswordSection from './backup/BackupPasswordSection.vue';
import SyncHistoryLog from './backup/SyncHistoryLog.vue';
import ReloadBanner from '../common/ReloadBanner.vue';

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

const confirm = useConfirm();

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
  passwordRequest,
  needsReload,
} = useBackupSync();

function handleReload(): void {
  location.reload();
}

const syncHistoryLogRef = ref<InstanceType<typeof SyncHistoryLog> | null>(null);
const backupPasswordSectionRef = ref<InstanceType<typeof BackupPasswordSection> | null>(null);

// 监听导入/下载时的密码请求（由 useBackupSync 触发）→ 转交子组件弹 restore 对话框
watch(passwordRequest, (request) => {
  if (request) {
    backupPasswordSectionRef.value?.openRestoreDialog();
  }
});

const activeWebDAVProfile = computed(() =>
  props.webdavConfig.profiles.find(p => p.id === props.webdavConfig.activeId) || null
);

const isWebDAVConnected = computed(() => {
  const profile = activeWebDAVProfile.value;
  return !!(profile && profile.connectionStatus === 'success');
});

const webdavHintText = computed(() => {
  const profile = activeWebDAVProfile.value;
  if (!profile || !profile.url || !profile.username) return '未配置 WebDAV';
  if (profile.connectionStatus === 'failed') return '连接失败，请重新验证';
  if (profile.connectionStatus !== 'success') return '请先验证 WebDAV 连接';
  return '';
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


onMounted(async () => {
  await loadSyncStatus();
});

async function handleConfigSync() {
  if (!(backupPasswordSectionRef.value?.isPasswordMode() ?? false)) {
    backupPasswordSectionRef.value?.openSetPasswordDialog();
    return;
  }
  if (activeWebDAVProfile.value) {
    await syncConfig(activeWebDAVProfile.value);
    syncHistoryLogRef.value?.refresh();
  }
}

async function handleHistorySync() {
  if (activeWebDAVProfile.value) {
    await syncHistory(activeWebDAVProfile.value);
    syncHistoryLogRef.value?.refresh();
  }
}

async function handleConfigForceUpload() {
  if (!(backupPasswordSectionRef.value?.isPasswordMode() ?? false)) {
    backupPasswordSectionRef.value?.openSetPasswordDialog();
    return;
  }
  if (activeWebDAVProfile.value) {
    await uploadSettingsCloud(activeWebDAVProfile.value);
    syncHistoryLogRef.value?.refresh();
  }
}

async function handleConfigForceDownload() {
  if (activeWebDAVProfile.value) {
    await downloadSettingsOverwrite(activeWebDAVProfile.value);
    syncHistoryLogRef.value?.refresh();
  }
}

async function handleHistoryForceUpload() {
  if (activeWebDAVProfile.value) {
    await uploadHistoryForce(activeWebDAVProfile.value);
    syncHistoryLogRef.value?.refresh();
  }
}

async function handleHistoryForceDownload() {
  if (activeWebDAVProfile.value) {
    await downloadHistoryOverwrite(activeWebDAVProfile.value);
    syncHistoryLogRef.value?.refresh();
  }
}

async function handleImportSettings() {
  await importSettingsLocal();
  syncHistoryLogRef.value?.refresh();
}

async function handleExportHistory() {
  await exportHistoryLocal();
  syncHistoryLogRef.value?.refresh();
}

async function handleImportHistory() {
  await importHistoryLocal();
  syncHistoryLogRef.value?.refresh();
}

// 导出前引导设置备份密码
function handleExportWithGuide() {
  const hasPwd = backupPasswordSectionRef.value?.isPasswordMode() ?? false;
  if (!hasPwd) {
    confirm.require({
      header: '导出文件未加密',
      message: '导出的文件包含所有图床密钥和 Token。建议先设置备份密码，导出文件会自动加密保护。',
      icon: 'pi pi-shield',
      acceptLabel: '直接导出',
      rejectLabel: '先设置密码',
      accept: async () => { await exportSettingsLocal(); syncHistoryLogRef.value?.refresh(); },
      reject: () => backupPasswordSectionRef.value?.openSetPasswordDialog(),
    });
    return;
  }
  exportSettingsLocal().then(() => syncHistoryLogRef.value?.refresh());
}

// 子组件 restore 对话框结果 → 通过 passwordRequest 回传给 useBackupSync
// 密码验证异步进行，成功才关闭对话框；失败则回调对话框计次重试
async function handleRestoreConfirm(password: string) {
  const req = passwordRequest.value;
  if (!req) return;
  const ok = await req.verify(password);
  if (ok) {
    backupPasswordSectionRef.value?.onRestoreSuccess();
  } else {
    backupPasswordSectionRef.value?.onRestoreFailed();
  }
}

function handleRestoreCancel() {
  passwordRequest.value?.cancel();
}
</script>

<template>
  <div class="backup-sync-panel">
    <div class="section-header">
      <h2>备份与同步</h2>
      <p class="section-desc">管理你的设置和上传记录，支持多设备同步</p>
    </div>

    <ReloadBanner
      :visible="needsReload"
      message="云端配置已下载到本地，刷新页面后生效"
      @reload="handleReload"
    />

    <!-- 备份密码 -->
    <div class="form-group">
      <label class="group-label">备份密码</label>
      <BackupPasswordSection
        ref="backupPasswordSectionRef"
        @restore-confirm="handleRestoreConfirm"
        @restore-cancel="handleRestoreCancel"
      />
    </div>

    <Divider />

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

    <Divider />

    <!-- 数据管理 -->
    <div class="form-group">
      <label class="group-label">数据管理</label>

      <div class="data-section">
        <div class="data-section-header">
          <span class="data-section-title">配置文件</span>
          <span class="data-section-desc">你的图床账号和设置</span>
        </div>
        <DataItemCard
          type="config"
          :sync-status="configSyncStatus"
          :is-cloud-enabled="isWebDAVConnected"
          :cloud-hint="webdavHintText"
          :provider-name="activeWebDAVProfile?.name"
          :other-profiles="otherProfileRecords"
          :local-loading="{ export: exportSettingsLoading, import: importSettingsLoading }"
          :cloud-loading="{ sync: syncConfigLoading, forceUpload: uploadSettingsLoading, forceDownload: downloadSettingsLoading }"
          @export-local="handleExportWithGuide"
          @import-local="handleImportSettings"
          @sync-cloud="handleConfigSync"
          @force-upload="handleConfigForceUpload"
          @force-download="handleConfigForceDownload"
        />
      </div>

      <div class="data-section">
        <div class="data-section-header">
          <span class="data-section-title">上传记录</span>
          <span class="data-section-desc">所有已上传的图片链接、收藏状态</span>
        </div>
        <DataItemCard
          type="history"
          :sync-status="historySyncStatus"
          :is-cloud-enabled="isWebDAVConnected"
          :cloud-hint="webdavHintText"
          :provider-name="activeWebDAVProfile?.name"
          :other-profiles="otherProfileRecords"
          :local-loading="{ export: exportHistoryLoading, import: importHistoryLoading }"
          :cloud-loading="{ sync: syncHistoryLoading, forceUpload: uploadHistoryLoading, forceDownload: downloadHistoryLoading }"
          @export-local="handleExportHistory"
          @import-local="handleImportHistory"
          @sync-cloud="handleHistorySync"
          @force-upload="handleHistoryForceUpload"
          @force-download="handleHistoryForceDownload"
        />
      </div>

      <div class="data-section">
        <div class="data-section-header">
          <span class="data-section-title">操作历史</span>
          <span class="data-section-desc">备份、导入导出等操作记录</span>
        </div>
        <SyncHistoryLog ref="syncHistoryLogRef" />
      </div>

    </div>

  </div>
</template>

<style scoped>
@import url('../../styles/settings-shared.css');

/* 数据管理区块 */
.data-section {
  margin-bottom: var(--space-lg);
}

.data-section:last-of-type {
  margin-bottom: 0;
}

.data-section-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  margin-bottom: var(--space-sm);
}

.data-section-title {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-main);
}

.data-section-desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
}
</style>
