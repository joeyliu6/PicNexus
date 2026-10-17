// 列表视图里打开的灯箱：按列表眼前的顺序翻页（按文件名 / 大小 / 时间排的都一样），
// 「3 / 21」写的是列表里的第几行。接口与网格那份（useTimelineLightbox）一致，由 useGalleryLightbox 二选一。
import { computed, ref, type Ref } from 'vue';
import type { HistoryItem, UserConfig } from '@/config/types';
import { useLightboxCore } from '@/composables/common/useLightboxCore';
import { useLightboxPreloader } from '@/composables/image/useLightboxPreloader';
import { safeImageUrl } from '@/security/networkPolicy';
import type { GalleryListRow } from '@/services/database/TimelineQueryService';
import { warmImages } from '@/utils/imagePreload';
import { getPrimaryImageUrl } from '@/utils/imageUrl';
import type { GalleryListApi } from './useGalleryList';

export interface ListLightboxOptions {
  list: Pick<GalleryListApi, 'ensure' | 'rowAt'>;
  /** 列表一共几行（当前筛选下的张数） */
  total: Ref<number>;
  detailCache: { getDetail: (id: string) => Promise<HistoryItem> };
  config: Ref<UserConfig>;
  /** 与缩略图同一份：预热也是请求，先过 safeImageUrl */
  confirmedHttpHosts: () => ReadonlySet<string> | undefined;
  toast: { error: (title: string, detail?: string) => void };
}

export function useListLightbox(options: ListLightboxOptions) {
  const { list, total, detailCache, config, confirmedHttpHosts, toast } = options;
  const core = useLightboxCore({ silentLoadError: true, toast });
  /** 当前这张在列表里是第几行（从 0 起） */
  const index = ref(-1);
  /** 连按方向键时只认最后一次：先到的旧结果不覆盖新的 */
  let token = 0;

  const lightboxHasPrev = computed(() => index.value > 0);
  const lightboxHasNext = computed(() => index.value >= 0 && index.value < total.value - 1);
  const position = computed(() => (index.value >= 0 ? index.value + 1 : null));

  const gate = (url: string | null | undefined): string | null => safeImageUrl(url, confirmedHttpHosts()) ?? null;

  async function rowAt(i: number): Promise<GalleryListRow | null> {
    if (i < 0 || i >= total.value) return null;
    await list.ensure(i);
    return list.rowAt(i);
  }

  async function show(i: number, opening: boolean): Promise<void> {
    const mine = ++token;
    const row = await rowAt(i);
    if (!row || mine !== token) return;
    index.value = i;
    const loader = async () => {
      const detail = await detailCache.getDetail(row.id);
      warmImages([gate(getPrimaryImageUrl(detail, config.value))]);
      return detail;
    };
    await (opening ? core.showItem(loader) : core.loadItem(loader));
  }

  // 相邻两张的大图提前热好（同一道闸）
  useLightboxPreloader({
    currentItemId: computed(() => core.lightboxItem.value?.id ?? null),
    resolveAdjacentUrl: async (direction) => {
      const row = await rowAt(index.value + (direction === 'next' ? 1 : -1));
      if (!row) return null;
      return gate(getPrimaryImageUrl(await detailCache.getDetail(row.id), config.value));
    },
  });

  async function handleLightboxNavigate(direction: 'prev' | 'next'): Promise<void> {
    const next = index.value + (direction === 'next' ? 1 : -1);
    if (next < 0 || next >= total.value) return;
    await show(next, false);
  }

  return {
    lightboxVisible: core.lightboxVisible,
    lightboxItem: core.lightboxItem,
    lightboxHasPrev,
    lightboxHasNext,
    position,
    open: (i: number) => show(i, true),
    handleLightboxNavigate,
  };
}

export type ListLightbox = ReturnType<typeof useListLightbox>;
