<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import MainLayout from './components/layout/MainLayout.vue';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import { useThemeManager } from './composables/useTheme';
import { useToast } from './composables/useToast';
import { TOAST_MESSAGES } from './constants';
import { Store } from './store';
import type { UserConfig } from './config/types';

const { effectiveTheme, initializeTheme } = useThemeManager();
const toast = useToast();

const rootClass = computed(() => {
  return effectiveTheme.value === 'dark' ? 'dark-theme' : 'light-theme';
});

// 网络状态监听处理函数
function handleOffline() {
  toast.showConfig('warn', TOAST_MESSAGES.network.disconnected);
}

function handleOnline() {
  toast.showConfig('success', TOAST_MESSAGES.network.restored);
}

onMounted(async () => {
  // 初始化主题系统
  await initializeTheme();
  console.log('[App] Theme initialized:', effectiveTheme.value);

  // 添加网络状态监听
  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);
  console.log('[App] Network listeners registered');

  // 前端加载完成后显示窗口（避免启动时白屏闪烁）
  // 如果开启了"启动时最小化到托盘"，则不显示窗口
  try {
    const configStore = new Store('.settings.dat');
    const config = await configStore.get<UserConfig>('config');
    const minimizeOnStart = config?.appBehavior?.minimizeToTrayOnStart ?? false;

    if (!minimizeOnStart) {
      const appWindow = getCurrentWindow();
      await appWindow.show();
      console.log('[App] Window shown');
    } else {
      console.log('[App] 启动时最小化到托盘，窗口保持隐藏');
    }
  } catch (err) {
    console.error('[App] 显示窗口失败:', err);
    // 出错时兜底显示窗口
    try { await getCurrentWindow().show(); } catch { /* ignore */ }
  }
});

onUnmounted(() => {
  // 清理网络状态监听
  window.removeEventListener('offline', handleOffline);
  window.removeEventListener('online', handleOnline);
  console.log('[App] Network listeners cleaned up');
});
</script>

<template>
  <div id="app" :class="rootClass">
    <MainLayout />

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
