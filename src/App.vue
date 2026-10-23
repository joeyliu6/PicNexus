<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import AppShell from '@/shell/AppShell.vue';
import OnboardingDialog from '@/components/onboarding/OnboardingDialog.vue';
import BackupPasswordDialog from '@/components/dialogs/BackupPasswordDialog.vue';
import type { BackupPasswordConfirmPayload } from '@/components/dialogs/backupPasswordDialogTypes';
import PnToaster from '@/components/pn/PnToaster.vue';
import PnConfirmHost from '@/components/pn/PnConfirmHost.vue';
import { useThemeManager } from '@/composables/useTheme';
import { useToast } from '@/composables/useToast';
import { refreshAppPresence } from '@/composables/appPresence';
import { useOnboarding } from '@/composables/useOnboarding';
import { useGlobalShortcut } from '@/composables/useGlobalShortcut';
import { useAutoUpdate } from '@/composables/useAutoUpdate';
import { useServiceAvailability } from '@/composables/service/useServiceAvailability';
import { TOAST_MESSAGES } from '@/constants';
import { configStore, readFreshConfig } from '@/store/instances';
import { BackupPasswordRequiredError } from '@/security/crypto';
import { restoreWithPassword, setAsideEncryptedConfig, takeStartupNotice, type StartupNotice } from '@/security/startupRestore';
import { startupFlags } from '@/store/startupFlags';
import type { UserConfig } from '@/config/types';
import { historyDB } from '@/services/database';
import { attachConsole } from '@tauri-apps/plugin-log';
import { createLogger } from '@/utils/logger';
import { getErrorMessage } from '@/types/errors';

const log = createLogger('App');

// 仅在开发模式把 tauri-plugin-log 的日志同步到 DevTools console，便于调试
if (import.meta.env.DEV) {
  void attachConsole();
}

const { effectiveTheme, initializeTheme, updateConfig } = useThemeManager();
const toast = useToast();
const { checkAndShow: checkOnboarding, isVisible: onboardingVisible } = useOnboarding();
const { initGlobalShortcuts, cleanup: cleanupGlobalShortcuts } = useGlobalShortcut();
const { checkForUpdate } = useAutoUpdate();
const { checkAllAvailabilityWithCooldown, startPeriodicCheck } = useServiceAvailability();

let periodicCheckIntervalId: ReturnType<typeof setInterval> | null = null;
let periodicCheckStopWatch: (() => void) | null = null;

function ensurePeriodicCheckStarted() {
  if (periodicCheckIntervalId !== null || periodicCheckStopWatch !== null) return;
  const periodicCheck = startPeriodicCheck();
  periodicCheckIntervalId = periodicCheck.intervalId;
  periodicCheckStopWatch = periodicCheck.stopWatch;
}

// 备份密码恢复对话框状态
const showPasswordDialog = ref(false);
const passwordDialogRef = ref<InstanceType<typeof BackupPasswordDialog>>();

// 网络状态监听处理函数
function handleOffline() {
  toast.showConfig('warn', TOAST_MESSAGES.network.disconnected);
}

function handleOnline() {
  toast.showConfig('success', TOAST_MESSAGES.network.restored);
}

// 窗口恢复处理：休眠/后台回到前台时验证数据库连接
let unlistenFocus: (() => void) | null = null;
let unlistenConfigUpdate: UnlistenFn | null = null;

async function handleAppResume() {
  if (document.visibilityState !== 'visible') return;
  // 冷启动时窗口获得焦点会触发此回调，但数据库是懒加载的，从未打开过就别假装"重连"
  if (!historyDB.isInitialized()) return;
  log.debug('应用从后台恢复，验证数据库连接...');
  try {
    await historyDB.healthCheck();
  } catch {
    log.warn('数据库连接已失效，尝试重连...');
    try {
      await historyDB.reconnect();
      log.info('数据库重连成功');
    } catch (reconnectErr) {
      log.error('数据库重连失败:', reconnectErr);
    }
  }
}

/**
 * 启动还原备份配置（D01 / D02）：密码对了把密钥存进钥匙串，跳过则把加密配置另存在数据文件夹。
 * 两条路之后都整页重新加载——等密码时主题、上传器、上传控制器读配置已经失败一轮，接着往下走会停在空白首页。
 * 要弹的通知跨过重新加载，onMounted 取出、启动走完后由 announceStartupNotice 弹。
 */
async function handlePasswordConfirm(payload: BackupPasswordConfirmPayload) {
  if (payload.mode !== 'restore') return;

  try {
    if (await restoreWithPassword(payload.password) === 'wrong-password') {
      passwordDialogRef.value?.onPasswordFailed();
      return;
    }
  } catch (err) {
    passwordDialogRef.value?.resetLoading();
    toast.error('还原失败', `${getErrorMessage(err)}，请重试`);
    return;
  }

  passwordDialogRef.value?.onPasswordSuccess();
  window.location.reload();
}

async function handlePasswordSkip() {
  try {
    await setAsideEncryptedConfig();
  } catch (err) {
    log.error('另存加密配置失败:', err);
    toast.error('未能使用默认配置', `${getErrorMessage(err)}，请重试`);
    showPasswordDialog.value = true;
    return;
  }
  window.location.reload();
}

