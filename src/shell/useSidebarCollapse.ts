// 侧栏收起：窗口窄于 1000px 自动收成 56px 图标栏；宽窗口下可用 Ctrl+\（⌘\）手动收起。
// 窄窗口时强制收起、不提供「展开」——展开后内容区只剩 592px，会违反「任何页面不横向滚动」。
// 手动收起只是本机界面习惯，记在 localStorage，不进配置（不随云同步）。

import { computed, ref, type Ref } from 'vue';
import { useWindowSize } from '@vueuse/core';
import { createLogger } from '@/utils/logger';

const log = createLogger('SidebarCollapse');

/** design-tokens.json size.navRailBreakpoint */
export const NAV_RAIL_BREAKPOINT = 1000;
const STORAGE_KEY = 'picnexus-sidebar-collapsed';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch (error) {
    log.warn('读取侧栏收起状态失败', error);
    return false;
  }
}

function writeStored(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch (error) {
    log.warn('保存侧栏收起状态失败', error);
  }
}

const manualCollapsed = ref(readStored());

export function useSidebarCollapse(width: Ref<number> = useWindowSize().width) {
  const narrow = computed(() => width.value < NAV_RAIL_BREAKPOINT);
  const collapsed = computed(() => narrow.value || manualCollapsed.value);

  function toggle(): void {
    if (narrow.value) return;
    manualCollapsed.value = !manualCollapsed.value;
    writeStored(manualCollapsed.value);
  }

  return { narrow, collapsed, toggle };
}

export function __resetSidebarCollapseForTests(): void {
  manualCollapsed.value = readStored();
}
