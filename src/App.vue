<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import MainLayout from './components/layout/MainLayout.vue';
import OnboardingDialog from './components/onboarding/OnboardingDialog.vue';
import BackupPasswordDialog from './components/dialogs/BackupPasswordDialog.vue';
import Toast from 'primevue/toast';
import Button from 'primevue/button';
import ConfirmDialog from 'primevue/confirmdialog';
import { useUndoToast } from './composables/useUndoToast';
import { useThemeManager } from './composables/useTheme';
import { useToast } from './composables/useToast';
import { useOnboarding } from './composables/useOnboarding';
import { useGlobalShortcut } from './composables/useGlobalShortcut';
import { useAutoUpdate } from './composables/useAutoUpdate';
import { useServiceAvailability } from './composables/useServiceAvailability';
import { TOAST_MESSAGES } from './constants';
import { configStore } from './store/instances';
import { BackupPasswordRequiredError, secureStorage } from './crypto';
import { startupFlags } from './store/startupFlags';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { UserConfig } from './config/types';
import { historyDB } from './services/HistoryDatabase';
import { attachConsole } from '@tauri-apps/plugin-log';
import { createLogger } from './utils/logger';
import { getUserDataDir } from './utils/appPaths';

const log = createLogger('App');

// 仅在开发模式把 tauri-plugin-log 的日志同步到 DevTools console，便于调试
if (import.meta.env.DEV) {
  void attachConsole();
}

const { state: undoState, cancel: cancelUndo } = useUndoToast();

const { effectiveTheme, initializeTheme } = useThemeManager();
const toast = useToast();
const { checkAndShow: checkOnboarding } = useOnboarding();
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

const rootClass = computed(() => {
  return effectiveTheme.value === 'dark' ? 'dark-theme' : 'light-theme';
});

// 备份密码恢复对话框状态
const showPasswordDialog = ref(false);
const passwordDialogRef = ref<InstanceType<typeof BackupPasswordDialog>>();
/** 缓存的加密配置文件内容，密码验证成功后用于解密 */
let pendingEncryptedContent = '';

// 网络状态监听处理函数
function handleOffline() {
  toast.showConfig('warn', TOAST_MESSAGES.network.disconnected);
}

function handleOnline() {
  toast.showConfig('success', TOAST_MESSAGES.network.restored);
}

// 窗口恢复处理：休眠/后台回到前台时验证数据库连接
let unlistenFocus: (() => void) | null = null;

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

/** continueStartup 的安全包装：失败时兜底显示窗口 */
async function safeContinueStartup() {
  try {
    await continueStartup();
  } catch (err) {
    log.error('启动流程失败:', err);
    try { await getCurrentWindow().show(); } catch { /* ignore */ }
  }
}

/**
 * 处理用户输入备份密码后的恢复流程
 */
async function handlePasswordConfirm(password: string) {
  try {
    await secureStorage.initWithPassword(pendingEncryptedContent, password);
  } catch (err) {
    if (err instanceof Error && err.message === '迁移密码不正确') {
      passwordDialogRef.value?.onPasswordFailed();
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      toast.showConfig('error', { summary: '恢复失败', detail: msg });
    }
    return;
  }

  passwordDialogRef.value?.onPasswordSuccess();
  toast.showConfig('success', { summary: '配置恢复成功' });
  await safeContinueStartup();
}

/**
 * 用户选择跳过密码输入，使用默认配置
 */
async function handlePasswordSkip() {
  toast.showConfig('info', { summary: '已使用默认配置启动', detail: '你可以随时在「备份与同步」中输入迁移密码恢复' });
  pendingEncryptedContent = '';
  await safeContinueStartup();
}

/**
 * 正常启动流程：读配置 → 显示窗口 → 引导 → 快捷键 → 自动更新
 * 由 onMounted 和密码对话框回调共同调用
 */
async function continueStartup() {
  const config = await configStore.get<UserConfig>('config');
  const minimizeOnStart = config?.appBehavior?.minimizeToTrayOnStart ?? false;
  const closeToTray = config?.appBehavior?.closeToTray ?? true;
  await invoke('set_close_to_tray', { enabled: closeToTray });

  if (!minimizeOnStart) {
    await getCurrentWindow().show();
  } else {
    log.debug('启动时最小化到托盘，窗口保持隐藏');
  }

  await checkOnboarding();
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

  try {
    await continueStartup();
  } catch (err) {
    if (err instanceof BackupPasswordRequiredError) {
      log.debug('检测到迁移密码加密配置，等待用户输入密码');
      try { await getCurrentWindow().show(); } catch { /* ignore */ }

      try {
        const appDir = await getUserDataDir();
        const configPath = await join(appDir, '.settings.dat');
        pendingEncryptedContent = await readTextFile(configPath);
      } catch (readErr) {
        log.error('读取加密配置文件失败:', readErr);
      }

      showPasswordDialog.value = true;
      return;
    }

    log.error('启动失败:', err);
    try { await getCurrentWindow().show(); } catch { /* ignore */ }
  }

});

onUnmounted(() => {
  window.removeEventListener('offline', handleOffline);
  window.removeEventListener('online', handleOnline);
  document.removeEventListener('visibilitychange', handleAppResume);
  if (unlistenFocus) unlistenFocus();
  cleanupGlobalShortcuts().catch((e) => log.warn('快捷键清理失败:', e));
  if (periodicCheckIntervalId !== null) clearInterval(periodicCheckIntervalId);
  if (periodicCheckStopWatch) periodicCheckStopWatch();
});
</script>

<template>
  <div id="app" :class="rootClass">
    <MainLayout />

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

    <!-- 全局 Toast 通知 -->
    <Toast position="top-right" />

    <!-- 撤销倒计时 Toast -->
    <Toast group="undo" position="top-right">
      <template #message>
        <div class="undo-toast-content">
          <i class="pi pi-exclamation-triangle undo-toast-icon" />
          <span class="undo-toast-text">{{ undoState.summary }}</span>
          <span class="undo-toast-countdown">({{ undoState.remaining }}s)</span>
          <Button
            label="撤销"
            severity="secondary"
            size="small"
            text
            @click="cancelUndo"
          />
        </div>
      </template>
    </Toast>

    <!-- 全局确认对话框 -->
    <ConfirmDialog />
  </div>
</template>

<style>
/* 全局样式 - 不需要 scoped */
#app {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 撤销倒计时 Toast 内容布局 */
.undo-toast-content {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex: 1;
}

.undo-toast-icon {
  color: var(--error);
  flex-shrink: 0;
}

.undo-toast-text {
  flex: 1;
  font-size: var(--text-sm);
}

.undo-toast-countdown {
  font-size: var(--text-sm);
  font-weight: 600;
  opacity: 0.7;
  flex-shrink: 0;
}

/* 确保深色主题类应用到根元素 */
#app.dark-theme {
  color-scheme: dark;
}

#app.light-theme {
  color-scheme: light;
}
</style>
