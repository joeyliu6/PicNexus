<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize, monitorFromPoint, PhysicalPosition } from '@tauri-apps/api/window';
import { DEFAULT_CONFIG, isPublicRiskService, type UserConfig } from '../../config/types';
import { configStore } from '../../store/instances';
import {
  buildTrayMenuItems,
  createTrayMenuActions,
  hideTrayMenuWindow,
  openPublicServiceRiskSettings,
  toggleTrayService,
} from '../../services/trayMenu';
import TrayMenuList from './TrayMenuList.vue';
import TrayServiceFlyout from './TrayServiceFlyout.vue';

type MenuEntry = ReturnType<typeof buildTrayMenuItems>[number];

const MENU_WIDTH = 240;
const FLYOUT_WIDTH = 180;
const ITEM_HEIGHT = 26;
const LIST_PADDING = 8;
const SEPARATOR_BLOCK_HEIGHT = 5;
const MENU_PANEL_EXTRA_HEIGHT = 18;
const FLYOUT_PANEL_EXTRA_HEIGHT = 10;

const config = ref<UserConfig>(structuredClone(DEFAULT_CONFIG));
const flyoutOpen = ref(false);
const flyoutOpensLeft = ref(false);
const pendingServiceId = ref<string | null>(null);
const shellRef = ref<HTMLElement | null>(null);
const baseWindowPosition = ref<{ x: number; y: number } | null>(null);
let unlistenConfig: UnlistenFn | null = null;
let unlistenFocus: UnlistenFn | null = null;
let unlistenOpened: UnlistenFn | null = null;

const actions = createTrayMenuActions();
const menuItems = computed(() => buildTrayMenuItems(config.value, actions));

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

const menuPanelStyle = computed(() => ({
  width: `${MENU_WIDTH}px`,
  transform: flyoutOpensLeft.value ? `translateX(${FLYOUT_WIDTH}px)` : 'translateX(0)',
}));

