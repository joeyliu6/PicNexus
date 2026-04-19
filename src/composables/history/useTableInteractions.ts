/**
 * useTableInteractions — 历史表格的交互逻辑
 * 包含：灯箱、服务 Popover、悬浮预览、复制链接
 * 从 HistoryTableView.vue 提取
 */
import { ref, computed, watch, onUnmounted, type Ref } from 'vue';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type PopoverType from 'primevue/popover';
import type { HistoryItem } from '../../config/types';
import { getPrimaryImageUrl } from '../../utils/imageUrl';
import { applyPrefixTemplate } from '../../utils/linkPrefixTemplate';
import { getServiceDisplayName } from '../../constants/serviceNames';
import { useHistoryViewState } from '../useHistoryViewState';
import { useHistoryManager } from '../useHistory';
import { useThumbCache } from '../useThumbCache';
import { useConfigManager } from '../useConfig';
import { useToast } from '../useToast';
import { createLogger } from '../../utils/logger';
import { motionDuration } from '../../utils/reducedMotion';
import { HIDE_ANIMATION_DURATION, SHOW_ANIMATION_DURATION } from './usePhotoSwipeBridge';

const logger = createLogger('TableInteractions');

const PREVIEW_MAX_SIZE = 300;
const PREVIEW_MARGIN = 8;
/** 灯箱打开动画时长（ms），留出 100ms 缓冲覆盖 PhotoSwipe show 动画尾帧 */
const OPENING_DURATION = SHOW_ANIMATION_DURATION + 100;
/**
 * 悬浮预览 <Transition name="thumb-preview"> 的 leave 时长（ms），
 * 必须与 HistoryTableView.vue 里 .thumb-preview-leave-active 的 --duration-medium 对齐。
 *
 * 为什么 300ms：第一段 FLIP (200ms) 全程在做缩放+位移，减速到位；
 * 若紧接着用 120ms 纯 opacity 淡出（无空间线索），人眼识别为"瞬间消失"。
 * 300ms + blur 散焦让两段节奏比例 1:1.5，视觉连贯。
 */
const PREVIEW_LEAVE_DURATION = 300;
/**
 * 灯箱关闭的"拦截窗口"时长（ms），覆盖 FLIP 收回 + 预览 leave 全程。
 * 公式：HIDE_ANIMATION_DURATION(200) + PREVIEW_LEAVE_DURATION(300) = 500ms。
 * 这保证 isLightboxClosing flag 精确覆盖整个退出动画，避免 fast-scan 场景下
 * Vue Transition leave 尚未结束时 handlePreviewEnter/Leave 提前解封导致的 glitch。
 */
const CLOSING_DURATION = HIDE_ANIMATION_DURATION + PREVIEW_LEAVE_DURATION;

interface UseTableInteractionsOptions {
  /** 当前页数据（灯箱导航用） */
  currentPageData: Ref<HistoryItem[]>;
  /** 获取某条记录的成功上传服务列表 */
  getSuccessfulServices: (item: HistoryItem) => string[];
  /** Popover 组件 template ref（由调用方声明，以避免 vue-tsc TS6133） */
  servicePopoverRef: Ref<InstanceType<typeof PopoverType> | null>;
}

