<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Button from 'primevue/button';
import { invoke } from '@tauri-apps/api/core';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from '../../../composables/useToast';
import { secureStorage } from '../../../crypto';
import { configStore, syncStatusStore } from '../../../store/instances';
import type { UserConfig } from '../../../config/types';
import BackupPasswordDialog from '../../dialogs/BackupPasswordDialog.vue';
import { createLogger } from '../../../utils/logger';

const emit = defineEmits<{
  'restore-confirm': [password: string];
  'restore-cancel': [];
}>();

const toast = useToast();
const confirm = useConfirm();
const log = createLogger('BackupPasswordSection');

// 迁移密码状态
const hasBackupPassword = ref(false);
const showPasswordDialog = ref(false);
const passwordDialogMode = ref<'set' | 'change' | 'restore'>('set');
const passwordDialogRef = ref<InstanceType<typeof BackupPasswordDialog>>();
const passwordLoading = ref(false);

onMounted(() => {
  hasBackupPassword.value = secureStorage.isPasswordMode();
});

// 迁移密码操作
function openSetPasswordDialog() {
  passwordDialogMode.value = hasBackupPassword.value ? 'change' : 'set';
  showPasswordDialog.value = true;
}

function openRestoreDialog() {
  passwordDialogMode.value = 'restore';
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
      log.error('迁移密码重新加密写回失败，回滚密钥', e);
      await invoke('set_secure_key', { key: oldKeyB64 });
      await secureStorage.forceReinit();
      throw e;
    }
  }

  if (syncStatusRaw && Object.keys(syncStatusRaw).length > 0) {
    await syncStatusStore.setDirect(syncStatusRaw).catch(e =>
      log.warn('syncStatusStore 重新加密失败（非致命）', e)
    );
  }
}

async function handlePasswordConfirm(password: string) {
  // restore 模式：导入/下载加密数据时的密码请求
  // 不立即关闭对话框，等 parent 异步验证后通过 onRestoreSuccess/onRestoreFailed 决定
  if (passwordDialogMode.value === 'restore') {
    emit('restore-confirm', password);
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
    log.error('设置备份密码失败', errorMsg);
    toast.showConfig('error', { summary: '设置备份密码失败', detail: errorMsg });
    passwordDialogRef.value?.resetLoading();
  } finally {
    passwordLoading.value = false;
  }
}

function handlePasswordDialogCancel() {
  if (passwordDialogMode.value === 'restore') {
    emit('restore-cancel');
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
        log.error('停用备份密码失败', errorMsg);
        toast.showConfig('error', { summary: '停用备份密码失败', detail: errorMsg });
      } finally {
        passwordLoading.value = false;
      }
    },
  });
}

/** 外部（父组件）调用：restore 密码验证通过 → 关闭对话框 */
function onRestoreSuccess() {
  passwordDialogRef.value?.onPasswordSuccess();
}

/** 外部（父组件）调用：restore 密码验证失败 → 对话框计次并提示重试 */
function onRestoreFailed() {
  passwordDialogRef.value?.onPasswordFailed();
}

defineExpose({
  isPasswordMode: () => hasBackupPassword.value,
  openSetPasswordDialog,
  openRestoreDialog,
  onRestoreSuccess,
  onRestoreFailed,
});
</script>

<template>
  <div class="security-card">
    <div class="security-card-row">
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
    <div class="security-card-desc-row">
      <p class="security-desc">
        {{ hasBackupPassword
          ? '配置文件已加密保护，导出更安全。换机还原时导入备份并输入密码即可。'
          : '配置默认以明文导出，设置密码后自动加密。换机还原时需输入该密码。'
        }}
      </p>
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
/* 备份密码卡片 */
.security-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.security-card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-sm-md) var(--space-md-lg);
  gap: var(--space-md);
}

.security-card-desc-row {
  border-top: 1px solid var(--border-subtle);
  background: var(--hover-overlay-subtle);
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  padding: var(--space-sm-md) var(--space-md-lg);
}

.security-status {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--success);
}

.security-status-inactive {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.security-desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
}

.security-card-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  flex-shrink: 0;
}
</style>
