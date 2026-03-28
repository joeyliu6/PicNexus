<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import Button from 'primevue/button';
import Divider from 'primevue/divider';
import { invoke } from '@tauri-apps/api/core';
import { useConfirm } from 'primevue/useconfirm';
import { useBackupSync } from '../../composables/useBackupSync';
import { useToast } from '../../composables/useToast';
import { secureStorage } from '../../crypto';
import { configStore, syncStatusStore } from '../../store/instances';
import type { WebDAVConfig, UserConfig } from '../../config/types';

import DataItemCard from './backup/DataItemCard.vue';
import WebDAVConfigCollapsible from './backup/WebDAVConfigCollapsible.vue';
import BackupPasswordDialog from '../dialogs/BackupPasswordDialog.vue';
import SyncHistoryLog from './backup/SyncHistoryLog.vue';

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
} = useBackupSync();

const syncHistoryLogRef = ref<InstanceType<typeof SyncHistoryLog> | null>(null);

// 迁移密码状态
const hasBackupPassword = ref(false);
const showPasswordDialog = ref(false);
const passwordDialogMode = ref<'set' | 'change' | 'restore'>('set');
const passwordDialogRef = ref<InstanceType<typeof BackupPasswordDialog>>();
const passwordLoading = ref(false);

// 监听导入/下载时的密码请求
watch(passwordRequest, (request) => {
  if (request) {
    passwordDialogMode.value = 'restore';
    showPasswordDialog.value = true;
  }
});

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
  hasBackupPassword.value = secureStorage.isPasswordMode();
});

async function handleConfigSync() {
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
  if (!hasBackupPassword.value) {
    confirm.require({
      header: '导出文件未加密',
      message: '导出的文件包含所有图床密钥和 Token。建议先设置备份密码，导出文件会自动加密保护。',
      icon: 'pi pi-shield',
      acceptLabel: '直接导出',
      rejectLabel: '先设置密码',
      accept: async () => { await exportSettingsLocal(); syncHistoryLogRef.value?.refresh(); },
      reject: () => openSetPasswordDialog(),
    });
    return;
  }
  exportSettingsLocal().then(() => syncHistoryLogRef.value?.refresh());
}

// 迁移密码操作
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
  const syncStatusRaw = await syncStatusStore.readRawAll().catch(() => null);
  const oldKeyB64 = await invoke<string>('get_or_create_secure_key');

  await swapFn();

  if (config) {
    try {
      await configStore.setDirect({ config });
    } catch (e) {
      console.error('[迁移密码] 重新加密写回失败，回滚密钥:', e);
      await invoke('set_secure_key', { key: oldKeyB64 });
      await secureStorage.forceReinit();
      throw e;
    }
  }

  if (syncStatusRaw && Object.keys(syncStatusRaw).length > 0) {
    await syncStatusStore.setDirect(syncStatusRaw).catch(e =>
      console.warn('[迁移密码] syncStatusStore 重新加密失败（非致命）:', e)
    );
  }
}

async function handlePasswordConfirm(password: string) {
  // restore 模式：导入/下载加密数据时的密码请求
  if (passwordDialogMode.value === 'restore' && passwordRequest.value) {
    passwordRequest.value.resolve(password);
    passwordDialogRef.value?.onPasswordSuccess();
    return;
  }

  // set/change 模式：设置或修改备份密码
  passwordLoading.value = true;
  try {
    await swapKeyAndReencrypt(() => secureStorage.setBackupPassword(password));
    hasBackupPassword.value = true;
    passwordDialogRef.value?.onPasswordSuccess();
    toast.showConfig('success', { summary: '备份密码设置成功', detail: '配置文件已使用新密码重新加密' });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份密码] 设置失败:', errorMsg);
    toast.showConfig('error', { summary: '设置备份密码失败', detail: errorMsg });
    passwordDialogRef.value?.resetLoading();
  } finally {
    passwordLoading.value = false;
  }
}

function handlePasswordDialogCancel() {
  if (passwordDialogMode.value === 'restore' && passwordRequest.value) {
    passwordRequest.value.reject(new Error('user_cancelled'));
    passwordRequest.value = null;
  }
}

function handleClearPassword() {
  confirm.require({
    header: '关闭加密',
    message: '关闭后，后续导出的配置不再加密。已有备份仍需原密码打开。',
    icon: 'pi pi-lock-open',
    acceptLabel: '确认关闭',
    rejectLabel: '取消',
    accept: async () => {
      passwordLoading.value = true;
      try {
        await swapKeyAndReencrypt(() => secureStorage.clearBackupPassword());
        hasBackupPassword.value = false;
        toast.showConfig('success', { summary: '备份密码已停用', detail: '已切换为本机专属加密，换电脑后需重新配置' });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[备份密码] 停用失败:', errorMsg);
        toast.showConfig('error', { summary: '停用备份密码失败', detail: errorMsg });
      } finally {
        passwordLoading.value = false;
      }
    },
  });
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
      <label class="group-label">备份密码</label>

      <div class="security-card" :class="hasBackupPassword ? 'is-protected' : 'is-unprotected'">
        <div class="security-card-top">
          <span v-if="hasBackupPassword" class="security-status">● 已加密</span>
          <span v-else class="security-status-inactive">
            <i class="pi pi-exclamation-circle"></i> 未设置
          </span>
          <div class="security-card-actions">
            <template v-if="hasBackupPassword">
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
                label="关闭加密"
                icon="pi pi-lock-open"
                severity="danger"
                outlined
                size="small"
                :loading="passwordLoading"
                @click="handleClearPassword"
              />
            </template>
            <Button
              v-else
              label="设置密码"
              icon="pi pi-lock"
              severity="primary"
              outlined
              size="small"
              :loading="passwordLoading"
              @click="openSetPasswordDialog"
            />
          </div>
        </div>
        <p class="security-desc">
          {{ hasBackupPassword
            ? '配置文件已加密保护，导出更安全。换机还原时导入备份并输入密码即可。'
            : '配置默认以明文导出，设置密码后自动加密。换机还原时需输入该密码。'
          }}
        </p>
      </div>
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
          <span class="data-section-desc">所有已上传的图片链接</span>
        </div>
        <DataItemCard
          type="history"
          :sync-status="historySyncStatus"
          :is-cloud-enabled="isWebDAVConnected"
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

    <!-- 迁移密码对话框 -->
    <BackupPasswordDialog
      ref="passwordDialogRef"
      v-model="showPasswordDialog"
      :mode="passwordDialogMode"
      @confirm="handlePasswordConfirm"
      @cancel="handlePasswordDialogCancel"
      @skip="handlePasswordDialogCancel"
    />
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

/* 备份密码卡片 */
.security-card {
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--hover-overlay-subtle);
  border: 1px solid var(--border-subtle);
  transition: border-color 0.2s;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.security-card.is-protected {
  border-color: var(--primary-alpha-15);
}

.security-card.is-unprotected {
  border-color: var(--border-subtle);
}

.security-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.security-status {
  font-size: 12px;
  font-weight: 500;
  color: var(--success);
}

.security-status-inactive {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}

.security-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
}

.security-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}


/* 数据管理区块 */
.data-section {
  margin-bottom: 16px;
}

.data-section:last-of-type {
  margin-bottom: 0;
}

.data-section-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}

.data-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
}

.data-section-desc {
  font-size: 13px;
  color: var(--text-muted);
}
</style>
