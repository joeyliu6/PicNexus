<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize, monitorFromPoint, PhysicalPosition } from '@tauri-apps/api/window';
import { DEFAULT_CONFIG, isPublicRiskService, type UserConfig } from '../../config/types';
import { configStore } from '../../store/instances';
import { useServiceHealth } from '../../composables/useServiceHealth';
import {
  applyTrayTheme,
  buildTrayMenuItems,
  createTrayMenuActions,
  openPublicServiceRiskSettings,
  toggleTrayService,
  toggleTrayTheme,
} from '../../services/trayMenu';
import TrayMenuList from './TrayMenuList.vue';
import TrayServiceFlyout from './TrayServiceFlyout.vue';

type MenuEntry = ReturnType<typeof buildTrayMenuItems>[number];

const MENU_WIDTH = 185;
const FLYOUT_WIDTH = 160;
const ITEM_HEIGHT = 26;
const LIST_PADDING = 8;
const SEPARATOR_BLOCK_HEIGHT = 5;
const MENU_PANEL_EXTRA_HEIGHT = 18;
const FLYOUT_PANEL_EXTRA_HEIGHT = 10;

interface WindowFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleFactor: number;
}

const config = ref<UserConfig>(structuredClone(DEFAULT_CONFIG));
const menuVisible = ref(false);
const flyoutOpen = ref(false);
const flyoutOpensLeft = ref(false);
const pendingServiceId = ref<string | null>(null);
const shellRef = ref<HTMLElement | null>(null);
const baseWindowPosition = ref<{ x: number; y: number } | null>(null);
const windowFrame = ref<WindowFrame | null>(null);
let unlistenConfig: UnlistenFn | null = null;
let unlistenFocus: UnlistenFn | null = null;
let unlistenOpened: UnlistenFn | null = null;
let unlistenHideRequested: UnlistenFn | null = null;

const actions = createTrayMenuActions();
const { healthStatusMap, loadHealthStatus, evaluateConfig } = useServiceHealth();
const menuItems = computed(() => buildTrayMenuItems(config.value, actions, healthStatusMap.value));

const serviceItems = computed(() => {
  const found = menuItems.value.find(
    (item): item is Extract<MenuEntry, { id: string; items: MenuEntry[] }> =>
      'id' in item && (item as { id: string }).id === 'current_service' && 'items' in item,
  );
  return found?.items ?? [];
});

const flyoutTopPx = computed(() => {
  let top = LIST_PADDING;
  for (const item of menuItems.value) {
    if ('item' in item && item.item === 'Separator') {
      top += 5;
    } else if ('id' in item && (item as { id: string }).id === 'current_service') {
      break;
    } else {
      top += ITEM_HEIGHT;
    }
  }
  return top;
});

const menuLeftPx = computed(() => {
  const base = baseWindowPosition.value;
  const frame = windowFrame.value;
  if (!base || !frame) return 0;
  return Math.max(0, Math.round((base.x - frame.left) / frame.scaleFactor));
});

const menuTopPx = computed(() => {
  const base = baseWindowPosition.value;
  const frame = windowFrame.value;
  if (!base || !frame) return 0;
  return Math.max(0, Math.round((base.y - frame.top) / frame.scaleFactor));
});

const menuPanelStyle = computed(() => ({
  width: `${MENU_WIDTH}px`,
  top: `${menuTopPx.value}px`,
  left: `${menuLeftPx.value}px`,
}));

const flyoutPanelStyle = computed(() => ({
  top: `${menuTopPx.value + flyoutTopPx.value}px`,
  left: `${flyoutOpensLeft.value ? menuLeftPx.value - FLYOUT_WIDTH : menuLeftPx.value + MENU_WIDTH}px`,
  width: `${FLYOUT_WIDTH}px`,
}));

function countSeparators(items: MenuEntry[]): number {
  return items.filter((item) => 'item' in item && item.item === 'Separator').length;
}

function countCommands(items: MenuEntry[]): number {
  return items.length - countSeparators(items);
}

function calculatePanelHeight(items: MenuEntry[], extraHeight: number): number {
  return countCommands(items) * ITEM_HEIGHT + countSeparators(items) * SEPARATOR_BLOCK_HEIGHT + extraHeight;
}

const menuPanelHeight = computed(() => calculatePanelHeight(menuItems.value, MENU_PANEL_EXTRA_HEIGHT));
const flyoutPanelHeight = computed(() =>
  flyoutOpen.value && serviceItems.value.length > 0
    ? calculatePanelHeight(serviceItems.value as MenuEntry[], FLYOUT_PANEL_EXTRA_HEIGHT)
    : 0,
);

