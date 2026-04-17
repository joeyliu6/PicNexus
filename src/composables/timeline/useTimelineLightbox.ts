/**
 * 灯箱（Lightbox）逻辑 Composable
 * 支持日内快翻（无延迟）和跨日按需加载（意图缓冲）
 */
import { ref, computed, type Ref } from 'vue';
import { createLogger } from '../../utils/logger';
import { getPrimaryImageUrl } from '../../utils/imageUrl';
import { type HistoryItem, type UserConfig } from '../../config/types';
import type { ImageMeta } from '../../types/image-meta';

const logger = createLogger('TimelineLightbox');

/** 从毫秒时间戳提取 dayKey，与 useTimelineDayPagination 保持一致 */
function tsToDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface UseTimelineLightboxOptions {
  /** 日 meta 缓存（key = dayKey） */
  dayMetaCache: Map<string, ImageMeta[]>;
  /** 已加载天的响应式 Set（用于驱动 currentDayItems 重算） */
  loadedDayKeys: Ref<Set<string>>;
  /** 按需加载指定天 */
  ensureDaysLoaded: (dayKeys: string[]) => Promise<void>;
  /** dayStats 降序中更早的那天 */
  findDayBefore: (dayKey: string) => string | null;
  /** dayStats 降序中更新的那天 */
  findDayAfter: (dayKey: string) => string | null;
  /** 详情缓存 */
  detailCache: { getDetail: (id: string) => Promise<HistoryItem> };
  /** 配置（用于生成图片 URL） */
  config: Ref<UserConfig>;
  /** 删除历史记录方法 */
  deleteHistoryItem: (id: string) => Promise<boolean>;
  /** 滚动到指定元素 */
  scrollToItem: (id: string, behavior?: ScrollBehavior) => void;
  /** Toast 通知 */
  toast: {
    success: (msg: string) => void;
    error: (title: string, detail?: string) => void;
  };
}

