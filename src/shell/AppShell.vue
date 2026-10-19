<script setup lang="ts">
// 应用外壳（交接说明 3.1）：侧栏 208 / 窄窗口 56px 图标栏 + 主栏。
// 主栏铺满窗口；每个页面自己画顶部标题行（含窗口按钮）。
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useEventListener } from '@vueuse/core';
import { TooltipProvider } from 'reka-ui';
import AppSidebar from './AppSidebar.vue';
import NavRail from './NavRail.vue';
import { useSidebarCollapse } from './useSidebarCollapse';
import { useNavBadges } from './useNavBadges';
import { useAppNavigation } from './useAppNavigation';
import { useAppShortcuts } from './useAppShortcuts';
import { useGlobalUploadInput } from './useGlobalUploadInput';
import CommandPalette from './CommandPalette.vue';
import DropOverlay from './DropOverlay.vue';
import TransferCenter from './TransferCenter.vue';
import type { NavItem } from './navItems';
import { useUploadController } from '@/composables/upload/useUploadController';
import { useRecentUploads } from '@/composables/history/useRecentUploads';
import { createLogger } from '@/utils/logger';
import { installAutoCheck } from '@/views/health/autoCheck';
import { installEditorSync } from '@/composables/settings/editorSync';
import { installClipboardWatch } from '@/composables/upload/clipboardWatch';
import { installHealthBadge } from '@/views/health/healthBadge';
import { setUpdateInstallGate } from '@/composables/useAutoUpdate';
import { installAppPresence, isAppOnScreen } from '@/composables/appPresence';
import { installTray } from '@/tray/installTray';

const log = createLogger('AppShell');

const route = useRoute();
const router = useRouter();
const { narrow, collapsed, toggle } = useSidebarCollapse();
const badges = useNavBadges();
useAppNavigation();

// 上传在任何页面都能发起（拖入 / 粘贴 / 托盘 / 命令面板），控制器是应用级单例，第一次取在这里
const upload = useUploadController();
// 窗口隐藏到托盘 / 最小化时首页并不在屏：结果要靠通知（此时走系统通知）
upload.setHomeVisible(() => route.path === '/home' && isAppOnScreen());
const recentUploads = useRecentUploads();
// 装新版本 / 重启完成更新前，等正在进行的上传传完（交接说明 8.5）
setUpdateInstallGate(() => new Promise<void>((resolve) => {
  if (!upload.busy.value) { resolve(); return; }
  const stop = watch(upload.busy, (busy) => { if (!busy) { stop(); resolve(); } });
}));
const { overlay, receiving } = useGlobalUploadInput();
useAppShortcuts();

const disposers: UnlistenFn[] = [];
onMounted(async () => {
  // 链接健康：侧栏琥珀点与定期自动检测，应用开着就在（不必先打开那一页）
  disposers.push(installHealthBadge(), installAutoCheck());
  // 编辑器服务（Typora / Obsidian / CLI）的图床凭证：跟着配置走，不必先打开设置页
  disposers.push(installEditorSync());
  // 自动上传剪贴板：开关跟着配置走，后台发现新图片就照「粘贴上传」传
  disposers.push(installClipboardWatch(upload));
  // 主窗口在不在屏（决定通知走应用内还是系统通知）；托盘原生菜单与图标（交接说明 8.6）
  disposers.push(installAppPresence(), installTray(upload));
  // 两件事互不依赖：一件失败不能拖住另一件
  await Promise.all([
    upload.init().then((dispose) => disposers.push(dispose)).catch((error) => log.error('上传控制器初始化失败', error)),
    recentUploads.install().then((dispose) => disposers.push(dispose)).catch((error) => log.error('最近上传初始化失败', error)),
  ]);
});
onUnmounted(() => disposers.splice(0).forEach((dispose) => dispose()));

const currentPage = computed(() => route.meta.pageKey);

function navigate(item: NavItem): void {
  if (route.path !== item.path) void router.push(item.path);
}

// Ctrl+\（macOS ⌘\）手动收起 / 展开侧栏
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === '\\') {
    event.preventDefault();
    toggle();
  }
});
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="app-shell">
      <NavRail
        v-if="collapsed"
        :current="currentPage"
        :badges="badges"
        :can-expand="!narrow"
        :receiving="receiving"
        @navigate="navigate"
        @expand="toggle"
      />
      <AppSidebar
        v-else
        :current="currentPage"
        :badges="badges"
        :receiving="receiving"
        @navigate="navigate"
        @collapse="toggle"
      />
      <main class="app-shell__main">
        <div class="app-shell__page">
          <RouterView v-slot="{ Component, route: viewRoute }">
            <KeepAlive :max="5">
              <component :is="Component" :key="viewRoute.path" />
            </KeepAlive>
          </RouterView>
        </div>
        <DropOverlay :state="overlay" />
        <TransferCenter />
      </main>
    </div>
    <CommandPalette />
  </TooltipProvider>
</template>

<style scoped>
.app-shell {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--pn-canvas);
  color: var(--pn-text1);
  font-family: var(--pn-font-ui);
  font-size: var(--pn-text-body);
  line-height: 1.45;
}

.app-shell__main {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.app-shell__page {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

</style>
