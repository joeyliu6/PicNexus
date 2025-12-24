<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import MainLayout from './components/layout/MainLayout.vue';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import { useThemeManager } from './composables/useTheme';
import { useToast } from './composables/useToast';

const { currentTheme, initializeTheme } = useThemeManager();
const toast = useToast();

// 计算根元素的类名
const rootClass = computed(() => {
  return currentTheme.value === 'dark' ? 'dark-theme' : 'light-theme';
});

// 网络状态监听处理函数
function handleOffline() {
  toast.warn('网络已断开', '请检查网络连接');
}

function handleOnline() {
  toast.success('网络已恢复', '可以继续上传');
}

onMounted(async () => {
  // 初始化主题系统
  await initializeTheme();
  console.log('[App] Theme initialized:', currentTheme.value);

  // 添加网络状态监听
  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);
  console.log('[App] Network listeners registered');

  // 前端加载完成后显示窗口（避免启动时白屏闪烁）
  try {
    const appWindow = getCurrentWindow();
    await appWindow.show();
    console.log('[App] Window shown');
  } catch (err) {
    console.error('[App] 显示窗口失败:', err);
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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
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
