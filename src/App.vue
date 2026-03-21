<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import MainLayout from './components/layout/MainLayout.vue';
import OnboardingDialog from './components/onboarding/OnboardingDialog.vue';
import BackupPasswordDialog from './components/dialogs/BackupPasswordDialog.vue';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import { useThemeManager } from './composables/useTheme';
import { useToast } from './composables/useToast';
import { useOnboarding } from './composables/useOnboarding';
import { useGlobalShortcut } from './composables/useGlobalShortcut';
import { useAutoUpdate } from './composables/useAutoUpdate';
import { TOAST_MESSAGES } from './constants';
import { configStore } from './store/instances';
import { BackupPasswordRequiredError, secureStorage } from './crypto';
import { startupFlags } from './store/startupFlags';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import type { UserConfig } from './config/types';

const { effectiveTheme, initializeTheme } = useThemeManager();
const toast = useToast();
const { checkAndShow: checkOnboarding } = useOnboarding();
const { initGlobalShortcuts, cleanup: cleanupGlobalShortcuts } = useGlobalShortcut();
const { checkForUpdate } = useAutoUpdate();

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

/** continueStartup 的安全包装：失败时兜底显示窗口 */
async function safeContinueStartup() {
  try {
    await continueStartup();
  } catch (err) {
    console.error('[App] 启动流程失败:', err);
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
    console.log('[App] Window shown');
  } else {
    console.log('[App] 启动时最小化到托盘，窗口保持隐藏');
  }

  await checkOnboarding();
  await initGlobalShortcuts();

  if (config?.autoUpdate?.enabled !== false) {
    setTimeout(() => {
      checkForUpdate().catch((e) => console.warn('[App] 自动检查更新失败:', e));
    }, 3000);
  }
}

onMounted(async () => {
  await initializeTheme();
  console.log('[App] Theme initialized:', effectiveTheme.value);

  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);
  console.log('[App] Network listeners registered');

  if (startupFlags.configResetDueToKeyMismatch) {
    startupFlags.configResetDueToKeyMismatch = false;
    toast.showConfig('warn', TOAST_MESSAGES.config.keyMismatchReset);
  }

  try {
    await continueStartup();
  } catch (err) {
    if (err instanceof BackupPasswordRequiredError) {
      console.log('[App] 检测到迁移密码加密配置，等待用户输入密码');
      try { await getCurrentWindow().show(); } catch { /* ignore */ }

      try {
        const appDir = await appDataDir();
        const configPath = await join(appDir, '.settings.dat');
        pendingEncryptedContent = await readTextFile(configPath);
      } catch (readErr) {
        console.error('[App] 读取加密配置文件失败:', readErr);
      }

      showPasswordDialog.value = true;
      return;
    }

    console.error('[App] 启动失败:', err);
    try { await getCurrentWindow().show(); } catch { /* ignore */ }
  }
});

onUnmounted(() => {
  window.removeEventListener('offline', handleOffline);
  window.removeEventListener('online', handleOnline);
  cleanupGlobalShortcuts().catch((e) => console.warn('[App] 快捷键清理失败:', e));
  console.log('[App] Cleanup completed');
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

/* 确保深色主题类应用到根元素 */
#app.dark-theme {
  color-scheme: dark;
}

#app.light-theme {
  color-scheme: light;
}
</style>
