/**
 * useTableInteractions — 历史表格的交互逻辑
 * 包含：灯箱、服务 Popover、悬浮预览、复制链接
 * 从 HistoryTableView.vue 提取
 */
import { ref, computed, type Ref } from 'vue';
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

const logger = createLogger('TableInteractions');

const PREVIEW_MAX_SIZE = 300;
const PREVIEW_MARGIN = 8;

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

  const lightboxIndex = computed(() => {
    if (!lightboxItem.value) return -1;
    return currentPageData.value.findIndex((item) => item.id === lightboxItem.value!.id);
  });
  const lightboxHasPrev = computed(() => lightboxIndex.value > 0);
  const lightboxHasNext = computed(() =>
    lightboxIndex.value >= 0 && lightboxIndex.value < currentPageData.value.length - 1,
  );

  function openLightbox(item: HistoryItem): void {
    lightboxItem.value = item;
    lightboxVisible.value = true;
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
    lightboxItem.value = currentPageData.value[nextIdx];
    preloadAdjacentImage(nextIdx, direction);
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
    visible: false, url: '', alt: '',
    style: {} as Record<string, string>,
  });

  function handlePreviewEnter(event: MouseEvent, item: HistoryItem): void {
    const url = thumbCache.getMediumImageUrl(item);
    if (!url) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    let top = rect.top + rect.height / 2 - PREVIEW_MAX_SIZE / 2;
    let left = rect.right + PREVIEW_MARGIN;
    if (top < PREVIEW_MARGIN) top = PREVIEW_MARGIN;
    if (top + PREVIEW_MAX_SIZE > window.innerHeight - PREVIEW_MARGIN) top = window.innerHeight - PREVIEW_MAX_SIZE - PREVIEW_MARGIN;
    if (left + PREVIEW_MAX_SIZE > window.innerWidth - PREVIEW_MARGIN) left = rect.left - PREVIEW_MAX_SIZE - PREVIEW_MARGIN;
    if (left < PREVIEW_MARGIN) left = PREVIEW_MARGIN;
    hoverPreview.value = { visible: true, url, alt: item.localFileName, style: { top: `${top}px`, left: `${left}px` } };
  }

  function handlePreviewLeave(): void {
    hoverPreview.value.visible = false;
  }

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
