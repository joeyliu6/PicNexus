<script setup lang="ts">
import { ref, computed, KeepAlive, Transition } from 'vue';
import TitleBar from './TitleBar.vue';
import Sidebar from './Sidebar.vue';
import UploadView from '../views/UploadView.vue';
import HistoryView from '../views/HistoryView.vue';
import R2ManagerView from '../views/R2ManagerView.vue';
import LinkCheckerView from '../views/LinkCheckerView.vue';
import SettingsView from '../views/SettingsView.vue';

type ViewType = 'upload' | 'history' | 'r2-manager' | 'link-checker' | 'settings';

// 组件映射对象
const viewComponents = {
  upload: UploadView,
  history: HistoryView,
  'r2-manager': R2ManagerView,
  'link-checker': LinkCheckerView,
  settings: SettingsView
} as const;

const currentView = ref<ViewType>('upload');

// 计算当前应该显示的组件
const currentViewComponent = computed(() => viewComponents[currentView.value]);

const handleNavigate = (view: ViewType) => {
  currentView.value = view;
};
</script>

<template>
  <div class="main-layout">
    <TitleBar />
    <div class="dashboard-container">
      <Sidebar @navigate="handleNavigate" />
      <div class="content-area">
        <!-- 使用 Transition 添加淡入淡出动画 -->
        <!-- 使用 KeepAlive 缓存组件，避免重复销毁和创建 -->
        <Transition name="view-fade" mode="out-in">
          <KeepAlive :max="6">
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
  transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.view-fade-enter-from {
  opacity: 0;
}

.view-fade-leave-to {
  opacity: 0;
}
</style>
