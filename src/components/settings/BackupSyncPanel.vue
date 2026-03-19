<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import Button from 'primevue/button';
import { invoke } from '@tauri-apps/api/core';
import { useBackupSync } from '../../composables/useBackupSync';
import { useToast } from '../../composables/useToast';
import { secureStorage } from '../../crypto';
import { configStore } from '../../store/instances';
import type { WebDAVConfig, UserConfig } from '../../config/types';

import DataItemCard from './backup/DataItemCard.vue';
import WebDAVConfigCollapsible from './backup/WebDAVConfigCollapsible.vue';
import BackupPasswordDialog from '../dialogs/BackupPasswordDialog.vue';

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

const toast = useToast();

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

// 备份密码状态
const hasBackupPassword = ref(false);
const showPasswordDialog = ref(false);
const passwordDialogMode = ref<'set' | 'change'>('set');
const passwordDialogRef = ref<InstanceType<typeof BackupPasswordDialog>>();
const passwordLoading = ref(false);

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

onMounted(async () => {
  await loadSyncStatus();
  // 检测当前是否处于备份密码模式
  hasBackupPassword.value = secureStorage.isPasswordMode();
});

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

// 备份密码操作
function openSetPasswordDialog() {
  passwordDialogMode.value = hasBackupPassword.value ? 'change' : 'set';
  showPasswordDialog.value = true;
}

/**
 * 读取配置 → 备份旧密钥 → 替换密钥 → 用新密钥重新加密写回
 * 如果写回失败，回滚到旧密钥，防止配置永久无法解密
 */
async function swapKeyAndReencrypt(swapFn: () => Promise<void>): Promise<void> {
  const config = await configStore.get<UserConfig>('config');
  const oldKeyB64 = await invoke<string>('get_or_create_secure_key');

  await swapFn();

  if (config) {
    try {
      await configStore.set('config', config);
    } catch (e) {
      // 写回失败，回滚钥匙串到旧密钥
      console.error('[备份密码] 重新加密写回失败，回滚密钥:', e);
      await invoke('set_secure_key', { key: oldKeyB64 });
      await secureStorage.forceReinit();
      throw e;
    }
  }
}

async function handlePasswordConfirm(password: string) {
  passwordLoading.value = true;
  try {
    await swapKeyAndReencrypt(() => secureStorage.setBackupPassword(password));
    hasBackupPassword.value = true;
    passwordDialogRef.value?.onPasswordSuccess();
    toast.showConfig('success', { summary: '备份密码设置成功', detail: '配置文件已使用新密码加密' });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份密码] 设置失败:', errorMsg);
    toast.showConfig('error', { summary: '设置备份密码失败', detail: errorMsg });
  } finally {
    passwordLoading.value = false;
  }
}

async function handleClearPassword() {
  passwordLoading.value = true;
  try {
    await swapKeyAndReencrypt(() => secureStorage.clearBackupPassword());
    hasBackupPassword.value = false;
    toast.showConfig('success', { summary: '备份密码已清除', detail: '配置切换为本机专属加密' });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份密码] 清除失败:', errorMsg);
    toast.showConfig('error', { summary: '清除备份密码失败', detail: errorMsg });
  } finally {
    passwordLoading.value = false;
  }
}
</script>

<template>
  <div class="backup-sync-panel">
    <div class="section-header">
      <h2>备份与同步</h2>
      <p class="section-desc">管理你的设置和上传记录，支持多设备同步</p>
    </div>

    <!-- 备份密码 -->
    <div class="form-group">
      <label class="group-label">
        <i class="pi pi-shield" style="margin-right: 6px;" />
        备份密码
      </label>

      <div v-if="!hasBackupPassword" class="backup-password-section">
        <p class="helper-text">
          设置后，你的所有配置（包括密码、Token）可以完整迁移到其他电脑。
          未设置时，更换电脑后需要重新填写各图床的密钥和 Token。
        </p>
        <Button
          label="设置备份密码"
          icon="pi pi-lock"
          severity="secondary"
          outlined
          size="small"
          :loading="passwordLoading"
          @click="openSetPasswordDialog"
        />
        <p class="helper-text subtle-text">
          <i class="pi pi-info-circle" />
          密码不会上传到任何服务器，仅用于加密本地配置文件
        </p>
      </div>

      <div v-else class="backup-password-section">
        <div class="password-status">
          <span class="status-badge">
            <i class="pi pi-check-circle" />
            已设置
          </span>
          <p class="helper-text">配置已受备份密码保护，可安全迁移到其他电脑</p>
        </div>
        <div class="password-actions">
          <Button
            label="修改密码"
            icon="pi pi-pencil"
            severity="secondary"
            outlined
            size="small"
            :loading="passwordLoading"
            @click="openSetPasswordDialog"
          />
          <Button
            label="清除密码"
            icon="pi pi-times"
            severity="danger"
            text
            size="small"
            :loading="passwordLoading"
            @click="handleClearPassword"
          />
        </div>
        <p class="helper-text subtle-text">
          <i class="pi pi-info-circle" />
          清除密码后，配置将改用本机专属密钥加密，更换电脑后需要重新配置敏感信息
        </p>
      </div>
    </div>

    <!-- 备份密码对话框 -->
    <BackupPasswordDialog
      ref="passwordDialogRef"
      v-model="showPasswordDialog"
      :mode="passwordDialogMode"
      @confirm="handlePasswordConfirm"
    />

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

.backup-password-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.password-status {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--green-600);
}

.status-badge i {
  font-size: 14px;
}

.password-actions {
  display: flex;
  gap: 8px;
}

.subtle-text {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-color-secondary);
  opacity: 0.8;
}

.subtle-text i {
  font-size: 12px;
  flex-shrink: 0;
}

/* 暗色模式 */
:root.dark-theme .status-badge {
  color: var(--green-400);
}
</style>
