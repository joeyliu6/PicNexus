// 应用级跳转：把托盘与应用内各处发来的「navigate-to」事件翻译成路由，
// 并把设置页的二级定位（tab / section）交给旧页面（provide/inject）。
// 旧页面按新设计重写后，对应的二级定位改由路由参数承担，这里的 provide 随之删除。

import { onMounted, onUnmounted, provide, ref } from 'vue';
import { useRouter } from 'vue-router';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { setupTrayMenu, type TrayUploadAction } from '@/services/trayMenu';
import { createLogger } from '@/utils/logger';
import { resolveNavigateTarget, type NavigatePayload, type NavigateTarget } from './navigatePayload';

const log = createLogger('AppNavigation');

export function useAppNavigation() {
  const router = useRouter();

  const settingsTargetTab = ref<string | null>(null);
  const settingsTargetSection = ref<string | null>(null);
  provide('settingsTargetTab', settingsTargetTab);
  provide('settingsTargetSection', settingsTargetSection);

  function go(target: NavigateTarget): void {
    if (target.settingsTab) settingsTargetTab.value = target.settingsTab;
    if (target.settingsSection) settingsTargetSection.value = target.settingsSection;
    router.push(target.path).catch((error) => log.warn('页面跳转失败', error));
  }

  const unlisteners: UnlistenFn[] = [];
  let disposed = false;

  function keep(unlisten: UnlistenFn): void {
    if (disposed) unlisten();
    else unlisteners.push(unlisten);
  }

  onMounted(async () => {
    keep(await listen<NavigatePayload>('navigate-to', (event) => {
      const target = resolveNavigateTarget(event.payload);
      if (target) go(target);
    }));
    keep(await listen<TrayUploadAction>('tray-action', (event) => {
      if (event.payload === 'upload_clipboard' || event.payload === 'select_upload_files') go({ path: '/home' });
    }));
    keep(await setupTrayMenu());
  });

  onUnmounted(() => {
    disposed = true;
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  });

  return { go };
}