const windowWidth = computed(() =>
  windowFrame.value ? Math.ceil(windowFrame.value.width / windowFrame.value.scaleFactor) : MENU_WIDTH,
);
const windowHeight = computed(() =>
  windowFrame.value
    ? Math.ceil(windowFrame.value.height / windowFrame.value.scaleFactor)
    : Math.max(menuPanelHeight.value, flyoutTopPx.value + flyoutPanelHeight.value),
);

async function cacheBaseWindowPosition(force = false): Promise<void> {
  if (baseWindowPosition.value && !force) return;

  const position = await getCurrentWindow().outerPosition();
  baseWindowPosition.value = { x: position.x, y: position.y };
}

async function resolveFlyoutDirection(monitor: Awaited<ReturnType<typeof monitorFromPoint>>): Promise<boolean> {
  if (!flyoutOpen.value || serviceItems.value.length === 0) return false;

  const base = baseWindowPosition.value;
  if (!base || !monitor) return false;

  const win = getCurrentWindow();
  const scaleFactor = await win.scaleFactor();

  const workAreaLeft = monitor.workArea.position.x;
  const workAreaRight = workAreaLeft + monitor.workArea.size.width;
  const menuRight = base.x + Math.round(MENU_WIDTH * scaleFactor);
  const flyoutWidth = Math.round(FLYOUT_WIDTH * scaleFactor);

  const canOpenRight = menuRight + flyoutWidth <= workAreaRight;
  const canOpenLeft = base.x - flyoutWidth >= workAreaLeft;

  return !canOpenRight && canOpenLeft;
}

async function resolveWindowFrame(base: { x: number; y: number }): Promise<[WindowFrame, Awaited<ReturnType<typeof monitorFromPoint>>] | null> {
  const monitor = await monitorFromPoint(base.x + 1, base.y + 1);
  if (!monitor) return null;

  const frame: WindowFrame = {
    left: monitor.workArea.position.x,
    top: monitor.workArea.position.y,
    width: monitor.workArea.size.width,
    height: monitor.workArea.size.height,
    scaleFactor: monitor.scaleFactor || await getCurrentWindow().scaleFactor(),
  };
  return [frame, monitor];
}

function clampBaseToFrame(base: { x: number; y: number }, frame: WindowFrame): { x: number; y: number } {
  const scaleFactor = frame.scaleFactor;
  const contentWidth = MENU_WIDTH + (flyoutOpen.value && !flyoutOpensLeft.value ? FLYOUT_WIDTH : 0);
  const leftPadding = flyoutOpen.value && flyoutOpensLeft.value ? FLYOUT_WIDTH * scaleFactor : 0;
  const minX = frame.left + leftPadding;
  const maxX = Math.max(minX, frame.left + frame.width - Math.round(contentWidth * scaleFactor));
  const contentHeight = Math.max(menuPanelHeight.value, flyoutTopPx.value + flyoutPanelHeight.value);
  const maxY = Math.max(frame.top, frame.top + frame.height - Math.round(contentHeight * scaleFactor));

  return {
    x: Math.min(Math.max(base.x, minX), maxX),
    y: Math.min(Math.max(base.y, frame.top), maxY),
  };
}

async function syncWindowLayout(): Promise<void> {
  await nextTick();
  await cacheBaseWindowPosition();

  const base = baseWindowPosition.value;
  let monitor: Awaited<ReturnType<typeof monitorFromPoint>> = null;
  if (base) {
    const result = await resolveWindowFrame(base);
    if (result) {
      [windowFrame.value, monitor] = result;
    }
  }

  flyoutOpensLeft.value = await resolveFlyoutDirection(monitor);
  await nextTick();

  if (baseWindowPosition.value && windowFrame.value) {
    baseWindowPosition.value = clampBaseToFrame(baseWindowPosition.value, windowFrame.value);
  }

  const win = getCurrentWindow();
  // resizable(false) 可能隐式 min_size = max_size = inner_size，block setSize
  await win.setMinSize(null);
  await win.setMaxSize(null);
  await win.setSize(new LogicalSize(windowWidth.value, windowHeight.value));

  const frame = windowFrame.value;
  if (frame) {
    await win.setPosition(new PhysicalPosition(frame.left, frame.top));
  }
}

async function loadConfig(): Promise<void> {
  const nextConfig = await configStore.get<UserConfig>('config') ?? structuredClone(DEFAULT_CONFIG);
  config.value = nextConfig;
  applyTrayTheme(nextConfig);
}

async function hideSelf(): Promise<void> {
  menuVisible.value = false;
  flyoutOpen.value = false;
  await nextTick();
  await getCurrentWindow().hide();
}

