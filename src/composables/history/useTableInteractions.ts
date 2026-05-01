/**
 * useTableInteractions — 历史表格的交互逻辑
 * 包含：灯箱、服务 Popover、悬浮预览、复制链接
 * 从 HistoryTableView.vue 提取
 */
import { ref, shallowRef, computed, watch, nextTick, onUnmounted, onDeactivated, type Ref } from 'vue';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type PopoverType from 'primevue/popover';
import type { HistoryItem } from '../../config/types';
import { getPrimaryImageUrl } from '../../utils/imageUrl';
import { applyPrefixTemplate } from '../../utils/linkPrefixTemplate';
import { applyZhihuSourceFromConfig } from '../../utils/zhihuSource';
import { getServiceDisplayName } from '../../constants/serviceNames';
import { useHistoryViewState } from '../useHistoryViewState';
import { useHistoryManager } from '../useHistory';
import { useThumbCache } from '../useThumbCache';
import { useConfigManager } from '../useConfig';
import { useToast } from '../useToast';
import { makeCopyBadgeKey, useCopyBadgeFeedback } from '../useCopyBadgeFeedback';
import { createLogger } from '../../utils/logger';
import { motionDuration } from '../../utils/reducedMotion';
import { HIDE_ANIMATION_DURATION, SHOW_ANIMATION_DURATION } from './usePhotoSwipeBridge';
import type { PhotoSwipeCloseTargetMode } from './usePhotoSwipeBridge';
import { useLightboxPreloader } from '../useLightboxPreloader';
import { warmImages } from '../../utils/imagePreload';

const logger = createLogger('TableInteractions');

const PREVIEW_MAX_SIZE = 300;
const PREVIEW_MARGIN = 8;
/** 灯箱打开动画时长（ms），留出 100ms 缓冲覆盖 PhotoSwipe show 动画尾帧 */
const OPENING_DURATION = SHOW_ANIMATION_DURATION + 100;
/**
 * 灯箱关闭的"拦截窗口"时长（ms），覆盖 PhotoSwipe 收回到小缩略图的主动作。
 * 280ms 给眼睛足够时间追踪大图到表格位置，额外 20ms 吃掉动画尾帧。
 */
const CLOSING_DURATION = HIDE_ANIMATION_DURATION + 20;
const HOVER_HANDOFF_POINTER_EVENTS = ['mousemove', 'pointermove', 'pointerdown'] as const;

interface UseTableInteractionsOptions {
  /** 当前页数据（灯箱导航用） */
  currentPageData: Ref<HistoryItem[]>;
  /** 当前页码（1-based） */
  currentPage: Ref<number>;
  /** 总页数 */
  totalPages: Ref<number>;
  /** 程序化翻页；返回新页加载完成的 Promise */
  goToPage: (pageNumber: number) => Promise<void>;
  /** 轻量预取页数据，不立即更新表格 */
  peekPage: (pageNumber: number) => Promise<{ items: HistoryItem[]; total: number }>;
  /** Popover 组件 template ref（由调用方声明，以避免 vue-tsc TS6133） */
  servicePopoverRef: Ref<InstanceType<typeof PopoverType> | null>;
}

interface PreviewSize {
  width: number;
  height: number;
}

interface TargetVisibilityResult {
  found: boolean;
  scrolled: boolean;
}

