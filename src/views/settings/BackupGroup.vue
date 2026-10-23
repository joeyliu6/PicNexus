<script setup lang="ts">
// 备份与同步（S05 / S10–S15）：云同步卡、备份密码、手动备份、最近操作。
// 未设置备份密码时点「导出配置…」先问要不要设密码（S10，推荐的「先设置密码」是主按钮，设好后接着导出）。
// 同步 / 导入遇到加密文件时弹「输入备份密码」；换了备份密码后重读这一页手里的配置（里面的密文换了钥匙）。
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnDialog from '@/components/pn/PnDialog.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import BackupPasswordDialog from '@/components/dialogs/BackupPasswordDialog.vue';
import type { BackupPasswordConfirmPayload, BackupPasswordDialogMode } from '@/components/dialogs/backupPasswordDialogTypes';
import { changeBackupPassword, hasBackupPassword, WrongPasswordError, type PasswordChange } from '@/composables/backup-sync/backupPassword';
import { exportConfigFile, exportHistoryFile, importConfig, importHistory, pickBackupFile, UNRECOGNIZED_FILE } from '@/composables/backup-sync/backupFiles';
import { loadSyncRecords } from '@/composables/backup-sync/syncRecords';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { TOAST_MESSAGES } from '@/constants';
import { historyDB } from '@/services/database';
import { getErrorMessage } from '@/types/errors';
import { formatCount } from '@/utils/formatters';
import BackupRecent from './BackupRecent.vue';
import CloudSyncCard from './CloudSyncCard.vue';
import SettingsCard from './SettingsCard.vue';
import SettingsSection from './SettingsSection.vue';
import SyncTargetDialog from './SyncTargetDialog.vue';
import { useCloudSync } from './useCloudSync';
import { useSettingsConfig } from './useSettingsConfig';

const settings = useSettingsConfig();
const cloud = useCloudSync();
const toast = useToast();
const { confirm } = useConfirm();

const passwordSet = ref(hasBackupPassword());
const historyCount = ref<number | null>(null);
const recentKey = ref(0);
const targetOpen = ref(false);
const exportWarnOpen = ref(false);
const passwordOpen = ref(false);
const passwordMode = ref<BackupPasswordDialogMode>('set');
const passwordDialog = ref<InstanceType<typeof BackupPasswordDialog>>();
/** 从「导出前先设置密码」进来的：密码设好后接着导出 */
let exportAfterPassword = false;

const profile = computed(() => {
  const webdav = settings.config.value.webdav;
  return webdav?.profiles.find((p) => p.id === webdav.activeId) ?? null;
});

async function refresh(): Promise<void> {
  passwordSet.value = hasBackupPassword();
  recentKey.value += 1;
  await loadSyncRecords();
  historyCount.value = await historyDB.getCount().catch(() => null);
}

onMounted(refresh);
onActivated(refresh);
// 同步结束（成功或失败）都会写日志：刷新「最近操作」与条数
watch(() => cloud.phase.value, (phase) => { if (phase === 'done' || phase === 'failed') void refresh(); });

// ---- 备份密码 ----

function openPassword(mode: BackupPasswordDialogMode): void {
  passwordMode.value = mode;
  passwordOpen.value = true;
}

// 同步 / 导入遇到加密内容：弹「输入备份密码」
watch(() => cloud.unlockRequest.value, (request) => { if (request) openPassword('unlock'); });

/** 弹窗交来的是哪一种：设置 / 修改 / 关闭密码，还是给加密内容解锁（null） */
function toPasswordChange(payload: BackupPasswordConfirmPayload): PasswordChange | null {
  switch (payload.mode) {
    case 'set': return { mode: 'set', password: payload.password };
    case 'change': return { mode: 'change', currentPassword: payload.currentPassword, newPassword: payload.newPassword };
    case 'disable': return { mode: 'disable', currentPassword: payload.currentPassword };
    default: return null;
  }
}

const CHANGED: Record<PasswordChange['mode'], string> = { set: '备份密码已设置', change: '备份密码已修改', disable: '备份密码已关闭' };

