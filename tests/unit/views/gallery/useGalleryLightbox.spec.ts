import { describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import type { ImageMeta } from '@/types/image-meta';
import type { GalleryGridApi } from '@/views/gallery/useGalleryGrid';
import type { ListLightbox } from '@/views/gallery/useListLightbox';
import { useGalleryLightbox } from '@/views/gallery/useGalleryLightbox';

function fakeNav(): ListLightbox {
  return {
    lightboxVisible: ref(false),
    lightboxItem: ref(null),
    lightboxHasPrev: computed(() => false),
    lightboxHasNext: computed(() => false),
    position: computed(() => 7),
    open: vi.fn(async () => {}),
    handleLightboxNavigate: vi.fn(async () => {}),
  } as unknown as ListLightbox;
}

const meta = (id: string) => ({ id }) as ImageMeta;

// 待拍板 ①：网格分成「失效 · 有可用备份 / 无可用备份」两组时，灯箱 ← → 按两组眼前的顺序翻，
// 不再按天翻（两组里的图并不按日期排在一起）
describe('useGalleryLightbox', () => {
  it('pages through the two dead sections in the order the grid shows them', async () => {
    const sectionLightbox = fakeNav();
    const timeline = { ...fakeNav(), openLightbox: vi.fn(async () => {}) };
    const grid = {
      sectioned: ref(true),
      sectionItems: ref([meta('a'), meta('b'), meta('c')]),
      sectionLightbox,
      lightbox: timeline,
      groups: ref([]),
    } as unknown as GalleryGridApi;
    const nav = useGalleryLightbox(grid, fakeNav());

    await nav.openFromGrid(meta('b'));
    expect(sectionLightbox.open).toHaveBeenCalledWith(1);
    expect(timeline.openLightbox).not.toHaveBeenCalled();
    expect(nav.position.value).toBe(7);

    await nav.handleLightboxNavigate('next');
    expect(sectionLightbox.handleLightboxNavigate).toHaveBeenCalledWith('next');
  });

  it('pages by day when the grid is grouped by day', async () => {
    const timeline = { ...fakeNav(), openLightbox: vi.fn(async () => {}) };
    const grid = {
      sectioned: ref(false),
      sectionItems: ref([]),
      sectionLightbox: fakeNav(),
      lightbox: timeline,
      groups: ref([]),
    } as unknown as GalleryGridApi;
    await useGalleryLightbox(grid, fakeNav()).openFromGrid(meta('b'));
    expect(timeline.openLightbox).toHaveBeenCalledWith(meta('b'));
  });
});
