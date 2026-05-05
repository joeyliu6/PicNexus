<script setup lang="ts">
import { ref, computed, provide, onMounted, onUnmounted } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import TitleBar from './TitleBar.vue';
import Sidebar from './Sidebar.vue';
import UploadView from '../views/UploadView.vue';
import HistoryView from '../views/HistoryView.vue';
import LinkCheckView from '../views/LinkCheckView.vue';
import SettingsView from '../views/SettingsView.vue';
import { setupTrayMenu, type TrayUploadAction } from '../../services/trayMenu';

type ViewType = 'upload' | 'history' | 'link-check' | 'settings';
type TrayAction = TrayUploadAction;

// 组件映射对象
const viewComponents = {
  upload: UploadView,
  history: HistoryView,
  'link-check': LinkCheckView,
  settings: SettingsView
} as const;

const currentView = ref<ViewType>('upload');

// 计算当前应该显示的组件
const currentViewComponent = computed(() => viewComponents[currentView.value]);

// 设置页面需要激活的 tab（用于从其他页面跳转到指定设置面板）
const settingsTargetTab = ref<string | null>(null);
provide('settingsTargetTab', settingsTargetTab);

// 设置页面内需要展开的 section（用于跳转到 tab 后再展开内部折叠卡片）
const settingsTargetSection = ref<string | null>(null);
provide('settingsTargetSection', settingsTargetSection);

const linkCheckTargetTab = ref<string | null>(null);
provide('linkCheckTargetTab', linkCheckTargetTab);

const handleNavigate = (view: ViewType) => {
  currentView.value = view;
};

const handleTrayAction = (action: TrayAction) => {
  if (action === 'upload_clipboard' || action === 'select_upload_files') {
    handleNavigate('upload');
  }
};

// 托盘菜单导航事件监听器
let unlistenNavigate: UnlistenFn | null = null;
let unlistenTrayAction: UnlistenFn | null = null;
let unlistenTrayMenu: UnlistenFn | null = null;

onMounted(async () => {
  // 监听导航事件（来自托盘菜单或应用内跳转）
  // payload 支持两种格式：
  // - 字符串: 'upload' | 'settings' | 'history' | 'link-check'
  // - 对象: { view: 'settings', tab: 'hosting' }
  unlistenNavigate = await listen<string | { view: string; tab?: string; section?: string }>('navigate-to', (event) => {
    const payload = event.payload;

    if (typeof payload === 'string') {
      if (payload === 'upload' || payload === 'settings' || payload === 'history' || payload === 'link-check') {
        handleNavigate(payload);
      }
    } else if (payload && typeof payload === 'object') {
      const { view, tab, section } = payload;
      if (view === 'settings' || view === 'history' || view === 'upload' || view === 'link-check') {
        if (view === 'settings' && tab) {
          settingsTargetTab.value = tab;
        }
        if (view === 'settings' && section) {
          settingsTargetSection.value = section;
        }
        if (view === 'link-check' && tab) {
          linkCheckTargetTab.value = tab;
        }
        handleNavigate(view as ViewType);
      }
    }
  });

  unlistenTrayAction = await listen<TrayAction>('tray-action', (event) => {
    handleTrayAction(event.payload);
  });

  unlistenTrayMenu = await setupTrayMenu();
});

onUnmounted(() => {
  // 清理事件监听器
  if (unlistenNavigate) {
    unlistenNavigate();
    unlistenNavigate = null;
  }
  if (unlistenTrayAction) {
    unlistenTrayAction();
    unlistenTrayAction = null;
  }
  if (unlistenTrayMenu) {
    unlistenTrayMenu();
    unlistenTrayMenu = null;
  }
});
</script>

<template>
  <div class="main-layout">
    <TitleBar />
    <div class="dashboard-container">
      <Sidebar :current-view="currentView" @navigate="handleNavigate" />
      <div class="content-area">
        <!-- KeepAlive 缓存四个视图组件，切换瞬时无动画 -->
        <KeepAlive :max="4">
          <component :is="currentViewComponent" :key="currentView" />
        </KeepAlive>
      </div>
    </div>
  </div>
</template>

<style scoped>
.main-layout {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-app);
}

.dashboard-container {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.content-area {
  flex: 1;
  overflow: auto;
  background: var(--bg-app);
}
</style>