async function onPasswordConfirm(payload: BackupPasswordConfirmPayload): Promise<void> {
  const change = toPasswordChange(payload);
  if (!change) {
    const ok = await cloud.unlockRequest.value?.verify('password' in payload ? payload.password : '');
    if (ok) passwordDialog.value?.onPasswordSuccess();
    else passwordDialog.value?.onPasswordFailed();
    return;
  }
  try {
    const report = await changeBackupPassword(change);
    passwordDialog.value?.onPasswordSuccess();
    const summary = CHANGED[change.mode];
    if (report.orphans.length) toast.showConfig('warn', TOAST_MESSAGES.config.orphanSecretsKept(summary, report.orphans));
    else toast.success(summary);
    await settings.reload();
    await refresh();
    if (change.mode === 'set' && exportAfterPassword) {
      exportAfterPassword = false;
      await runExportConfig();
    }
  } catch (error) {
    if (error instanceof WrongPasswordError) {
      passwordDialog.value?.onPasswordFailed();
      return;
    }
    passwordDialog.value?.resetLoading();
    toast.error('未能更改备份密码', `${getErrorMessage(error) || '换密钥失败，已恢复原来的密码'}，请重试`);
  }
}

function onPasswordCancel(): void {
  exportAfterPassword = false;
  cloud.unlockRequest.value?.cancel();
}

// ---- 手动备份 ----

async function runExportConfig(): Promise<void> {
  try {
    const path = await exportConfigFile();
    if (path) toast.success('已导出配置', path);
  } catch (error) {
    toast.error('未能导出配置', `${getErrorMessage(error)}，请重试`);
  } finally {
    recentKey.value += 1;
  }
}

function exportConfig(): void {
  if (passwordSet.value) void runExportConfig();
  else exportWarnOpen.value = true;
}

function setPasswordFirst(): void {
  exportWarnOpen.value = false;
  exportAfterPassword = true;
  openPassword('set');
}

function exportDirectly(): void {
  exportWarnOpen.value = false;
  void runExportConfig();
}

async function exportHistory(): Promise<void> {
  try {
    const result = await exportHistoryFile();
    if (result) toast.success(`已导出 ${formatCount(result.count)} 条上传记录`, result.path);
  } catch (error) {
    toast.error('未能导出上传记录', `${getErrorMessage(error)}，请重试`);
  } finally {
    recentKey.value += 1;
  }
}

async function importFile(): Promise<void> {
  try {
    const file = await pickBackupFile(cloud.decrypt);
    if (!file) return;
    if (file.kind === 'config') {
      const ok = await confirm('将以文件中的配置替换本机全部图床账号、上传组合与偏好，当前本地配置会丢失且无法撤销。本机的云同步连接与上传记录不受影响。', {
        header: '导入配置？', acceptLabel: '导入', rejectLabel: '取消', tone: 'danger',
      });
      if (!ok) return;
      await importConfig(file.config);
      cloud.needsReload.value = 'file';
      return;
    }
    const result = await importHistory(file.content);
    const skipped = result.skipped ? `，跳过 ${formatCount(result.skipped)} 条格式无效记录` : '';
    toast.success(`已导入 ${formatCount(result.added)} 条上传记录`, `现在共 ${formatCount(result.total)} 条${skipped}`);
  } catch (error) {
    if (error instanceof Error && error.message === 'user_cancelled') return;
    const reason = getErrorMessage(error);
    // 认不出的文件那句已经写了怎么办，其余原因后面接处理办法
    toast.error('未能导入', reason === UNRECOGNIZED_FILE ? reason : `${reason || '文件读取失败'}，请检查文件后重试`);
  } finally {
    await refresh();
  }
}

const MANUAL = computed(() => [
  { label: '导出配置…', hint: '图床账号与偏好', run: exportConfig },
  { label: '导出上传记录…', hint: historyCount.value === null ? '' : `${formatCount(historyCount.value)} 条`, run: exportHistory },
  { label: '从文件导入…', hint: '配置或记录', run: importFile },
]);
</script>

