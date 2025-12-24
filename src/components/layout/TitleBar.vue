<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';

// 获取当前窗口实例
const appWindow = getCurrentWindow();

// 窗口控制
const minimizeWindow = () => {
  appWindow.minimize();
};

const toggleMaximize = () => {
  appWindow.toggleMaximize();
};

const closeWindow = () => {
  appWindow.close();
};
</script>

<template>
  <div class="titlebar" data-tauri-drag-region>
    <div class="titlebar-drag-region" data-tauri-drag-region>
      <span class="app-title">PicNexus</span>
    </div>
    <div class="titlebar-controls">
      <button class="titlebar-button" @click="minimizeWindow" title="最小化">
        <i class="pi pi-minus"></i>
      </button>
      <button class="titlebar-button" @click="toggleMaximize" title="最大化/还原">
        <i class="pi pi-window-maximize"></i>
      </button>
      <button class="titlebar-button close" @click="closeWindow" title="关闭">
        <i class="pi pi-times"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 32px;
  background: var(--bg-titlebar);
  border-bottom: 1px solid var(--border-subtle);
  user-select: none;
  flex-shrink: 0;
}

.titlebar-drag-region {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 12px;
}

.app-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.5px;
}

.titlebar-controls {
  display: flex;
  height: 100%;
}

.titlebar-button {
  width: 46px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  transition: background-color 0.15s;
  padding: 0;
}

.titlebar-button:hover {
  background: var(--hover-overlay);
}

.titlebar-button.close:hover {
  background: var(--error);
  color: var(--text-on-error);
}

.titlebar-button i {
  font-size: 0.9rem;
}
</style>
