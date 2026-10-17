// 图库灯箱的翻页从哪来：网格里打开的按天翻（useTimelineLightbox），列表里打开的按列表眼前的顺序翻
// （useListLightbox）。对灯箱只露一套状态，打开时记下是哪一种。
import { computed, ref } from 'vue';
import type { ImageMeta } from '@/types/image-meta';
import type { GalleryGridApi } from './useGalleryGrid';
import type { ListLightbox } from './useListLightbox';

export function useGalleryLightbox(grid: GalleryGridApi, listNav: ListLightbox) {
  const mode = ref<'grid' | 'list'>('grid');
  const active = () => (mode.value === 'grid' ? grid.lightbox : listNav);

  const lightboxVisible = computed({
    get: () => active().lightboxVisible.value,
    set: (visible: boolean) => { active().lightboxVisible.value = visible; },
  });
  const lightboxItem = computed(() => active().lightboxItem.value);
  const lightboxHasPrev = computed(() => active().lightboxHasPrev.value);
  const lightboxHasNext = computed(() => active().lightboxHasNext.value);

  /** 「3 / 21」：网格按天累加（没加载的天按统计的张数算），列表就是第几行 */
  const position = computed<number | null>(() => {
    if (mode.value === 'list') return listNav.position.value;
    const id = lightboxItem.value?.id;
    if (!id) return null;
    let before = 0;
    for (const group of grid.groups.value) {
      const index = group.items.findIndex((meta) => meta.id === id);
      if (index >= 0) return before + index + 1;
      before += group.items.length || group.expectedCount || 0;
    }
    return null;
  });

  function openFromGrid(meta: ImageMeta): Promise<void> {
    mode.value = 'grid';
    return grid.lightbox.openLightbox(meta);
  }

  function openFromList(index: number): Promise<void> {
    mode.value = 'list';
    return listNav.open(index);
  }

  return {
    lightboxVisible,
    lightboxItem,
    lightboxHasPrev,
    lightboxHasNext,
    position,
    openFromGrid,
    openFromList,
    handleLightboxNavigate: (direction: 'prev' | 'next') => active().handleLightboxNavigate(direction),
  };
}

export type GalleryLightboxApi = ReturnType<typeof useGalleryLightbox>;
