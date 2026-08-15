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
import {
  TRAY_LAYOUT,
  TRAY_SERVICE_SUBMENU_ID,
  calculateFlyoutPanelHeight,
  calculateFlyoutRowOffset,
  calculateMenuPanelHeight,
  clampAnchor,
  resolveFlyoutLeft,
  resolveFlyoutOpensLeft,
  resolveFlyoutTop,
  type AnchorPosition,
  type WorkAreaFrame,
} from '../../services/trayMenuLayout';
import TrayMenuList from './TrayMenuList.vue';
import TrayServiceFlyout from './TrayServiceFlyout.vue';

type MenuEntry = ReturnType<typeof buildTrayMenuItems>[number];

const config = ref<UserConfig>(structuredClone(DEFAULT_CONFIG));
const menuVisible = ref(false);
const flyoutOpen = ref(false);
const pendingServiceId = ref<string | null>(null);
const shellRef = ref<HTMLElement | null>(null);
/**
 * Rust 弹出托盘菜单时给出的原始锚点（物理像素）。
 * ⚠️ 只允许 `cacheAnchor` 写入 —— 一旦把夹紧后的值回写进来，
 * 单向夹紧（Math.min）会让菜单一路往上漂且回不去。
 */
const rawAnchor = ref<AnchorPosition | null>(null);
const windowFrame = ref<WorkAreaFrame | null>(null);
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
      'id' in item && (item as { id: string }).id === TRAY_SERVICE_SUBMENU_ID && 'items' in item,
  );
  return found?.items ?? [];
});

const menuPanelHeight = computed(() => calculateMenuPanelHeight(menuItems.value));
const flyoutRowOffsetPx = computed(() => calculateFlyoutRowOffset(menuItems.value));

const windowWidth = computed(() =>
  windowFrame.value ? Math.ceil(windowFrame.value.width / windowFrame.value.scaleFactor) : TRAY_LAYOUT.MENU_WIDTH,
);
const windowHeight = computed(() =>
  windowFrame.value
    ? Math.ceil(windowFrame.value.height / windowFrame.value.scaleFactor)
    : menuPanelHeight.value,
);

/** 主菜单锚点：只依赖主菜单自身尺寸，展开/收起二级面板都不会让它挪窝 */
const anchor = computed<AnchorPosition | null>(() => {
  const raw = rawAnchor.value;
  const frame = windowFrame.value;
  if (!raw || !frame) return null;
  return clampAnchor(raw, frame, menuPanelHeight.value);
});

const menuLeftPx = computed(() => {
  const point = anchor.value;
  const frame = windowFrame.value;
  if (!point || !frame) return 0;
  return Math.max(0, Math.round((point.x - frame.left) / frame.scaleFactor));
});

const menuTopPx = computed(() => {
  const point = anchor.value;
  const frame = windowFrame.value;
  if (!point || !frame) return 0;
  return Math.max(0, Math.round((point.y - frame.top) / frame.scaleFactor));
});

const flyoutOpensLeft = computed(() => {
  const point = anchor.value;
  const frame = windowFrame.value;
  if (!point || !frame) return false;
  return resolveFlyoutOpensLeft(point, frame);
});

const flyoutPanelHeight = computed(() =>
  flyoutOpen.value && serviceItems.value.length > 0
    ? Math.min(calculateFlyoutPanelHeight(serviceItems.value as MenuEntry[]), windowHeight.value)
    : 0,
);

const menuPanelStyle = computed(() => ({
  width: `${TRAY_LAYOUT.MENU_WIDTH}px`,
  top: `${menuTopPx.value}px`,
  left: `${menuLeftPx.value}px`,
}));

const flyoutPanelStyle = computed(() => ({
  top: `${resolveFlyoutTop(menuTopPx.value, flyoutRowOffsetPx.value, flyoutPanelHeight.value, windowHeight.value)}px`,
  left: `${resolveFlyoutLeft(menuLeftPx.value, flyoutOpensLeft.value, windowWidth.value)}px`,
  width: `${TRAY_LAYOUT.FLYOUT_WIDTH}px`,
  maxHeight: `${windowHeight.value}px`,
}));

async function cacheAnchor(force = false): Promise<void> {
  if (rawAnchor.value && !force) return;

  const position = await getCurrentWindow().outerPosition();
  rawAnchor.value = { x: position.x, y: position.y };
}

async function resolveWorkAreaFrame(point: AnchorPosition): Promise<WorkAreaFrame | null> {
  const monitor = await monitorFromPoint(point.x + 1, point.y + 1);
  if (!monitor) return null;

  return {
    left: monitor.workArea.position.x,
    top: monitor.workArea.position.y,
    width: monitor.workArea.size.width,
    height: monitor.workArea.size.height,
    scaleFactor: monitor.scaleFactor || await getCurrentWindow().scaleFactor(),
  };
}

/**
 * 把托盘窗口撑满整个工作区，菜单面板改由窗口内的绝对定位摆放。
 * 窗口几何只跟工作区有关，与二级面板开合无关 —— 所以悬停展开时不需要再调一次。
 */
async function syncWindowLayout(): Promise<void> {
  await nextTick();
  await cacheAnchor();

  if (rawAnchor.value) {
    const frame = await resolveWorkAreaFrame(rawAnchor.value);
    if (frame) windowFrame.value = frame;
  }
  await nextTick();

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

function handleOpenFlyout(): void {
  flyoutOpen.value = true;
}

function handleToggleFlyout(): void {
  flyoutOpen.value = !flyoutOpen.value;
}

function closeFlyout(): void {
  flyoutOpen.value = false;
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
    await cacheAnchor(true);
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
          @mouseleave="closeFlyout"
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

  /* 图床数量无上限，超过工作区高度时内部滚动，不溢出屏幕 */
  overflow: hidden auto;
  box-shadow: var(--shadow-float);
}
</style>