const flyoutPanelStyle = computed(() => ({
  top: `${flyoutTopPx.value}px`,
  left: flyoutOpensLeft.value ? '0px' : `${MENU_WIDTH}px`,
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

const windowWidth = computed(() => MENU_WIDTH + (flyoutOpen.value ? FLYOUT_WIDTH : 0));
const windowHeight = computed(() =>
  Math.max(menuPanelHeight.value, flyoutTopPx.value + flyoutPanelHeight.value),
);

async function cacheBaseWindowPosition(force = false): Promise<void> {
  if (baseWindowPosition.value && !force) return;

  const position = await getCurrentWindow().outerPosition();
  baseWindowPosition.value = { x: position.x, y: position.y };
}

async function resolveFlyoutDirection(): Promise<boolean> {
  if (!flyoutOpen.value || serviceItems.value.length === 0) return false;

  await cacheBaseWindowPosition();
  const base = baseWindowPosition.value;
  if (!base) return false;

  const win = getCurrentWindow();
  const scaleFactor = await win.scaleFactor();
  const monitor = await monitorFromPoint(base.x + 1, base.y + 1);
  if (!monitor) return false;

  const workAreaLeft = monitor.workArea.position.x;
  const workAreaRight = workAreaLeft + monitor.workArea.size.width;
  const menuRight = base.x + Math.round(MENU_WIDTH * scaleFactor);
  const flyoutWidth = Math.round(FLYOUT_WIDTH * scaleFactor);

  const canOpenRight = menuRight + flyoutWidth <= workAreaRight;
  const canOpenLeft = base.x - flyoutWidth >= workAreaLeft;

  return !canOpenRight && canOpenLeft;
}

async function clampWindowPosition(
  base: { x: number; y: number },
  width: number,
  height: number,
  scaleFactor: number,
): Promise<{ x: number; y: number }> {
  const monitor = await monitorFromPoint(base.x + 1, base.y + 1);
  if (!monitor) return base;

  const workAreaLeft = monitor.workArea.position.x;
  const workAreaTop = monitor.workArea.position.y;
  const workAreaRight = workAreaLeft + monitor.workArea.size.width;
  const workAreaBottom = workAreaTop + monitor.workArea.size.height;
  const physicalWidth = Math.round(width * scaleFactor);
  const physicalHeight = Math.round(height * scaleFactor);

  return {
    x: Math.min(Math.max(base.x, workAreaLeft), Math.max(workAreaLeft, workAreaRight - physicalWidth)),
    y: Math.min(Math.max(base.y, workAreaTop), Math.max(workAreaTop, workAreaBottom - physicalHeight)),
  };
}

async function syncWindowLayout(): Promise<void> {
  await nextTick();
  await cacheBaseWindowPosition();

  flyoutOpensLeft.value = await resolveFlyoutDirection();
  await nextTick();

  const win = getCurrentWindow();
  // resizable(false) 可能隐式 min_size = max_size = inner_size，block setSize
  await win.setMinSize(null);
  await win.setMaxSize(null);
  await win.setSize(new LogicalSize(windowWidth.value, windowHeight.value));

  const base = baseWindowPosition.value;
  if (!base) return;

  const scaleFactor = await win.scaleFactor();
  const targetBase = flyoutOpen.value && flyoutOpensLeft.value
    ? { x: base.x - Math.round(FLYOUT_WIDTH * scaleFactor), y: base.y }
    : base;
  const target = await clampWindowPosition(targetBase, windowWidth.value, windowHeight.value, scaleFactor);
  await win.setPosition(new PhysicalPosition(target.x, target.y));
}

async function loadConfig(): Promise<void> {
  config.value = await configStore.get<UserConfig>('config') ?? structuredClone(DEFAULT_CONFIG);
}

async function hideSelf(): Promise<void> {
  flyoutOpen.value = false;
  await getCurrentWindow().hide();
}

async function handleCommand(id: string): Promise<void> {
  await hideSelf();
  switch (id) {
    case 'open_window': actions.openWindow(); break;
    case 'upload_clipboard': actions.uploadClipboard(); break;
    case 'select_upload_files': actions.selectUploadFiles(); break;
    case 'open_history': actions.openHistory(); break;
    case 'quit': actions.quit(); break;
  }
}

async function handleOpenFlyout(): Promise<void> {
  flyoutOpen.value = !flyoutOpen.value;
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

    await toggleTrayService(serviceId);
    await loadConfig();
    await syncWindowLayout();
    shellRef.value?.focus();
  } finally {
    pendingServiceId.value = null;
  }
}

onMounted(async () => {
  await loadConfig();
  await syncWindowLayout();
  await nextTick();
  shellRef.value?.focus();

  unlistenConfig = await listen('config-updated', async () => {
    await loadConfig();
    await syncWindowLayout();
  });
  unlistenOpened = await listen('tray-menu-opened', async () => {
    flyoutOpen.value = false;
    await loadConfig();
    await cacheBaseWindowPosition(true);
    await syncWindowLayout();
    await nextTick();
    shellRef.value?.focus();
  });
  unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (!focused) void hideTrayMenuWindow();
  });
});

onUnmounted(() => {
  unlistenConfig?.();
  unlistenFocus?.();
  unlistenOpened?.();
});
</script>

<template>
  <div
    ref="shellRef"
    class="tray-shell"
    tabindex="-1"
    @keydown.escape.stop.prevent="void hideSelf()"
  >
    <div class="menu-panel main-menu" :style="menuPanelStyle">
      <TrayMenuList
        :items="menuItems"
        :flyout-open="flyoutOpen"
        @command="handleCommand"
        @open-flyout="handleOpenFlyout"
      />
    </div>

    <div
      v-if="flyoutOpen && serviceItems.length > 0"
      class="flyout-panel service-menu"
      :style="flyoutPanelStyle"
    >
      <TrayServiceFlyout
        :items="serviceItems"
        :pending-service-id="pendingServiceId"
        @toggle="handleToggleService"
      />
    </div>
  </div>
</template>

<style scoped>
.tray-shell {
  position: relative;
  box-sizing: border-box;
  width: max-content;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  letter-spacing: 0;
  user-select: none;
  outline: none;
}

.menu-panel {
  box-sizing: border-box;
  border: none;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  overflow: hidden;
  padding: var(--space-xs) 0;
  transform-origin: top left;
}

.flyout-panel {
  position: absolute;
  box-sizing: border-box;
  border: none;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  overflow: hidden;
}
</style>
