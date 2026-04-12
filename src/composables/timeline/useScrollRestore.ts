/**
 * 滚动位置保存与恢复 Composable
 * 管理 KeepAlive / Tab 切换两种场景下的滚动位置持久化
 *
 * 核心保护：等 DOM 就绪（isLoading=false && isCalculating=false）再恢复
 * —— 否则 TimelinePhotoGrid 未挂载、spacer 不存在时，restoreScrollTop 会被浏览器 clamp，
 *    导致 scrollTop.value 与 DOM 失同步、visibleItems 错位、"需要滚动一下才加载"的症状。
 */
import { onActivated, onDeactivated, nextTick, watch, type Ref, type ComputedRef } from 'vue';
import type { VisibleItem } from '../useVirtualTimeline';

/** 可选的外部回调，由调用方提供 */
interface ScrollRestoreCallbacks {
  /** 强制恢复滚动位置（像素）。允许返回 Promise —— 实际实现是异步的 */
  restoreScrollTop: (top: number) => void | Promise<void>;
  /** 按进度恢复滚动（0-1） */
  scrollToProgress: (progress: number, force?: boolean) => void;
  /** 按元素 ID 恢复滚动 */
  scrollToItem: (id: string, behavior?: ScrollBehavior) => void;
  /** 强制刷新可见区域 */
  forceUpdateVisibleArea: () => void;
  /** 校验元素是否仍在当前 layoutResult 中 */
  hasItem?: (id: string) => boolean;
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
  /** 数据是否正在加载中（loadHistory 期间为 true —— 此时 TimelinePhotoGrid 被 v-if 拆掉，spacer 不存在） */
  isLoading: ComputedRef<boolean> | Ref<boolean>;
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
    isLoading,
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

  /**
   * 恢复进行中标志
   * 用于抑制 visibleItems / trackScrollPosition 在恢复期间污染 lastStable*
   * 注意：仅覆盖 useScrollRestore 内部的保存路径，不影响 useVirtualTimeline 的 DOM 同步
   */
  let isRestoring = false;

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

    // ⚠️ progress 防御：layoutResult 尚未就绪（isLoading/isCalculating）时，
    // maxScroll 可能是脏值，算出的 progress 会被错误写成 0/1，误导 fallback 链
    const layoutReady = totalHeight.value > 0 && !isCalculating.value && !isLoading.value;
    if (layoutReady) {
      const maxScroll = Math.max(0, totalHeight.value - viewportHeight.value);
      const currentProgress = maxScroll > 0 ? Math.min(1, Math.max(0, resolvedTop / maxScroll)) : 0;
      lastStableProgress = currentProgress;
    }

    // resolvedTop = 0 时清除 anchor，防止 stale 旧位置的锚点在还原时意外跳到底部
    const anchorId = resolvedTop === 0 ? null : (visibleItems.value[0]?.meta.id ?? lastStableAnchorId);

    lastKnownScrollTop = resolvedTop;
    lastStableScrollTop = resolvedTop;
    lastStableAnchorId = anchorId ?? null;
  }

  /**
   * 是否可以执行恢复 —— DOM 必须就绪（spacer 已挂载，布局已算好）
   */
  function canRestoreNow(): boolean {
    return !isLoading.value && !isCalculating.value && totalHeight.value > 0;
  }

  /**
   * 执行滚动恢复
   * fallback 策略（优先级从高到低）：
   *   1. 像素 target（原策略，最准确）
   *   2. anchor（target 无效时，基于元素 id 精确定位）
   *   3. progress（< 0.999，避免被污染成 1 时跳到底部）
   *   4. forceUpdateVisibleArea 兜底
   */
  async function doRestore() {
    if (!pendingRestore || !scrollContainer.value) return;

    // DOM 尚未就绪 —— 保持 pendingRestore，等 watch(isLoading)/watch(isCalculating) 再触发
    if (!canRestoreNow()) return;

    const restoreType = pendingRestore;
    const savedTarget = restoreType === 'keepalive' ? savedPosition : savedTabPosition;
    pendingRestore = null;
    isRestoring = true;

    try {
      const maxScroll = Math.max(0, totalHeight.value - viewportHeight.value);

      // 1. 像素 target（savedPosition 优先，其次 lastStableScrollTop）—— 合理区间内
      const target = savedTarget > 0 ? savedTarget : lastStableScrollTop;
      if (target > 0 && target <= maxScroll + 100) {
        await callbacks.restoreScrollTop(target);
        saveStablePosition();
        return;
      }

      // 2. anchor（像素 target 无效时的精确 fallback）
      if (lastStableAnchorId && callbacks.hasItem?.(lastStableAnchorId)) {
        callbacks.scrollToItem(lastStableAnchorId, 'auto');
        // 等一帧让 scrollTo 派发的事件被 handleScroll 吸收
        await nextTick();
        saveStablePosition();
        return;
      }

      // 3. progress 合理区间
      if (lastStableProgress > 0 && lastStableProgress < 0.999) {
        callbacks.scrollToProgress(lastStableProgress, true);
        saveStablePosition();
        return;
      }

      // 4. 兜底
      callbacks.forceUpdateVisibleArea();
      saveStablePosition(0);
    } finally {
      // 延后一帧释放：让 restoreScrollTop/scrollTo 派发的 scroll 事件先被 isRestoring 吞掉
      nextTick(() => {
        requestAnimationFrame(() => {
          isRestoring = false;
        });
      });
    }
  }

  /**
   * 处理滚动事件中的位置跟踪
   * 返回 true 表示位置已正常更新，false 表示被忽略
   */
  function trackScrollPosition(): boolean {
    if (!scrollContainer.value) return false;
    // 恢复期内忽略 scroll 事件（包括 restoreScrollTop 赋值派发的）
    if (isRestoring) return false;

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
      isRestoring = true;
    }
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    await doRestore();
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
        isRestoring = true;
      }
      await doRestore();
    }
  );

  // 跟踪可见项锚点（恢复期间不更新，避免污染 lastStableAnchorId）
  watch(
    visibleItems,
    (items) => {
      if (isRestoring) return;
      const firstId = items[0]?.meta.id;
      if (firstId) {
        lastStableAnchorId = firstId;
      }
    },
    { deep: false }
  );

  // 外部激活触发 —— 不再主动调 forceUpdateVisibleArea（会脏写 scrollTop.value 导致锚点污染）
  // 真正的恢复由 onActivated / watch(visible) / watch(isLoading) / watch(isCalculating) 链负责
  watch(
    activationTrigger,
    () => {
      // 保留 watcher 占位以便将来扩展，但不做任何副作用
    }
  );

  // 数据加载/布局计算完成时尝试恢复
  const tryDeferredRestore = () => {
    if (pendingRestore && canRestoreNow()) {
      nextTick(() => doRestore());
    }
  };
  watch(isCalculating, (calculating) => { if (!calculating) tryDeferredRestore(); });
  watch(isLoading, (loading) => { if (!loading) tryDeferredRestore(); });

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