export function useTableInteractions(options: UseTableInteractionsOptions) {
  const {
    currentPageData, currentPage, totalPages, goToPage,
    peekPage, servicePopoverRef,
  } = options;

  const toast = useToast();
  const configManager = useConfigManager();
  const viewState = useHistoryViewState();
  const historyManager = useHistoryManager();
  const thumbCache = useThumbCache();
  const {
    copiedKey: copiedServiceKey,
    markCopied: markServiceCopied,
  } = useCopyBadgeFeedback();

  // ---- 灯箱 ----
  const lightboxVisible = ref(false);
  const lightboxItem = ref<HistoryItem | null>(null);
  const lightboxPageData = shallowRef<HistoryItem[]>([]);
  const lightboxPage = ref(1);
  let openingTimer: ReturnType<typeof setTimeout> | null = null;
  let closingTimer: ReturnType<typeof setTimeout> | null = null;
  const isLightboxOpening = ref(false);
  const isLightboxClosing = ref(false);
  let keepHoverPreviewAfterClose = false;
  let hoverHandoffSourceId: string | null = null;

  // 鼠标位置追踪：仅在灯箱会话期间挂载，用于关闭时判断鼠标是否仍在源缩略图上
  // -1 为哨兵值，表示本次会话由键盘触发、无鼠标坐标，跳过 hit-test
  let lastMouseX = -1;
  let lastMouseY = -1;
  function trackMouse(e: MouseEvent): void { lastMouseX = e.clientX; lastMouseY = e.clientY; }

  function stopHoverHandoffTracking(): void {
    if (!hoverHandoffSourceId) return;
    hoverHandoffSourceId = null;
    HOVER_HANDOFF_POINTER_EVENTS.forEach((eventName) => document.removeEventListener(eventName, handleHoverHandoffPointerEvent, true));
    document.removeEventListener('scroll', handleHoverHandoffGeometryEvent, true);
    window.removeEventListener('resize', handleHoverHandoffGeometryEvent);
    window.removeEventListener('blur', clearHoverPreview);
    document.removeEventListener('visibilitychange', handleHoverHandoffVisibilityChange);
  }

  function clearHoverPreview(): void {
    keepHoverPreviewAfterClose = false;
    stopHoverHandoffTracking();
    hoverPreview.value.closing = false;
    hoverPreview.value.visible = false;
  }

  function requestHoverPreviewDismissAfterClose(): void {
    keepHoverPreviewAfterClose = false;
    stopHoverHandoffTracking();
    hoverPreview.value.closing = true;
    if (!isLightboxClosing.value || !closingTimer) clearHoverPreview();
  }

  function handleHoverHandoffPointerEvent(event: Event): void {
    if (event instanceof MouseEvent) {
      lastMouseX = event.clientX;
      lastMouseY = event.clientY;
    }
    handleHoverHandoffGeometryEvent();
  }

  function handleHoverHandoffGeometryEvent(): void {
    if (hoverHandoffSourceId && !isMouseOnSourceThumb(hoverHandoffSourceId)) requestHoverPreviewDismissAfterClose();
  }

  function handleHoverHandoffVisibilityChange(): void { if (document.visibilityState !== 'visible') clearHoverPreview(); }

  function startHoverHandoffTracking(sourceId: string): void {
    stopHoverHandoffTracking();
    hoverHandoffSourceId = sourceId;
    HOVER_HANDOFF_POINTER_EVENTS.forEach((eventName) => document.addEventListener(eventName, handleHoverHandoffPointerEvent, true));
    document.addEventListener('scroll', handleHoverHandoffGeometryEvent, true);
    window.addEventListener('resize', handleHoverHandoffGeometryEvent);
    window.addEventListener('blur', clearHoverPreview);
    document.addEventListener('visibilitychange', handleHoverHandoffVisibilityChange);
  }

  function isMouseOnSourceThumb(sourceId: string): boolean {
    if (lastMouseX < 0) return false;
    const thumbBox = document.querySelector<HTMLElement>(
      `.thumb-box[data-lightbox-id="${CSS.escape(sourceId)}"]`,
    );
    const checkEl = thumbBox?.closest<HTMLElement>('.thumb-preview-wrapper');
    if (!checkEl) return false;
    const rect = checkEl.getBoundingClientRect();
    return lastMouseX >= rect.left && lastMouseX <= rect.right &&
      lastMouseY >= rect.top && lastMouseY <= rect.bottom;
  }

  function resolveLightboxCloseTargetMode(): PhotoSwipeCloseTargetMode {
    const sourceId = hoverPreview.value.itemId;
    if (!sourceId || !hoverPreview.value.url) return 'fade';
    if (isMouseOnSourceThumb(sourceId)) return 'preview';
    hoverPreview.value.closing = true;
    return 'thumb';
  }

  const lightboxIndex = computed(() => {
    if (!lightboxItem.value) return -1;
    return lightboxPageData.value.findIndex((item) => item.id === lightboxItem.value!.id);
  });
  // 跨页能力：到当前页边界时，只要还有相邻页就允许继续翻（handleLightboxNavigate 内部触发加载）
  const lightboxHasPrev = computed(() =>
    lightboxIndex.value > 0 || lightboxPage.value > 1,
  );
  const lightboxHasNext = computed(() => {
    const idx = lightboxIndex.value;
    if (idx < 0) return false;
    return idx < lightboxPageData.value.length - 1 || lightboxPage.value < totalPages.value;
  });

  function openLightbox(item: HistoryItem, event?: MouseEvent): void {
    // 清理可能还在排队的关闭 timer：防止上次关闭遗留的 timer
    // 在新 FLIP 开场途中把刚弹起的预览弄没（快速连开场景的 race bug）
    if (closingTimer) { clearTimeout(closingTimer); closingTimer = null; }
    isLightboxClosing.value = false;
    keepHoverPreviewAfterClose = false;
    stopHoverHandoffTracking();
    hoverPreview.value.closing = false;

    // 鼠标追踪仅在灯箱会话期间挂载，用完即拆，避免全生命周期的 60Hz 监听
    if (event) { lastMouseX = event.clientX; lastMouseY = event.clientY; }
    else { lastMouseX = -1; lastMouseY = -1; }
    document.addEventListener('mousemove', trackMouse);

    // 阻止悬浮预览在 Lightbox 打开动画期间消失，
    // 让 PhotoSwipe 能从预览元素做 FLIP 过渡
    isLightboxOpening.value = true;
    warmImages([thumbCache.getMediumImageUrl(item), getItemImageUrl(item)]);
    lightboxPageData.value = currentPageData.value;
    lightboxPage.value = currentPage.value;
    lightboxItem.value = item;
    lightboxVisible.value = true;
    if (openingTimer) clearTimeout(openingTimer);
    openingTimer = setTimeout(() => { isLightboxOpening.value = false; openingTimer = null; }, motionDuration(OPENING_DURATION));
  }

  function getItemImageUrl(item: HistoryItem): string {
    return getPrimaryImageUrl(item, configManager.config.value);
  }

  // 双向 ±1 预加载交给 useLightboxPreloader 统一处理：监听 lightboxItem 变化、
  // 防抖 100ms 后并发预热前后两张大图。这里只需提供"按方向解析 URL"的同步逻辑。
  useLightboxPreloader({
    currentItemId: computed(() => lightboxItem.value?.id ?? null),
    resolveAdjacentUrl: async (direction) => {
      const idx = lightboxIndex.value;
      if (idx < 0) return null;
      const targetIdx = direction === 'prev' ? idx - 1 : idx + 1;
      const target = lightboxPageData.value[targetIdx];
      if (target) return getItemImageUrl(target);

      const targetPage = direction === 'prev' ? lightboxPage.value - 1 : lightboxPage.value + 1;
      if (targetPage < 1 || targetPage > totalPages.value) return null;
      const result = await peekPage(targetPage);
      const adjacent = direction === 'prev'
        ? result.items[result.items.length - 1]
        : result.items[0];
      return adjacent ? getItemImageUrl(adjacent) : null;
    },
  });

  // 跨页导航并发保护：用户快按时多次 goToPage 会互相作废（loadVersion 机制），
  // 用 isCrossingPage 直接忽略重入，保证 lightboxItem 的落点与最终页数据一致
  let isCrossingPage = false;
  let tableSyncVersion = 0;

  /** 切到新图的公共收尾：过继悬浮预览（预加载由 useLightboxPreloader 自动接管） */
  async function landOnItem(item: HistoryItem, options: { ensureVisible?: boolean } = {}): Promise<void> {
    if (options.ensureVisible !== false) {
      const visibility = ensureLightboxTargetVisible(item);
      if (visibility.scrolled) await waitForFrame();
    }
    lightboxItem.value = item;
    if (hoverPreview.value.visible) syncHoverPreviewToItem(item);
  }

  function scheduleTablePageSync(pageNumber: number): void {
    const version = ++tableSyncVersion;
    void (async () => {
      await waitForFrame();
      await waitForFrame();
      if (version !== tableSyncVersion || lightboxPage.value !== pageNumber) return;
      await goToPage(pageNumber);
      await nextTick();

      const item = lightboxItem.value;
      if (!item || lightboxPage.value !== pageNumber) return;
      const visibility = ensureLightboxTargetVisible(item);
      if (visibility.scrolled) await waitForFrame();
      if (hoverPreview.value.visible) syncHoverPreviewToItem(item);
    })().catch((error) => {
      logger.error('灯箱同步表格页失败:', error);
    });
  }

  function findThumbWrapper(itemId: string): HTMLElement | null {
    const thumbBox = document.querySelector<HTMLElement>(
      `.thumb-box[data-lightbox-id="${CSS.escape(itemId)}"]`,
    );
    return thumbBox?.closest<HTMLElement>('.thumb-preview-wrapper') ?? null;
  }

  function waitForFrame(): Promise<void> {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      return Promise.resolve();
    }
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  function findScrollContainer(el: HTMLElement): HTMLElement | null {
    const historyContainer = el.closest<HTMLElement>('.history-container');
    if (historyContainer) return historyContainer;

    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      const style = window.getComputedStyle(parent);
      const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY);
      if (canScrollY && parent.scrollHeight > parent.clientHeight) return parent;
      parent = parent.parentElement;
    }
    return null;
  }

  function isFullyVisibleInContainer(el: HTMLElement, container: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return rect.top >= containerRect.top + PREVIEW_MARGIN &&
      rect.bottom <= containerRect.bottom - PREVIEW_MARGIN;
  }

  function centerElementInContainer(el: HTMLElement, container: HTMLElement): void {
    const rect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const elementTop = container.scrollTop + rect.top - containerRect.top;
    const targetScrollTop = elementTop - (container.clientHeight - rect.height) / 2;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = Math.min(maxScrollTop, Math.max(0, targetScrollTop));
  }

  function ensureLightboxTargetVisible(item: HistoryItem): TargetVisibilityResult {
    const wrapper = findThumbWrapper(item.id);
    if (!wrapper) return { found: false, scrolled: false };

    const scrollContainer = findScrollContainer(wrapper);
    if (scrollContainer) {
      if (isFullyVisibleInContainer(wrapper, scrollContainer)) {
        return { found: true, scrolled: false };
      }
      centerElementInContainer(wrapper, scrollContainer);
      return { found: true, scrolled: true };
    }

    wrapper.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: 'auto',
    });
    return { found: true, scrolled: true };
  }

  async function handleLightboxNavigate(direction: 'prev' | 'next'): Promise<void> {
    const idx = lightboxIndex.value;
    const data = lightboxPageData.value;

    // 页内直接切
    if (direction === 'next' && idx >= 0 && idx < data.length - 1) {
      await landOnItem(data[idx + 1]);
      return;
    }
    if (direction === 'prev' && idx > 0) {
      await landOnItem(data[idx - 1]);
      return;
    }

    // 跨页：达到当前页边界，触发相邻页加载，表格页码随灯箱自动跟随
    if (isCrossingPage) return;
    if (direction === 'next' && lightboxPage.value >= totalPages.value) return;
    if (direction === 'prev' && lightboxPage.value <= 1) return;

    isCrossingPage = true;
    try {
      const targetPage = direction === 'next' ? lightboxPage.value + 1 : lightboxPage.value - 1;
      const result = await peekPage(targetPage);
      // 等 DataTable 把新页渲染到 DOM：syncHoverPreviewToItem 要查
      // .thumb-box[data-lightbox-id="..."]，不等 tick 新页行还没挂上
      await nextTick();
      const newData = result.items;
      if (newData.length === 0) return;
      // next → 新页第 0 张；prev → 新页末张（保持"越切越老/越切越新"的时间方向连续）
      const landIndex = direction === 'next' ? 0 : newData.length - 1;
      const targetItem = newData[landIndex];
      lightboxPage.value = targetPage;
      lightboxPageData.value = newData;
      await landOnItem(targetItem, { ensureVisible: false });
      scheduleTablePageSync(targetPage);
    } catch (error) {
      logger.error('灯箱跨页失败:', error);
    } finally {
      isCrossingPage = false;
    }
  }

  function computePreviewSize(item: HistoryItem): PreviewSize {
    const width = Number(item.width);
    const height = Number(item.height);

    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      const scale = Math.min(1, PREVIEW_MAX_SIZE / width, PREVIEW_MAX_SIZE / height);
      return {
        width: width * scale,
        height: height * scale,
      };
    }

    const aspectRatio = Number(item.aspectRatio);
    if (Number.isFinite(aspectRatio) && aspectRatio > 0) {
      if (aspectRatio >= 1) {
        return { width: PREVIEW_MAX_SIZE, height: PREVIEW_MAX_SIZE / aspectRatio };
      }
      return { width: PREVIEW_MAX_SIZE * aspectRatio, height: PREVIEW_MAX_SIZE };
    }

    return { width: PREVIEW_MAX_SIZE, height: PREVIEW_MAX_SIZE };
  }

  /** 根据目标行 rect 计算预览的 top/left（避让视口边界） */
  function computePreviewPosition(anchor: DOMRect, previewSize: PreviewSize): { top: number; left: number } {
    let top = anchor.top + anchor.height / 2 - previewSize.height / 2;
    let left = anchor.right + PREVIEW_MARGIN;
    if (top < PREVIEW_MARGIN) top = PREVIEW_MARGIN;
    if (top + previewSize.height > window.innerHeight - PREVIEW_MARGIN) {
      top = window.innerHeight - previewSize.height - PREVIEW_MARGIN;
    }
    if (left + previewSize.width > window.innerWidth - PREVIEW_MARGIN) {
      left = anchor.left - previewSize.width - PREVIEW_MARGIN;
    }
    if (left < PREVIEW_MARGIN) left = PREVIEW_MARGIN;
    return { top, left };
  }

  /**
   * 把悬浮预览同步到指定图：查该图对应行的 wrapper rect，重算预览位置和内容
   * 找不到行或无 medium url 时收起预览（关闭动画走 fade 兜底）
   */
  function syncHoverPreviewToItem(item: HistoryItem): void {
    // CSS.escape 防御：即便 HistoryItem.id 当前由 Rust 侧生成 UUID 不含特殊字符，
    // 未来若 id 规则变动（例如混入文件名派生）拼接特殊字符会让选择器构造失败
    const wrapper = findThumbWrapper(item.id);
    const url = thumbCache.getMediumImageUrl(item);
    if (!wrapper || !url) {
      hoverPreview.value.visible = false;
      hoverPreview.value.closing = false;
      return;
    }
    const { top, left } = computePreviewPosition(wrapper.getBoundingClientRect(), computePreviewSize(item));
    hoverPreview.value = {
      visible: true,
      closing: false,
      url,
      alt: item.localFileName,
      itemId: item.id,
      style: { top: `${top}px`, left: `${left}px` },
    };
  }

  async function handleLightboxDelete(item: HistoryItem): Promise<void> {
    try {
      const deleted = await viewState.deleteHistoryItem(item.id);
      if (deleted === false) return;
      lightboxVisible.value = false;
      toast.success('已删除', '1 条记录');
    } catch (error) {
      logger.error('删除失败:', error);
      toast.error('删除失败', String(error));
    }
  }

  async function handleToggleFavorite(item: HistoryItem): Promise<void> {
    try {
      // toggleFavorite 以 favoriteSet 为 previousState 权威源；未加载时 favSet 空，取反会反向收藏
      // 只需 stats（含 favoriteSet），不触发全量 metas 加载
      if (!historyManager.isStatsLoaded.value) await historyManager.loadStats();
      await historyManager.toggleFavorite(item.id);
    } catch {
      // useHistory 内部已处理 toast 通知
    }
  }

  // ---- 服务 Popover ----
  const popoverItem = ref<HistoryItem | null>(null);
  const popoverServices = ref<string[]>([]);

  function openServicePopover(event: Event, item: HistoryItem, serviceIds: string[]): void {
    if (serviceIds.length === 0) {
      popoverItem.value = null;
      popoverServices.value = [];
      return;
    }
    popoverItem.value = item;
    popoverServices.value = [...serviceIds];
    servicePopoverRef.value?.toggle(event);
  }

  async function handleCopyServiceLink(item: HistoryItem, serviceId: string): Promise<void> {
    try {
      const result = item.results.find((r) => r.serviceId === serviceId && r.status === 'success');
      if (!result?.result?.url) {
        toast.warn('无可用链接', `${getServiceDisplayName(serviceId)} 图床没有可用的链接`);
        return;
      }
      let link = applyZhihuSourceFromConfig(result.result.url, configManager.config.value);
      if (serviceId === 'weibo' && configManager.config.value.linkPrefixConfig) {
        const activePrefix = configManager.getActivePrefix(configManager.config.value.linkPrefixConfig);
        if (activePrefix) link = applyPrefixTemplate(activePrefix.template, link);
      }
      await writeText(link);
      markServiceCopied(getServiceCopyKey(item.id, serviceId));
      toast.silent('log', '已复制', `${getServiceDisplayName(serviceId)} 链接已复制到剪贴板`);
    } catch (error) {
      logger.error(`复制 ${serviceId} 链接失败:`, error);
      toast.error('复制失败', String(error));
    }
  }

  function handlePopoverCopyLink(serviceId: string): void {
    if (!popoverItem.value) return;
    handleCopyServiceLink(popoverItem.value, serviceId);
  }

  function getServiceCopyKey(historyId: string, serviceId: string): string {
    return makeCopyBadgeKey('history-table', historyId, serviceId);
  }

  function isPopoverServiceCopied(serviceId: string): boolean {
    if (!popoverItem.value) return false;
    return copiedServiceKey.value === getServiceCopyKey(popoverItem.value.id, serviceId);
  }

  // ---- 悬浮预览 ----
  const hoverPreview = ref({
    visible: false, closing: false, url: '', alt: '', itemId: '',
    style: {} as Record<string, string>,
  });

  function handlePreviewEnter(event: MouseEvent, item: HistoryItem): void {
    if (isLightboxOpening.value || isLightboxClosing.value) return;
    const url = thumbCache.getMediumImageUrl(item);
    if (!url) return;
    warmImages([url, getItemImageUrl(item)]);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const { top, left } = computePreviewPosition(rect, computePreviewSize(item));
    hoverPreview.value = { visible: true, closing: false, url, alt: item.localFileName, itemId: item.id, style: { top: `${top}px`, left: `${left}px` } };
  }

  function handlePreviewLeave(): void {
    // Lightbox 打开动画期间保持预览可见，供 PhotoSwipe FLIP 使用
    if (isLightboxOpening.value) return;
    if (isLightboxClosing.value) {
      requestHoverPreviewDismissAfterClose();
      return;
    }
    clearHoverPreview();
  }

  //
  // 关闭时序（鼠标不在缩略图上，以 T=0 标记 Esc/点关按钮的瞬间）：
  //
  //   T=0ms          PhotoSwipe close 事件同步调用 resolveLightboxCloseTargetMode：
  //                  鼠标不在源缩略图上 → thumb；仍在源缩略图上 → preview
  //   T=0ms          本 watch 触发，isLightboxClosing = true，拆除 mousemove 监听
  //   T=180ms        预览已透明，主图仍在收回到小缩略图
  //   T=300ms        PhotoSwipe 收回基本结束，移除预览 DOM，恢复 hover 交互
  //
  // 关键不变量：关闭目标必须在 PhotoSwipe opener.close() 计算 thumb bounds 前同步决定。
  //
  // 若鼠标仍在缩略图上：跳过 closing 态，让预览保持可见，等用户移开时 handlePreviewLeave
  // 自然接管；此路径下 closingTimer 仍按 300ms 走完，防止 FLIP 刚落地时的合成 mouseenter 乱跳。
  //
  watch(lightboxVisible, (visible) => {
    if (!visible) {
      if (openingTimer) { clearTimeout(openingTimer); openingTimer = null; }
      if (closingTimer) { clearTimeout(closingTimer); closingTimer = null; }
      isLightboxOpening.value = false;
      isLightboxClosing.value = true;
      hoverPreview.value.closing = false;

      // 用几何坐标直接比对 wrapper rect，不用 elementFromPoint（避免 overlay 销毁时序干扰）
      // lastMouseX < 0 表示键盘开场，无有效坐标，跳过 hit-test
      const sourceId = hoverPreview.value.itemId;
      const mouseIsOnSourceThumb = sourceId ? isMouseOnSourceThumb(sourceId) : false;
      keepHoverPreviewAfterClose = mouseIsOnSourceThumb;

      // 坐标读完即可卸载追踪器，本次会话用完
      document.removeEventListener('mousemove', trackMouse);

      if (!mouseIsOnSourceThumb) {
        hoverPreview.value.closing = true;
        stopHoverHandoffTracking();
      } else if (sourceId) {
        startHoverHandoffTracking(sourceId);
      }
      // 若鼠标仍在缩略图上，保持 visible = true，FLIP 落地后预览无缝衔接，
      // 用户移开鼠标时 handlePreviewLeave 会自然隐藏。

      closingTimer = setTimeout(() => {
        if (!keepHoverPreviewAfterClose) {
          clearHoverPreview();
        } else {
          hoverPreview.value.closing = false;
        }
        isLightboxClosing.value = false;
        closingTimer = null;
      }, motionDuration(CLOSING_DURATION));
    }
  });

  watch([currentPageData, currentPage], ([pageData, page]) => {
    const current = lightboxItem.value;
    if (!lightboxVisible.value || !current) return;
    if (pageData.some((item) => item.id === current.id)) {
      lightboxPageData.value = pageData;
      lightboxPage.value = page;
    }
  });

  function cleanupTransientPreviewState(): void {
    if (openingTimer) { clearTimeout(openingTimer); openingTimer = null; }
    if (closingTimer) { clearTimeout(closingTimer); closingTimer = null; }
    isLightboxOpening.value = false;
    isLightboxClosing.value = false;
    clearHoverPreview();
    document.removeEventListener('mousemove', trackMouse);
  }

  onDeactivated(cleanupTransientPreviewState);
  onUnmounted(cleanupTransientPreviewState);

  return {
    // 灯箱
    lightboxVisible,
    lightboxItem,
    lightboxHasPrev,
    lightboxHasNext,
    openLightbox,
    handleLightboxDelete,
    handleLightboxNavigate,
    handleToggleFavorite,
    resolveLightboxCloseTargetMode,
    // 服务 Popover
    popoverServices,
    openServicePopover,
    handlePopoverCopyLink,
    handleCopyServiceLink,
    copiedServiceKey,
    getServiceCopyKey,
    isPopoverServiceCopied,
    // 悬浮预览
    hoverPreview,
    handlePreviewEnter,
    handlePreviewLeave,
    clearHoverPreview,
  };
}
