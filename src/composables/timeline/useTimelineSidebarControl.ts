/**
 * 时间轴侧边栏控制 Composable
 * 管理侧边栏的显示/隐藏逻辑和交互行为
 */
import { ref } from 'vue';

type ShowSource = 'scroll' | 'hover';

interface UseTimelineSidebarControlOptions {
  /** 滚动触发后的隐藏延迟（毫秒） */
  scrollHideDelay?: number;
  /** 悬停触发后的隐藏延迟（毫秒） */
  hoverHideDelay?: number;
}

export function useTimelineSidebarControl(options: UseTimelineSidebarControlOptions = {}) {
  const {
    scrollHideDelay = 1000,
    hoverHideDelay = 300,
  } = options;

  /** 侧边栏是否可见 */
  const isSidebarVisible = ref(false);

  /** 是否正在悬停侧边栏 */
  const isHoveringSidebar = ref(false);

  /** 上次显示来源 */
  let lastShowSource: ShowSource = 'scroll';

  /** 隐藏延迟定时器 */
  let hideTimer: number | undefined;

  /**
   * 显示侧边栏
   */
  function showSidebar() {
    isSidebarVisible.value = true;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  }

  /**
   * 延迟隐藏侧边栏
   */
  function hideSidebarDebounced() {
    if (hideTimer) clearTimeout(hideTimer);
    const delay = lastShowSource === 'hover' ? hoverHideDelay : scrollHideDelay;
    hideTimer = window.setTimeout(() => {
      if (!isHoveringSidebar.value) {
        isSidebarVisible.value = false;
      }
    }, delay);
  }

  /**
   * 滚动时触发显示
   */
  function onScroll() {
    lastShowSource = 'scroll';
    showSidebar();
    hideSidebarDebounced();
  }

  /**
   * 鼠标进入侧边栏
   */
  function onSidebarEnter() {
    lastShowSource = 'hover';
    isHoveringSidebar.value = true;
    showSidebar();
  }

  /**
   * 鼠标离开侧边栏
   */
  function onSidebarLeave() {
    isHoveringSidebar.value = false;
    hideSidebarDebounced();
  }

  /**
   * 清理定时器
   */
  function cleanup() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  }

  return {
    isSidebarVisible,
    isHoveringSidebar,
    showSidebar,
    hideSidebarDebounced,
    onScroll,
    onSidebarEnter,
    onSidebarLeave,
    cleanup,
  };
}
