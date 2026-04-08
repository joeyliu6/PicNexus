/**
 * 滚动位置保存与恢复 Composable
 * 管理 KeepAlive / Tab 切换两种场景下的滚动位置持久化
 */
import { onActivated, onDeactivated, nextTick, watch, type Ref, type ComputedRef } from 'vue';
import type { VisibleItem } from '../useVirtualTimeline';

/** 可选的外部回调，由调用方提供 */
interface ScrollRestoreCallbacks {
  /** 强制恢复滚动位置（像素） */
  restoreScrollTop: (top: number) => void;
  /** 按进度恢复滚动（0-1） */
  scrollToProgress: (progress: number, force?: boolean) => void;
  /** 按元素 ID 恢复滚动 */
  scrollToItem: (id: string, behavior?: ScrollBehavior) => void;
  /** 强制刷新可见区域 */
  forceUpdateVisibleArea: () => void;
}

interface UseScrollRestoreOptions {
  scrollContainer: Ref<HTMLElement | null>;
  /** 虚拟滚动维护的 scrollTop（异步 RAF 更新） */
  virtualScrollTop: Ref<number>;
  /** 总高度 */
  totalHeight: Ref<number>;
  /** 视口高度 */
  viewportHeight: Ref<number>;
  /** 当前可见项 */
  visibleItems: Ref<VisibleItem[]>;
  /** 布局是否正在计算中 */
  isCalculating: ComputedRef<boolean> | Ref<boolean>;
  /** props.visible */
  visible: ComputedRef<boolean | undefined> | Ref<boolean | undefined>;
  /** props.activationTrigger */
  activationTrigger: ComputedRef<number | undefined> | Ref<number | undefined>;
  /** 回调方法 */
  callbacks: ScrollRestoreCallbacks;
}