<template>
  <div class="backup">
    <SettingsSection title="云同步" note="开启后两台电脑会自动合并改动；只想以某一边为准时，用「⋯」里的覆盖操作。">
      <CloudSyncCard
        :profile="profile"
        :history-count="historyCount"
        :password-missing="!passwordSet"
        @configure="targetOpen = true"
        @need-password="openPassword('set')"
      />
    </SettingsSection>

    <SettingsSection title="备份密码">
      <SettingsCard large class="backup__password" data-setting-row="backupPassword">
        <span class="backup__lock" aria-hidden="true"><PnIcon name="lock" :size="18" :stroke="1.8" /></span>
        <div class="backup__password-text">
          <span class="backup__password-title">{{ passwordSet ? '已设置' : '未设置' }}</span>
          <span class="backup__desc">{{ passwordSet ? '导出的配置将加密，在新设备上还原时需要此密码' : '导出的配置为明文，包含所有图床密钥' }}</span>
        </div>
        <template v-if="passwordSet">
          <PnButton variant="secondary" size="md" class="backup__btn" @click="openPassword('change')">修改…</PnButton>
          <PnButton variant="secondary" size="md" class="backup__btn backup__btn--danger" @click="openPassword('disable')">关闭…</PnButton>
        </template>
        <PnButton v-else variant="secondary" size="md" class="backup__btn" @click="openPassword('set')">设置密码…</PnButton>
      </SettingsCard>
    </SettingsSection>

    <SettingsSection title="手动备份" note="导出文件包含所有图床密钥；设置了备份密码时会自动加密。">
      <SettingsCard large class="backup__manual" data-setting-row="manualBackup">
        <button v-for="item in MANUAL" :key="item.label" type="button" class="backup__link" @click="item.run">
          <span class="backup__link-label">{{ item.label }}</span>
          <span class="backup__desc">{{ item.hint }}</span>
          <PnIcon class="backup__chevron" name="chevronRight" :size="13" :stroke="2" />
        </button>
      </SettingsCard>
    </SettingsSection>

    <BackupRecent :refresh-key="recentKey" />

    <SyncTargetDialog v-model:open="targetOpen" />
    <PnDialog v-model:open="exportWarnOpen" title="先设置备份密码？" eyebrow="设置 › 备份与同步" icon="warning" tone="warning">
      导出文件包含所有图床密钥与 Token。设置密码后文件将加密保存。
      <template #footer>
        <PnButton variant="secondary" size="dialog" @click="exportDirectly">直接导出</PnButton>
        <PnButton variant="primary" size="dialog" data-autofocus @click="setPasswordFirst">先设置密码</PnButton>
      </template>
    </PnDialog>
    <BackupPasswordDialog
      ref="passwordDialog"
      v-model="passwordOpen"
      :mode="passwordMode"
      @confirm="onPasswordConfirm"
      @cancel="onPasswordCancel"
    />
  </div>
</template>

<style scoped>
.backup {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-settings-groups-backup);
}

.backup__password {
  flex-direction: row;
  align-items: center;
  gap: var(--pn-space-cloud-head-gap);
  padding: var(--pn-space-settings-password);
}

.backup__lock {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-settings-badge);
  height: var(--pn-size-settings-badge);
  border-radius: var(--pn-radius-lg);
  background: var(--pn-subtle);
  color: var(--pn-text2);
}

.backup__password-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.backup__password-title { font-weight: var(--pn-weight-medium); }

.backup__desc {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
}

.backup__btn { font-weight: var(--pn-weight-regular); }
.backup__btn--danger { color: var(--pn-danger); }

.backup__manual { overflow: hidden; }

.backup__link {
  display: flex;
  align-items: center;
  gap: var(--pn-space-12);
  min-height: var(--pn-size-settings-link-row);
  padding: 0 var(--pn-space-16);
  border: 0;
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  text-align: left;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 会打开弹窗 / 选文件的行：按下用设计稿 S10 里「正在导出」那一行的底色 */
.backup__link + .backup__link { border-top: 1px solid var(--pn-border); }
.backup__link:hover { background: var(--pn-row-hover); }
.backup__link:active { background: var(--pn-selected); }
.backup__link-label { flex: 1; }
.backup__chevron { flex: none; color: var(--pn-text3); }
</style>
