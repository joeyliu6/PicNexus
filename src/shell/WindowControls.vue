<script setup lang="ts">
// 窗口按钮：Windows 46×40 方形三键；Linux 24px 圆形三键（GNOME）；macOS 用系统红绿灯，这里不画。
// 关闭键的语义是「隐藏到托盘」。
import { getCurrentWindow } from '@tauri-apps/api/window';
import PnIcon from '@/components/pn/PnIcon.vue';
import { refreshAppPresence } from '@/composables/appPresence';
import { uiPlatform } from '@/utils/platform';

const platform = uiPlatform();
const appWindow = getCurrentWindow();

// 隐藏 / 最小化之后马上重新判断「在不在屏」：此后的通知改走系统通知（appPresence）
const minimize = () => { void appWindow.minimize().then(refreshAppPresence); };
const toggleMaximize = () => { void appWindow.toggleMaximize(); };
const hideToTray = () => { void appWindow.hide().then(refreshAppPresence); };
</script>

<template>
  <div v-if="platform === 'windows'" class="window-controls window-controls--windows">
    <button type="button" class="window-controls__win" aria-label="最小化" @click="minimize">
      <PnIcon name="winMinimize" :size="12" :stroke="1.4" />
    </button>
    <button type="button" class="window-controls__win" aria-label="最大化" @click="toggleMaximize">
      <PnIcon name="winMaximize" :size="11" :stroke="1.6" />
    </button>
    <button type="button" class="window-controls__win window-controls__win--close" aria-label="隐藏到托盘" title="隐藏到托盘" @click="hideToTray">
      <PnIcon name="winClose" :size="12" :stroke="1.4" />
    </button>
  </div>
  <div v-else-if="platform === 'linux'" class="window-controls window-controls--linux">
    <button type="button" class="window-controls__linux" aria-label="最小化" @click="minimize">
      <PnIcon name="linuxMinimize" :size="10" :stroke="2.4" />
    </button>
    <button type="button" class="window-controls__linux" aria-label="最大化" @click="toggleMaximize">
      <PnIcon name="linuxMaximize" :size="9" :stroke="2.4" />
    </button>
    <button type="button" class="window-controls__linux" aria-label="隐藏到托盘" title="隐藏到托盘" @click="hideToTray">
      <PnIcon name="linuxClose" :size="10" :stroke="2.4" />
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  display: flex;
  flex: none;
  align-self: flex-start;
}

.window-controls--linux {
  align-items: center;
  height: var(--pn-size-title-bar);
  gap: var(--pn-space-linux-button-gap);
  padding-right: var(--pn-space-12);
}

.window-controls__win,
.window-controls__linux {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  color: var(--pn-text1);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.window-controls__win {
  width: var(--pn-size-win-button-w);
  height: var(--pn-size-win-button-h);
  background: transparent;
}

.window-controls__win:hover { background: var(--pn-selected); }

.window-controls__win--close:hover {
  background: var(--pn-window-close-hover);
  color: var(--pn-window-close-fg);
}

.window-controls__linux {
  width: var(--pn-size-linux-button);
  height: var(--pn-size-linux-button);
  border-radius: 50%;
  background: var(--pn-subtle);
}

.window-controls__linux:hover { background: var(--pn-border); }
</style>