/** 重新加载前留下的通知；启动走完才弹（还原后的配置确实读得出来） */
let startupNotice: StartupNotice | null = null;
/** 带文件名的一整句，普通通知的 4 秒读不完 */
const SKIPPED_NOTICE_LIFE = 12_000;

/** 跳过还原后会接着弹新手引导：通知等引导关了再弹，免得盖住引导底栏的按钮 */
function announceStartupNotice() {
  const notice = startupNotice;
  startupNotice = null;
  if (!notice) return;
  const show = () => {
    if (notice.kind === 'restored') {
      toast.success('已还原备份配置');
      return;
    }
    toast.showConfig('info', {
      summary: '已使用默认配置启动',
      detail: `加密的配置已另存为 ${notice.file}（在数据文件夹中），可在 设置 › 备份与同步 中「从文件导入…」并输入备份密码还原`,
      life: SKIPPED_NOTICE_LIFE,
    });
  };
  if (!onboardingVisible.value) {
    show();
    return;
  }
  const stop = watch(onboardingVisible, (visible) => {
    if (visible) return;
    stop();
    show();
  });
}

/**
 * 正常启动流程：读配置 → 显示窗口 → 引导 → 快捷键 → 自动更新
 */
async function continueStartup() {
  const config = await configStore.get<UserConfig>('config');
  const minimizeOnStart = config?.appBehavior?.minimizeToTrayOnStart ?? false;
  const closeToTray = config?.appBehavior?.closeToTray ?? true;
  await invoke('set_close_to_tray', { enabled: closeToTray });

  if (!minimizeOnStart) {
    await getCurrentWindow().show();
    // 启动时显示窗口不一定换焦点：自己重判「在不在屏」，免得此后的通知都跑去系统通知
    await refreshAppPresence();
  } else {
    log.debug('启动时最小化到托盘，窗口保持隐藏');
  }

  await checkOnboarding();
  announceStartupNotice();
  await initGlobalShortcuts();
  ensurePeriodicCheckStarted();

  if (config?.autoUpdate?.enabled !== false) {
    setTimeout(() => {
      checkForUpdate().catch((e) => log.warn('自动检查更新失败:', e));
    }, 3000);
  }

  // 应用启动后触发首次图床可用性检测（非阻塞）
  checkAllAvailabilityWithCooldown().catch((e) => log.warn('图床可用性检测失败:', e));
}

onMounted(async () => {
  await initializeTheme();
  log.debug('主题初始化完成:', effectiveTheme.value);

  unlistenConfigUpdate = await listen('config-updated', async () => {
    try {
      // 事件可能来自托盘窗口（它也能切主题），必须绕开本窗口的陈旧缓存
      const latestConfig = await readFreshConfig();
      if (latestConfig) updateConfig(latestConfig);
    } catch (error) {
      log.warn('刷新主题配置失败:', error);
    }
  });

  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleAppResume);

  // Tauri 窗口焦点事件（双保险：visibilitychange 在某些系统休眠场景下可能不触发）
  getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) handleAppResume();
  }).then(unlisten => { unlistenFocus = unlisten; });

  if (startupFlags.configResetDueToKeyMismatch) {
    startupFlags.configResetDueToKeyMismatch = false;
    toast.showConfig('warn', TOAST_MESSAGES.config.keyMismatchReset);
  }

  if (startupFlags.orphanSecretLabels.length > 0) {
    const labels = startupFlags.orphanSecretLabels;
    startupFlags.orphanSecretLabels = [];
    toast.showConfig('warn', TOAST_MESSAGES.config.orphanSecretsCleared(labels));
  }

  startupNotice = takeStartupNotice();

  try {
    await continueStartup();
  } catch (err) {
    if (err instanceof BackupPasswordRequiredError) {
      log.debug('检测到迁移密码加密配置，等待用户输入密码');
      try { await getCurrentWindow().show(); await refreshAppPresence(); } catch { /* ignore */ }
      showPasswordDialog.value = true;
      return;
    }

    log.error('启动失败:', err);
    try { await getCurrentWindow().show(); await refreshAppPresence(); } catch { /* ignore */ }
  }

});

onUnmounted(() => {
  window.removeEventListener('offline', handleOffline);
  window.removeEventListener('online', handleOnline);
  document.removeEventListener('visibilitychange', handleAppResume);
  unlistenConfigUpdate?.();
  if (unlistenFocus) unlistenFocus();
  cleanupGlobalShortcuts().catch((e) => log.warn('快捷键清理失败:', e));
  if (periodicCheckIntervalId !== null) clearInterval(periodicCheckIntervalId);
  if (periodicCheckStopWatch) periodicCheckStopWatch();
});
</script>

<template>
  <div id="app">
    <AppShell />

    <!-- 首次使用引导 -->
    <OnboardingDialog />

    <!-- 备份密码恢复对话框 -->
    <BackupPasswordDialog
      ref="passwordDialogRef"
      v-model="showPasswordDialog"
      mode="restore"
      @confirm="handlePasswordConfirm"
      @skip="handlePasswordSkip"
    />

    <!-- 全局通知（右下角）与确认框 -->
    <PnToaster />
    <PnConfirmHost />
  </div>
</template>
