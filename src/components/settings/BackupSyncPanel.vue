<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import Button from 'primevue/button';
import { invoke } from '@tauri-apps/api/core';
import { useConfirm } from 'primevue/useconfirm';
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
} = useBackupSync();

// 迁移密码状态
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

// 导出前引导设置迁移密码
function handleExportWithGuide() {
  if (!hasBackupPassword.value) {
    confirm.require({
      header: '配置包含敏感信息',
      message: '你的配置中包含图床密钥、Token 等敏感信息。设置迁移密码可以加密保护，换电脑时也能安全恢复。',
      icon: 'pi pi-shield',
      acceptLabel: '先设置密码',
      rejectLabel: '直接导出',
      accept: () => openSetPasswordDialog(),
      reject: () => exportSettingsLocal(),
    });
    return;
  }
  exportSettingsLocal();
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
  const oldKeyB64 = await invoke<string>('get_or_create_secure_key');

  await swapFn();

  if (config) {
    try {
      await configStore.set('config', config);
    } catch (e) {
      // 写回失败，回滚钥匙串到旧密钥
      console.error('[迁移密码] 重新加密写回失败，回滚密钥:', e);
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
    toast.showConfig('success', { summary: '迁移密码设置成功', detail: '配置文件已使用新密码重新加密' });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[迁移密码] 设置失败:', errorMsg);
    toast.showConfig('error', { summary: '设置迁移密码失败', detail: errorMsg });
  } finally {
    passwordLoading.value = false;
  }
}

async function handleClearPassword() {
  passwordLoading.value = true;
  try {
    await swapKeyAndReencrypt(() => secureStorage.clearBackupPassword());
    hasBackupPassword.value = false;
    toast.showConfig('success', { summary: '迁移密码已清除', detail: '已切换为本机专属加密，换电脑后需重新配置' });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[迁移密码] 清除失败:', errorMsg);
    toast.showConfig('error', { summary: '清除迁移密码失败', detail: errorMsg });
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

    <!-- 安全加密 -->
    <div class="form-group">
      <label class="group-label">安全加密</label>

      <div v-if="!hasBackupPassword" class="security-banner warning">
        <div class="banner-icon">
          <i class="pi pi-shield" />
        </div>
        <div class="banner-content">
          <div class="banner-title">尚未设置迁移密码</div>
          <p class="banner-desc">导出或同步时，密钥和 Token 将以明文传输。设置密码后可加密保护，方便换电脑时安全恢复。</p>
          <Button
            label="设置迁移密码"
            icon="pi pi-lock"
            severity="warning"
            outlined
            size="small"
            :loading="passwordLoading"
            @click="openSetPasswordDialog"
          />
          <p class="banner-hint">
            <i class="pi pi-info-circle" />
            密码不会上传，仅在本地加密你的配置
          </p>
        </div>
      </div>

      <div v-else class="security-banner success">
        <div class="banner-icon">
          <i class="pi pi-check-circle" />
        </div>
        <div class="banner-content">
          <div class="banner-title">已加密保护</div>
          <p class="banner-desc">你的配置已加密，可安全导出和同步到其他设备。</p>
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
              label="清除"
              icon="pi pi-times"
              severity="danger"
              text
              size="small"
              :loading="passwordLoading"
              @click="handleClearPassword"
            />
          </div>
          <details class="forgot-password-hint">
            <summary>忘记密码怎么办？</summary>
            <div class="hint-content">
              <ul>
                <li>密码无法找回</li>
                <li>当前电脑不受影响（密钥已保存在系统中）</li>
                <li>新电脑将无法恢复加密配置，需重新填写各图床密钥</li>
                <li>可以清除密码后重新设置</li>
              </ul>
            </div>
          </details>
        </div>
      </div>
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
          @import-local="importSettingsLocal"
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
          @export-local="exportHistoryLocal"
          @import-local="importHistoryLocal"
          @sync-cloud="handleHistorySync"
          @force-upload="handleHistoryForceUpload"
          @force-download="handleHistoryForceDownload"
        />
      </div>

      <p v-if="!isWebDAVConnected" class="helper-text cloud-hint">
        <i class="pi pi-info-circle" />
        配置 WebDAV 连接后即可使用云端同步
      </p>
    </div>

    <!-- 迁移密码对话框 -->
    <BackupPasswordDialog
      ref="passwordDialogRef"
      v-model="showPasswordDialog"
      :mode="passwordDialogMode"
      @confirm="handlePasswordConfirm"
    />
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

/* 安全加密 banner */
.security-banner {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 10px;
}

.security-banner.warning {
  background: var(--warning-soft);
}

.security-banner.success {
  background: var(--success-soft);
}

.banner-icon {
  flex-shrink: 0;
  font-size: 18px;
  line-height: 1;
  padding-top: 1px;
}

.security-banner.warning .banner-icon {
  color: var(--warning);
}

.security-banner.success .banner-icon {
  color: var(--success);
}

.banner-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.banner-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
}

.banner-desc {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}

.banner-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
}

.banner-hint i {
  font-size: 13px;
  flex-shrink: 0;
}

.password-actions {
  display: flex;
  gap: 8px;
}

.forgot-password-hint {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-muted);
}

.forgot-password-hint summary {
  cursor: pointer;
  color: var(--text-muted);
  opacity: 0.8;
  user-select: none;
}

.forgot-password-hint summary:hover {
  opacity: 1;
}

.hint-content {
  margin-top: 8px;
  padding: 10px 12px;
  background: var(--hover-overlay-subtle);
  border-radius: 8px;
  line-height: 1.6;
}

.hint-content ul {
  margin: 0;
  padding-left: 16px;
}

.hint-content li {
  margin-bottom: 2px;
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
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.data-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
}

.data-section-desc {
  font-size: 12px;
  color: var(--text-muted);
}

.cloud-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.cloud-hint i {
  color: var(--text-muted);
  font-size: 13px;
  flex-shrink: 0;
}
</style>
