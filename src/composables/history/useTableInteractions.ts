/**
 * useTableInteractions — 历史表格的交互逻辑
 * 包含：灯箱、服务 Popover、悬浮预览、复制链接
 * 从 HistoryTableView.vue 提取
 */
import { ref, computed, watch, nextTick, onUnmounted, type Ref } from 'vue';
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

interface UseTableInteractionsOptions {
  /** 当前页数据（灯箱导航用） */
  currentPageData: Ref<HistoryItem[]>;
  /** 当前页码（1-based） */
  currentPage: Ref<number>;
  /** 总页数 */
  totalPages: Ref<number>;
  /** 程序化翻页；返回新页加载完成的 Promise */
  goToPage: (pageNumber: number) => Promise<void>;
  /** 获取某条记录的成功上传服务列表 */
  getSuccessfulServices: (item: HistoryItem) => string[];
  /** Popover 组件 template ref（由调用方声明，以避免 vue-tsc TS6133） */
  servicePopoverRef: Ref<InstanceType<typeof PopoverType> | null>;
}

export function useTableInteractions(options: UseTableInteractionsOptions) {
  const {
    currentPageData, currentPage, totalPages, goToPage,
    getSuccessfulServices, servicePopoverRef,
  } = options;

  const toast = useToast();
  const configManager = useConfigManager();
  const viewState = useHistoryViewState();
  const historyManager = useHistoryManager();
  const thumbCache = useThumbCache();

  // ---- 灯箱 ----
  const lightboxVisible = ref(false);
  const lightboxItem = ref<HistoryItem | null>(null);
  let openingTimer: ReturnType<typeof setTimeout> | null = null;
  let closingTimer: ReturnType<typeof setTimeout> | null = null;
  const isLightboxOpening = ref(false);
  const isLightboxClosing = ref(false);

  // 鼠标位置追踪：仅在灯箱会话期间挂载，用于关闭时判断鼠标是否仍在源缩略图上
  // -1 为哨兵值，表示本次会话由键盘触发、无鼠标坐标，跳过 hit-test
  let lastMouseX = -1;
  let lastMouseY = -1;
  function trackMouse(e: MouseEvent): void { lastMouseX = e.clientX; lastMouseY = e.clientY; }

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
    return currentPageData.value.findIndex((item) => item.id === lightboxItem.value!.id);
  });
  // 跨页能力：到当前页边界时，只要还有相邻页就允许继续翻（handleLightboxNavigate 内部触发加载）
  const lightboxHasPrev = computed(() =>
    lightboxIndex.value > 0 || currentPage.value > 1,
  );
  const lightboxHasNext = computed(() => {
    const idx = lightboxIndex.value;
    if (idx < 0) return false;
    return idx < currentPageData.value.length - 1 || currentPage.value < totalPages.value;
  });

  function openLightbox(item: HistoryItem, event?: MouseEvent): void {
    // 清理可能还在排队的关闭 timer：防止上次关闭遗留的 timer
    // 在新 FLIP 开场途中把刚弹起的预览弄没（快速连开场景的 race bug）
    if (closingTimer) { clearTimeout(closingTimer); closingTimer = null; }
    isLightboxClosing.value = false;
    hoverPreview.value.closing = false;

    // 鼠标追踪仅在灯箱会话期间挂载，用完即拆，避免全生命周期的 60Hz 监听
    if (event) { lastMouseX = event.clientX; lastMouseY = event.clientY; }
    else { lastMouseX = -1; lastMouseY = -1; }
    document.addEventListener('mousemove', trackMouse);

    // 阻止悬浮预览在 Lightbox 打开动画期间消失，
    // 让 PhotoSwipe 能从预览元素做 FLIP 过渡
    isLightboxOpening.value = true;
    warmImages([thumbCache.getMediumImageUrl(item), getItemImageUrl(item)]);
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
    resolveAdjacentUrl: (direction) => {
      const idx = lightboxIndex.value;
      if (idx < 0) return null;
      const targetIdx = direction === 'prev' ? idx - 1 : idx + 1;
      const target = currentPageData.value[targetIdx];
      return target ? getItemImageUrl(target) : null;
    },
  });

  // 跨页导航并发保护：用户快按时多次 goToPage 会互相作废（loadVersion 机制），
  // 用 isCrossingPage 直接忽略重入，保证 lightboxItem 的落点与最终页数据一致
  let isCrossingPage = false;

  /** 切到新图的公共收尾：过继悬浮预览（预加载由 useLightboxPreloader 自动接管） */
  function landOnItem(item: HistoryItem): void {
    lightboxItem.value = item;
    if (hoverPreview.value.visible) syncHoverPreviewToItem(item);
  }

  async function handleLightboxNavigate(direction: 'prev' | 'next'): Promise<void> {
    const idx = lightboxIndex.value;
    const data = currentPageData.value;

    // 页内直接切
    if (direction === 'next' && idx >= 0 && idx < data.length - 1) {
      landOnItem(data[idx + 1]);
      return;
    }
    if (direction === 'prev' && idx > 0) {
      landOnItem(data[idx - 1]);
      return;
    }

    // 跨页：达到当前页边界，触发相邻页加载，表格页码随灯箱自动跟随
    if (isCrossingPage) return;
    if (direction === 'next' && currentPage.value >= totalPages.value) return;
    if (direction === 'prev' && currentPage.value <= 1) return;

    isCrossingPage = true;
    try {
      const targetPage = direction === 'next' ? currentPage.value + 1 : currentPage.value - 1;
      await goToPage(targetPage);
      // 等 DataTable 把新页渲染到 DOM：syncHoverPreviewToItem 要查
      // .thumb-box[data-lightbox-id="..."]，不等 tick 新页行还没挂上
      await nextTick();
      const newData = currentPageData.value;
      if (newData.length === 0) return;
      // next → 新页第 0 张；prev → 新页末张（保持"越切越老/越切越新"的时间方向连续）
      const landIndex = direction === 'next' ? 0 : newData.length - 1;
      landOnItem(newData[landIndex]);
    } catch (error) {
      logger.error('灯箱跨页失败:', error);
    } finally {
      isCrossingPage = false;
    }
  }

  /** 根据目标行 rect 计算 300px 预览的 top/left（避让视口边界） */
  function computePreviewPosition(anchor: DOMRect): { top: number; left: number } {
    let top = anchor.top + anchor.height / 2 - PREVIEW_MAX_SIZE / 2;
    let left = anchor.right + PREVIEW_MARGIN;
    if (top < PREVIEW_MARGIN) top = PREVIEW_MARGIN;
    if (top + PREVIEW_MAX_SIZE > window.innerHeight - PREVIEW_MARGIN) {
      top = window.innerHeight - PREVIEW_MAX_SIZE - PREVIEW_MARGIN;
    }
    if (left + PREVIEW_MAX_SIZE > window.innerWidth - PREVIEW_MARGIN) {
      left = anchor.left - PREVIEW_MAX_SIZE - PREVIEW_MARGIN;
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
    const thumbBox = document.querySelector<HTMLElement>(
      `.thumb-box[data-lightbox-id="${CSS.escape(item.id)}"]`,
    );
    const wrapper = thumbBox?.closest<HTMLElement>('.thumb-preview-wrapper');
    const url = thumbCache.getMediumImageUrl(item);
    if (!wrapper || !url) {
      hoverPreview.value.visible = false;
      hoverPreview.value.closing = false;
      return;
    }
    const { top, left } = computePreviewPosition(wrapper.getBoundingClientRect());
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
      await viewState.deleteHistoryItem(item.id);
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
  const popoverServices = computed<string[]>(() => {
    if (!popoverItem.value) return [];
    return getSuccessfulServices(popoverItem.value);
  });

  function openServicePopover(event: Event, item: HistoryItem): void {
    popoverItem.value = item;
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
    const { top, left } = computePreviewPosition(rect);
    hoverPreview.value = { visible: true, closing: false, url, alt: item.localFileName, itemId: item.id, style: { top: `${top}px`, left: `${left}px` } };
  }

  function handlePreviewLeave(): void {
    // Lightbox 打开动画期间保持预览可见，供 PhotoSwipe FLIP 使用
    if (isLightboxOpening.value) return;
    hoverPreview.value.closing = false;
    hoverPreview.value.visible = false;
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

      // 坐标读完即可卸载追踪器，本次会话用完
      document.removeEventListener('mousemove', trackMouse);

      if (!mouseIsOnSourceThumb) {
        hoverPreview.value.closing = true;
      }
      // 若鼠标仍在缩略图上，保持 visible = true，FLIP 落地后预览无缝衔接，
      // 用户移开鼠标时 handlePreviewLeave 会自然隐藏。

      closingTimer = setTimeout(() => {
        if (!mouseIsOnSourceThumb) {
          hoverPreview.value.visible = false;
        }
        isLightboxClosing.value = false;
        closingTimer = null;
      }, motionDuration(CLOSING_DURATION));
    }
  });

  onUnmounted(() => {
    if (openingTimer) { clearTimeout(openingTimer); openingTimer = null; }
    if (closingTimer) { clearTimeout(closingTimer); closingTimer = null; }
    document.removeEventListener('mousemove', trackMouse);
  });

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
    // 悬浮预览
    hoverPreview,
    handlePreviewEnter,
    handlePreviewLeave,
  };
}