export function useTableInteractions(options: UseTableInteractionsOptions) {
  const { currentPageData, getSuccessfulServices, servicePopoverRef } = options;

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
  /** 延后隐藏悬浮预览的 timer，用于让 PhotoSwipe FLIP 先独占落地 */
  let hidePreviewTimer: ReturnType<typeof setTimeout> | null = null;
  const isLightboxOpening = ref(false);
  const isLightboxClosing = ref(false);

  // 鼠标位置追踪：仅在灯箱会话期间挂载，用于关闭时判断鼠标是否仍在源缩略图上
  // -1 为哨兵值，表示本次会话由键盘触发、无鼠标坐标，跳过 hit-test
  let lastMouseX = -1;
  let lastMouseY = -1;
  function trackMouse(e: MouseEvent): void { lastMouseX = e.clientX; lastMouseY = e.clientY; }

  const lightboxIndex = computed(() => {
    if (!lightboxItem.value) return -1;
    return currentPageData.value.findIndex((item) => item.id === lightboxItem.value!.id);
  });
  const lightboxHasPrev = computed(() => lightboxIndex.value > 0);
  const lightboxHasNext = computed(() =>
    lightboxIndex.value >= 0 && lightboxIndex.value < currentPageData.value.length - 1,
  );

  function openLightbox(item: HistoryItem, event?: MouseEvent): void {
    // 清理可能还在排队的"延后隐藏 timer"：防止上次关闭遗留的 timer
    // 在新 FLIP 开场途中把刚弹起的预览弄没（快速连开场景的 race bug）
    if (hidePreviewTimer) { clearTimeout(hidePreviewTimer); hidePreviewTimer = null; }

    // 鼠标追踪仅在灯箱会话期间挂载，用完即拆，避免全生命周期的 60Hz 监听
    if (event) { lastMouseX = event.clientX; lastMouseY = event.clientY; }
    else { lastMouseX = -1; lastMouseY = -1; }
    document.addEventListener('mousemove', trackMouse);

    // 阻止悬浮预览在 Lightbox 打开动画期间消失，
    // 让 PhotoSwipe 能从预览元素做 FLIP 过渡
    isLightboxOpening.value = true;
    lightboxItem.value = item;
    lightboxVisible.value = true;
    if (openingTimer) clearTimeout(openingTimer);
    openingTimer = setTimeout(() => { isLightboxOpening.value = false; openingTimer = null; }, motionDuration(OPENING_DURATION));
  }

  function getItemImageUrl(item: HistoryItem): string {
    return getPrimaryImageUrl(item, configManager.config.value);
  }

  function preloadAdjacentImage(currentIdx: number, direction: 'prev' | 'next'): void {
    const preloadIdx = direction === 'prev' ? currentIdx - 1 : currentIdx + 1;
    if (preloadIdx < 0 || preloadIdx >= currentPageData.value.length) return;
    const url = getItemImageUrl(currentPageData.value[preloadIdx]);
    if (url) new Image().src = url;
  }

  function handleLightboxNavigate(direction: 'prev' | 'next'): void {
    const idx = lightboxIndex.value;
    const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
    if (nextIdx < 0 || nextIdx >= currentPageData.value.length) return;
    const nextItem = currentPageData.value[nextIdx];
    lightboxItem.value = nextItem;
    // 悬浮预览过继到新图：若本次以 hover 打开（visible=true），翻页后仍保持 300px 预览
    // 挂在新图所在行旁；关闭动画飞回预览位置再淡出，体验与不翻页时一致。
    // 键盘打开（visible=false）则保持 false，关闭走 fade，避免"开 fade/关 FLIP"不对称。
    if (hoverPreview.value.visible) syncHoverPreviewToItem(nextItem);
    preloadAdjacentImage(nextIdx, direction);
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
    const thumbBox = document.querySelector<HTMLElement>(
      `.thumb-box[data-lightbox-id="${item.id}"]`,
    );
    const wrapper = thumbBox?.closest<HTMLElement>('.thumb-preview-wrapper');
    const url = thumbCache.getMediumImageUrl(item);
    if (!wrapper || !url) {
      hoverPreview.value.visible = false;
      return;
    }
    const { top, left } = computePreviewPosition(wrapper.getBoundingClientRect());
    hoverPreview.value = {
      visible: true,
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
      let link = result.result.url;
      if (serviceId === 'weibo' && configManager.config.value.linkPrefixConfig) {
        const activePrefix = configManager.getActivePrefix(configManager.config.value.linkPrefixConfig);
        if (activePrefix) link = applyPrefixTemplate(activePrefix.template, link);
      }
      await writeText(link);
      toast.success('已复制', `${getServiceDisplayName(serviceId)} 链接已复制到剪贴板`, 1500);
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
    visible: false, url: '', alt: '', itemId: '',
    style: {} as Record<string, string>,
  });

  function handlePreviewEnter(event: MouseEvent, item: HistoryItem): void {
    if (isLightboxOpening.value || isLightboxClosing.value) return;
    const url = thumbCache.getMediumImageUrl(item);
    if (!url) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    let top = rect.top + rect.height / 2 - PREVIEW_MAX_SIZE / 2;
    let left = rect.right + PREVIEW_MARGIN;
    if (top < PREVIEW_MARGIN) top = PREVIEW_MARGIN;
    if (top + PREVIEW_MAX_SIZE > window.innerHeight - PREVIEW_MARGIN) top = window.innerHeight - PREVIEW_MAX_SIZE - PREVIEW_MARGIN;
    if (left + PREVIEW_MAX_SIZE > window.innerWidth - PREVIEW_MARGIN) left = rect.left - PREVIEW_MAX_SIZE - PREVIEW_MARGIN;
    if (left < PREVIEW_MARGIN) left = PREVIEW_MARGIN;
    hoverPreview.value = { visible: true, url, alt: item.localFileName, itemId: item.id, style: { top: `${top}px`, left: `${left}px` } };
  }

  function handlePreviewLeave(): void {
    // Lightbox 打开动画期间保持预览可见，供 PhotoSwipe FLIP 使用
    if (isLightboxOpening.value) return;
    hoverPreview.value.visible = false;
  }

  //
  // 关闭时序（鼠标不在缩略图上，以 T=0 标记 Esc/点关按钮的瞬间）：
  //
  //   T=0ms          PhotoSwipe dispatch 'close' → lightboxVisible=false → 本 watch 触发
  //                  isLightboxClosing = true；启动 hidePreviewTimer(200) 与 closingTimer(500)
  //                  读取最后一次鼠标坐标并拆除 mousemove 监听
  //   T=0..200ms     PhotoSwipe FLIP 把大图收回 hover preview 位置；预览保持满不透明度
  //   T=200ms        hidePreviewTimer 触发 → hoverPreview.visible=false → thumb-preview leave 启动
  //   T=200..500ms   Vue Transition leave 执行（opacity 1→0 + filter blur 0→3px，--duration-medium 300ms）
  //                  blur 散焦提供持续"动"的视觉线索，承接 FLIP 减速尾帧
  //   T=500ms        closingTimer 触发 → isLightboxClosing=false，恢复 hover 交互
  //
  // 关键不变量：CLOSING_DURATION = HIDE_ANIMATION_DURATION + PREVIEW_LEAVE_DURATION，
  // 保证 closing 拦截窗口与实际退出动画等长，消除 fast-scan 场景的 glitch。
  //
  // 若鼠标仍在缩略图上：跳过 hidePreviewTimer，让预览保持可见，等用户移开时 handlePreviewLeave
  // 自然接管；此路径下 closingTimer 仍按 500ms 走完，防止 FLIP 刚落地时的合成 mouseenter 乱跳。
  //
  watch(lightboxVisible, (visible) => {
    if (!visible) {
      isLightboxClosing.value = true;

      // 用几何坐标直接比对 wrapper rect，不用 elementFromPoint（避免 overlay 销毁时序干扰）
      // lastMouseX < 0 表示键盘开场，无有效坐标，跳过 hit-test
      const sourceId = hoverPreview.value.itemId;
      let mouseIsOnSourceThumb = false;
      if (sourceId && hoverPreview.value.url && lastMouseX >= 0) {
        const thumbBox = document.querySelector<HTMLElement>(
          `.thumb-box[data-lightbox-id="${sourceId}"]`,
        );
        const checkEl = thumbBox?.closest<HTMLElement>('.thumb-preview-wrapper');
        if (checkEl) {
          const rect = checkEl.getBoundingClientRect();
          mouseIsOnSourceThumb =
            lastMouseX >= rect.left && lastMouseX <= rect.right &&
            lastMouseY >= rect.top && lastMouseY <= rect.bottom;
        }
      }

      // 坐标读完即可卸载追踪器，本次会话用完
      document.removeEventListener('mousemove', trackMouse);

      if (!mouseIsOnSourceThumb) {
        // 推迟到 FLIP 落地再触发 Vue Transition 的 leave，两段动作串行不打架
        if (hidePreviewTimer) clearTimeout(hidePreviewTimer);
        hidePreviewTimer = setTimeout(() => {
          hoverPreview.value.visible = false;
          hidePreviewTimer = null;
        }, motionDuration(HIDE_ANIMATION_DURATION));
      }
      // 若鼠标仍在缩略图上，保持 visible = true，FLIP 落地后预览无缝衔接，
      // 用户移开鼠标时 handlePreviewLeave 会自然隐藏。

      if (closingTimer) clearTimeout(closingTimer);
      closingTimer = setTimeout(() => { isLightboxClosing.value = false; closingTimer = null; }, motionDuration(CLOSING_DURATION));
    }
  });

  onUnmounted(() => {
    if (openingTimer) { clearTimeout(openingTimer); openingTimer = null; }
    if (closingTimer) { clearTimeout(closingTimer); closingTimer = null; }
    if (hidePreviewTimer) { clearTimeout(hidePreviewTimer); hidePreviewTimer = null; }
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