async function handleCommand(id: string): Promise<void> {
  if (id === 'toggle_theme') {
    await toggleTrayTheme();
    await loadConfig();
    await nextTick();
    shellRef.value?.focus();
    return;
  }

  await hideSelf();
  switch (id) {
    case 'open_window': actions.openWindow(); break;
    case 'upload_clipboard': actions.uploadClipboard(); break;
    case 'select_upload_files': actions.selectUploadFiles(); break;
    case 'open_history': actions.openHistory(); break;
    case 'quit': actions.quit(); break;
  }
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!(event.target instanceof Node)) return;

  const menuPanel = shellRef.value?.querySelector('.menu-panel');
  const flyoutPanel = shellRef.value?.querySelector('.flyout-panel');
  const clickedMenu = menuPanel?.contains(event.target) ?? false;
  const clickedFlyout = flyoutPanel?.contains(event.target) ?? false;

  if (!clickedMenu && !clickedFlyout) {
    void hideSelf();
  }
}

async function handleOpenFlyout(): Promise<void> {
  if (flyoutOpen.value) return;
  flyoutOpen.value = true;
  await syncWindowLayout();
}

async function handleToggleFlyout(): Promise<void> {
  flyoutOpen.value = !flyoutOpen.value;
  await syncWindowLayout();
}

async function closeFlyout(): Promise<void> {
  if (!flyoutOpen.value) return;
  flyoutOpen.value = false;
  await syncWindowLayout();
}

async function handleToggleService(serviceId: string): Promise<void> {
  if (pendingServiceId.value) return;
  pendingServiceId.value = serviceId;
  try {
    if (
      isPublicRiskService(serviceId)
      && !(config.value.enabledServices ?? []).includes(serviceId)
      && !config.value.publicServiceRiskAccepted
    ) {
      await hideSelf();
      await openPublicServiceRiskSettings(serviceId);
      return;
    }

    const nextEnabledServices = await toggleTrayService(serviceId);
    config.value = {
      ...config.value,
      enabledServices: nextEnabledServices,
    };
    await nextTick();
    shellRef.value?.focus();
  } finally {
    pendingServiceId.value = null;
  }
}

onMounted(async () => {
  await loadConfig();
  await loadHealthStatus();
  evaluateConfig(config.value);
  await syncWindowLayout();
  await nextTick();
  shellRef.value?.focus();
  document.addEventListener('pointerdown', handleDocumentPointerDown, true);

  unlistenConfig = await listen('config-updated', async ({ payload }) => {
    if (
      typeof payload === 'object'
      && payload !== null
      && (payload as { source?: unknown }).source === 'tray-menu'
    ) {
      return;
    }
    await loadConfig();
    await syncWindowLayout();
  });
  unlistenOpened = await listen('tray-menu-opened', async () => {
    menuVisible.value = false;
    flyoutOpen.value = false;
    await loadConfig();
    await cacheBaseWindowPosition(true);
    await syncWindowLayout();
    await nextTick();
    menuVisible.value = true;
    await nextTick();
    shellRef.value?.focus();
  });
  unlistenHideRequested = await listen('tray-menu-hide-requested', async () => {
    await hideSelf();
  });
  unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (!focused) void hideSelf();
  });
});

onUnmounted(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  unlistenConfig?.();
  unlistenFocus?.();
  unlistenOpened?.();
  unlistenHideRequested?.();
});
</script>

<template>
  <div
    ref="shellRef"
    class="tray-shell"
    tabindex="-1"
    @keydown.escape.stop.prevent="void hideSelf()"
  >
    <div
      v-show="menuVisible"
      class="tray-content"
    >
      <div class="menu-panel main-menu" :style="menuPanelStyle">
        <TrayMenuList
          :items="menuItems"
          :flyout-open="flyoutOpen"
          @command="handleCommand"
          @open-flyout="handleOpenFlyout"
          @toggle-flyout="handleToggleFlyout"
          @close-flyout="closeFlyout"
        />
      </div>

      <div
        v-if="flyoutOpen && serviceItems.length > 0"
        class="flyout-panel service-menu"
        :style="flyoutPanelStyle"
      >
        <TrayServiceFlyout
          :items="serviceItems"
          @mouseleave="void closeFlyout()"
          @toggle="handleToggleService"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.tray-shell {
  position: relative;
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  letter-spacing: 0;
  user-select: none;
  outline: none;
}

.tray-content {
  position: relative;
  width: 100%;
  height: 100%;
}

.menu-panel {
  position: absolute;
  box-sizing: border-box;
  border: none;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  overflow: hidden;
  padding: var(--space-xs) 0;
  box-shadow: var(--shadow-float);
}

.flyout-panel {
  position: absolute;
  box-sizing: border-box;
  border: none;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  overflow: hidden;
  box-shadow: var(--shadow-float);
}
</style>