export function useTimelineLightbox(options: UseTimelineLightboxOptions) {
  const {
    dayMetaCache, loadedDayKeys, ensureDaysLoaded,
    findDayBefore, findDayAfter,
    detailCache, config, deleteHistoryItem, scrollToItem, toast,
  } = options;

  const lightboxVisible = ref(false);
  const lightboxItem = ref<HistoryItem | null>(null);
  /** 当前灯箱图片所在天 */
  const currentDayKey = ref('');
  /** 当前图片在该天内的索引 */
  const indexInDay = ref(0);

  /** 当前天的 meta 列表（响应式：loadedDayKeys 变化时重算） */
  const currentDayItems = computed<ImageMeta[]>(() => {
    if (!loadedDayKeys.value.has(currentDayKey.value)) return [];
    return dayMetaCache.get(currentDayKey.value) ?? [];
  });

  const lightboxHasPrev = computed(() =>
    indexInDay.value > 0 || findDayBefore(currentDayKey.value) !== null
  );
  const lightboxHasNext = computed(() => {
    const items = currentDayItems.value;
    return indexInDay.value < items.length - 1 || findDayAfter(currentDayKey.value) !== null;
  });

  // ==================== 导航（意图缓冲）====================

  let pendingDirection: 'prev' | 'next' | null = null;
  let isNavigating = false;

  /**
   * 单步导航，返回是否成功移动
   */
  async function navigateOneStep(direction: 'prev' | 'next'): Promise<boolean> {
    const items = currentDayItems.value;

    if (direction === 'next') {
      if (indexInDay.value < items.length - 1) {
        indexInDay.value++;
      } else {
        const nextDay = findDayAfter(currentDayKey.value);
        if (!nextDay) return false;
        await ensureDaysLoaded([nextDay]);
        const nextItems = dayMetaCache.get(nextDay) ?? [];
        if (nextItems.length === 0) return false;
        currentDayKey.value = nextDay;
        indexInDay.value = 0;
      }
    } else {
      if (indexInDay.value > 0) {
        indexInDay.value--;
      } else {
        const prevDay = findDayBefore(currentDayKey.value);
        if (!prevDay) return false;
        await ensureDaysLoaded([prevDay]);
        const prevItems = dayMetaCache.get(prevDay) ?? [];
        if (prevItems.length === 0) return false;
        currentDayKey.value = prevDay;
        indexInDay.value = prevItems.length - 1;
      }
    }

    return true;
  }

  async function loadAndDisplay(): Promise<void> {
    const items = currentDayItems.value;
    const meta = items[indexInDay.value];
    if (!meta) return;

    try {
      const detail = await detailCache.getDetail(meta.id);
      lightboxItem.value = detail;
      scrollToItem(meta.id);
      silentlyPreloadAdjacentDay();
    } catch (e) {
      logger.error('导航加载失败:', e);
    }
  }

  /** 日内剩余 ≤3 张时预加载相邻天（静默，不阻塞导航） */
  function silentlyPreloadAdjacentDay(): void {
    const items = currentDayItems.value;
    const remaining = items.length - 1 - indexInDay.value;
    if (remaining <= 3) {
      const nextDay = findDayAfter(currentDayKey.value);
      if (nextDay) void ensureDaysLoaded([nextDay]);
    }
    if (indexInDay.value <= 3) {
      const prevDay = findDayBefore(currentDayKey.value);
      if (prevDay) void ensureDaysLoaded([prevDay]);
    }
  }

  /** 预加载相邻图片的原始 URL（灯箱流畅翻页用） */
  async function preloadAdjacentImage(direction: 'prev' | 'next'): Promise<void> {
    const items = currentDayItems.value;
    const preloadIdx = direction === 'next' ? indexInDay.value + 1 : indexInDay.value - 1;
    const meta = items[preloadIdx];
    if (!meta) return;
    try {
      const detail = await detailCache.getDetail(meta.id);
      const url = getPrimaryImageUrl(detail, config.value);
      if (url) new Image().src = url;
    } catch { /* 预加载失败不影响用户体验 */ }
  }

  /** 灯箱导航：意图缓冲——导航中的快速按键会在当前步骤完成后立即处理 */
  async function handleLightboxNavigate(direction: 'prev' | 'next'): Promise<void> {
    if (isNavigating) {
      pendingDirection = direction; // last-wins
      return;
    }
    isNavigating = true;
    let nextDir: 'prev' | 'next' | null = direction;
    try {
      while (nextDir) {
        const moved = await navigateOneStep(nextDir);
        if (!moved) break;
        nextDir = pendingDirection;
        pendingDirection = null;
      }
      await loadAndDisplay();
    } catch (e) {
      logger.error('灯箱导航失败:', e);
    } finally {
      isNavigating = false;
      pendingDirection = null;
    }
  }

  // ==================== 打开 / 删除 ====================

  async function openLightbox(meta: ImageMeta): Promise<void> {
    const dayKey = tsToDayKey(meta.timestamp);
    const dayItems = dayMetaCache.get(dayKey) ?? [];
    const idx = dayItems.findIndex(m => m.id === meta.id);

    currentDayKey.value = dayKey;
    indexInDay.value = Math.max(0, idx);

    try {
      const detail = await detailCache.getDetail(meta.id);
      lightboxItem.value = detail;
      lightboxVisible.value = true;
      silentlyPreloadAdjacentDay();
      void preloadAdjacentImage('next');
    } catch (e) {
      logger.error('加载详情失败:', e);
      toast.error('加载失败', String(e));
    }
  }

  async function handleLightboxDelete(item: HistoryItem): Promise<void> {
    try {
      await deleteHistoryItem(item.id);
      lightboxVisible.value = false;
      toast.success('已删除');
    } catch (e) {
      toast.error('删除失败', String(e));
    }
  }

  return {
    lightboxVisible,
    lightboxItem,
    lightboxHasPrev,
    lightboxHasNext,
    openLightbox,
    handleLightboxDelete,
    handleLightboxNavigate,
  };
}
