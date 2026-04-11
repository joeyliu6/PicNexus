<script setup lang="ts">
import { ref, computed, provide, onMounted, onUnmounted } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import TitleBar from './TitleBar.vue';
import Sidebar from './Sidebar.vue';
import UploadView from '../views/UploadView.vue';
import HistoryView from '../views/HistoryView.vue';
import LinkCheckView from '../views/LinkCheckView.vue';
import SettingsView from '../views/SettingsView.vue';

type ViewType = 'upload' | 'history' | 'link-check' | 'settings';

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

const linkCheckTargetTab = ref<string | null>(null);
provide('linkCheckTargetTab', linkCheckTargetTab);

const handleNavigate = (view: ViewType) => {
  currentView.value = view;
};

// 托盘菜单导航事件监听器
let unlistenNavigate: UnlistenFn | null = null;

onMounted(async () => {
  // 监听导航事件（来自托盘菜单或应用内跳转）
  // payload 支持两种格式：
  // - 字符串: 'settings' | 'history'
  // - 对象: { view: 'settings', tab: 'hosting' }
  unlistenNavigate = await listen<string | { view: string; tab?: string }>('navigate-to', (event) => {
    const payload = event.payload;

    if (typeof payload === 'string') {
      if (payload === 'settings' || payload === 'history' || payload === 'link-check') {
        handleNavigate(payload);
      }
    } else if (payload && typeof payload === 'object') {
      const { view, tab } = payload;
      if (view === 'settings' || view === 'history' || view === 'upload' || view === 'link-check') {
        if (view === 'settings' && tab) {
          settingsTargetTab.value = tab;
        }
        if (view === 'link-check' && tab) {
          linkCheckTargetTab.value = tab;
        }
        handleNavigate(view as ViewType);
      }
    }
  });
});

onUnmounted(() => {
  // 清理事件监听器
  if (unlistenNavigate) {
    unlistenNavigate();
    unlistenNavigate = null;
  }
});
</script>

<template>
  <div class="main-layout">
    <TitleBar />
    <div class="dashboard-container">
      <Sidebar :current-view="currentView" @navigate="handleNavigate" />
      <div class="content-area">
        <!-- 使用 Transition 添加淡入淡出动画 -->
        <!-- 使用 KeepAlive 缓存组件，避免重复销毁和创建 -->
        <Transition name="view-fade" mode="out-in">
          <KeepAlive :max="4">
            <component :is="currentViewComponent" :key="currentView" />
          </KeepAlive>
        </Transition>
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

/* 视图切换过渡动画 */
.view-fade-enter-active,
.view-fade-leave-active {
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.view-fade-enter-from {
  opacity: 0;
}

.view-fade-leave-to {
  opacity: 0;
}
</style>
