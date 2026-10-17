import { describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import type { HistoryItem, UserConfig } from '@/config/types';
import type { GalleryListRow } from '@/services/database/TimelineQueryService';
import { mountWithDefaults } from '../../helpers/vueMount';
import { createHistoryItem } from '../../factories/historyFactory';

const { warmImagesMock } = vi.hoisted(() => ({ warmImagesMock: vi.fn() }));
vi.mock('@/utils/imagePreload', () => ({ warmImages: warmImagesMock }));
vi.mock('@/utils/imageUrl', () => ({ getPrimaryImageUrl: (item: HistoryItem) => item.generatedLink }));
vi.mock('@/composables/image/useLightboxPreloader', () => ({ useLightboxPreloader: vi.fn() }));
vi.mock('@/utils/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const { useListLightbox } = await import('@/views/gallery/useListLightbox');

/** 按文件名排好的列表：b 在 a 前面，与上传时间无关 */
const NAMES = ['b.png', 'a.png', 'c.png'];

function mountListLightbox(links: Record<string, string> = {}) {
  const rows = NAMES.map((name) => ({ id: name, localFileName: name }) as GalleryListRow);
  const list = { ensure: vi.fn(async () => {}), rowAt: (i: number) => rows[i] ?? null };
  const detailCache = {
    getDetail: vi.fn(async (id: string) => createHistoryItem({ id, localFileName: id, generatedLink: links[id] ?? `https://jd.example/${id}` })),
  };
  let api!: ReturnType<typeof useListLightbox>;
  mountWithDefaults(defineComponent({
    setup() {
      api = useListLightbox({
        list,
        total: ref(rows.length),
        detailCache,
        config: ref({} as UserConfig),
        confirmedHttpHosts: () => undefined,
        toast: { error: vi.fn() },
      });
      return () => null;
    },
  }));
  return { api, list };
}

// 交接说明 8.2：灯箱 ← → 在「当前结果」里切换——列表按文件名排着，就按文件名的顺序翻
describe('useListLightbox', () => {
  it('opens the row it was given and pages in the order the list shows', async () => {
    const { api } = mountListLightbox();

    await api.open(1);
    expect(api.lightboxVisible.value).toBe(true);
    expect(api.lightboxItem.value?.id).toBe('a.png');
    expect(api.position.value).toBe(2);
    expect([api.lightboxHasPrev.value, api.lightboxHasNext.value]).toEqual([true, true]);

    await api.handleLightboxNavigate('prev');
    expect(api.lightboxItem.value?.id).toBe('b.png');
    expect(api.lightboxHasPrev.value).toBe(false);

    await api.handleLightboxNavigate('prev');
    expect(api.lightboxItem.value?.id).toBe('b.png');
  });

  it('reads the page of a row it has not fetched yet', async () => {
    const { api, list } = mountListLightbox();

    await api.open(2);
    expect(list.ensure).toHaveBeenCalledWith(2);
    expect(api.lightboxHasNext.value).toBe(false);
  });

  // 预热也是请求：与缩略图同一道闸
  it('warms images only through the safety gate', async () => {
    const { api } = mountListLightbox({ 'a.png': 'http://169.254.169.254/latest/a.png' });

    await api.open(1);
    expect(warmImagesMock.mock.calls.flat(2)).not.toContain('http://169.254.169.254/latest/a.png');
  });
});