export function useScrollRestore(options: UseScrollRestoreOptions) {
  const {
    scrollContainer,
    virtualScrollTop,
    totalHeight,
    viewportHeight,
    visibleItems,
    isCalculating,
    visible,
    activationTrigger,
    callbacks,
  } = options;

  // ==================== 内部状态 ====================

  /** 持续追踪滚动位置（同步更新，避免 deactivate/v-show 时读 DOM 返回 0） */
  let lastKnownScrollTop = 0;
  /** 最后一次稳定的滚动位置 */
  let lastStableScrollTop = 0;
  /** 最后一次稳定的滚动进度 */
  let lastStableProgress = 0;
  /** 最后一次稳定的锚点元素 ID */
  let lastStableAnchorId: string | null = null;

  /** KeepAlive 保存的位置 */
  let savedPosition = 0;
  /** Tab 切换保存的位置 */
  let savedTabPosition = 0;
  /** 待恢复的类型 */
  let pendingRestore: 'keepalive' | 'tab' | null = null;

  // ==================== 核心方法 ====================

  /**
   * 保存当前的稳定滚动位置
   * 优先使用传入值，其次读 DOM，遇到无效值时回退到已知的最后位置
   */
  function saveStablePosition(scrollTop?: number) {
    const domTop = scrollContainer.value?.scrollTop ?? 0;
    let resolvedTop = typeof scrollTop === 'number' ? scrollTop : domTop;

    const isInvalidTop = !Number.isFinite(resolvedTop) || resolvedTop < 0;
    const isLikelyCollapsedReset = resolvedTop === 0
      && lastKnownScrollTop > 0
      && !!scrollContainer.value
      && (scrollContainer.value.clientHeight === 0 || scrollContainer.value.clientWidth === 0);

    if (isInvalidTop || isLikelyCollapsedReset) {
      resolvedTop = Math.max(0, virtualScrollTop.value, lastKnownScrollTop);
    }
    resolvedTop = Math.max(0, resolvedTop);

    // 直接从 resolvedTop 计算 progress，避免用 stale 的 scrollProgress（virtualScrollTop 在 RAF 里异步更新）
    const maxScroll = Math.max(0, totalHeight.value - viewportHeight.value);
    const currentProgress = maxScroll > 0 ? Math.min(1, Math.max(0, resolvedTop / maxScroll)) : 0;

    // resolvedTop = 0 时清除 anchor，防止 stale 旧位置的锚点在还原时意外跳到底部
    const anchorId = resolvedTop === 0 ? null : (visibleItems.value[0]?.meta.id ?? lastStableAnchorId);

    lastKnownScrollTop = resolvedTop;
    lastStableScrollTop = resolvedTop;
    lastStableProgress = currentProgress;
    lastStableAnchorId = anchorId ?? null;
  }

  /**
   * 执行滚动恢复（支持多种回退策略）
   * 1. 精确像素位置 → 2. 进度百分比 → 3. 锚点元素 → 4. 刷新可见区域
   */
  function doRestore() {
    if (!pendingRestore || !scrollContainer.value) return;

    const savedTarget = pendingRestore === 'keepalive' ? savedPosition : savedTabPosition;
    const restoreType = pendingRestore;
    pendingRestore = null;

    if (!isCalculating.value) {
      const target = savedTarget > 0 ? savedTarget : lastStableScrollTop;
      if (target > 0) {
        callbacks.restoreScrollTop(target);
        saveStablePosition(target);
        return;
      }

      if (lastStableProgress > 0) {
        callbacks.scrollToProgress(lastStableProgress, true);
        saveStablePosition();
        return;
      }

      if (lastStableAnchorId) {
        callbacks.scrollToItem(lastStableAnchorId, 'auto');
        saveStablePosition();
        return;
      }

      callbacks.forceUpdateVisibleArea();
      saveStablePosition(0);
    } else {
      // 布局还在计算中，重新标记待恢复
      pendingRestore = restoreType;
    }
  }

  /**
   * 处理滚动事件中的位置跟踪
   * 返回 true 表示位置已正常更新，false 表示被忽略（瞬时重置）
   */
  function trackScrollPosition(): boolean {
    if (!scrollContainer.value) return false;

    const nextTop = scrollContainer.value.scrollTop;
    // KeepAlive/v-show 切换时容器可能瞬时上报 0，避免覆盖真实滚动位置
    const isTransientReset = nextTop === 0
      && lastStableScrollTop > 0
      && (scrollContainer.value.clientHeight === 0 || scrollContainer.value.clientWidth === 0);

    if (!isTransientReset) {
      saveStablePosition(nextTop);
      return true;
    }
    return false;
  }

  // ==================== 生命周期 ====================

  onDeactivated(() => {
    saveStablePosition();
    savedPosition = lastStableScrollTop;
  });

  onActivated(async () => {
    if (savedPosition > 0 || lastStableScrollTop > 0 || lastStableProgress > 0 || !!lastStableAnchorId) {
      pendingRestore = 'keepalive';
    }
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    doRestore();
  });

  // ==================== Watchers ====================

  // Tab 切换时保存/恢复
  watch(
    visible,
    async (isVisible, wasVisible) => {
      if (!isVisible) {
        saveStablePosition();
        savedTabPosition = lastStableScrollTop;
        return;
      }
      if (wasVisible) return;

      await new Promise<void>(r => requestAnimationFrame(() => r()));

      if (savedTabPosition > 0 || lastStableScrollTop > 0 || lastStableProgress > 0 || !!lastStableAnchorId) {
        pendingRestore = 'tab';
      }
      doRestore();
    }
  );

  // 跟踪可见项锚点
  watch(
    visibleItems,
    (items) => {
      const firstId = items[0]?.meta.id;
      if (firstId) {
        lastStableAnchorId = firstId;
      }
    },
    { deep: false }
  );

  // 外部激活触发时刷新
  watch(
    activationTrigger,
    async (_, oldVal) => {
      if (!visible.value || oldVal === undefined) return;
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      if (!pendingRestore) {
        callbacks.forceUpdateVisibleArea();
      }
    }
  );

  // 布局计算完成时恢复
  watch(
    isCalculating,
    (calculating) => {
      if (!calculating && pendingRestore) {
        nextTick(() => doRestore());
      }
    }
  );

  return {
    saveStablePosition,
    doRestore,
    trackScrollPosition,
    /** 读取当前稳定滚动位置（只读） */
    getLastStableScrollTop: () => lastStableScrollTop,
    getLastStableProgress: () => lastStableProgress,
    getLastStableAnchorId: () => lastStableAnchorId,
    /** 更新拖拽时的进度 */
    setLastStableProgress: (p: number) => { lastStableProgress = Math.min(1, Math.max(0, p)); },
  };
}
