// 「最近上传」：点链接直接复制（原地「已复制」），点缩略图看大图（原图在前、缩略图垫后）
import { describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { DEFAULT_CONFIG, type HistoryItem } from '@/config/types';
import RecentList from '@/views/home/RecentList.vue';
import { mountWithDefaults } from '../../helpers/vueMount';

const item = {
  id: 'h1',
  timestamp: Date.now() - 60_000,
  localFileName: 'cat.png',
  primaryService: 'jd',
  width: 800,
  height: 600,
  fileSize: 1024,
  generatedLink: 'https://img.example/cat.png',
  results: [{ serviceId: 'jd', status: 'success', result: { url: 'https://img.example/cat.png' } }],
} as unknown as HistoryItem;

function mountList(copyHistory = vi.fn(async () => true)) {
  return {
    copyHistory,
    wrapper: mountWithDefaults(RecentList, {
      props: {
        sessions: [], itemsOf: () => [], older: [item], hosts: [], config: structuredClone(DEFAULT_CONFIG), format: 'url', busy: false,
        copySourceOf: () => undefined, copyItem: vi.fn(), copySession: vi.fn(), copyHistory,
      },
      global: { stubs: { ImageViewer: { name: 'ImageViewer', props: ['open', 'srcs', 'name', 'width', 'height'], template: '<div class="viewer-stub" :data-open="open" />' } } },
    }),
  };
}

describe('RecentList', () => {
  it('点第二行的链接：复制这一条，原地变「已复制」', async () => {
    const { wrapper, copyHistory } = mountList();
    const link = wrapper.get('.recent__link');
    expect(link.text()).toBe('https://img.example/cat.png');
    await link.trigger('click');
    await flushPromises();
    expect(copyHistory).toHaveBeenCalledWith(item);
    expect(wrapper.get('.recent__link').text()).toBe('已复制');
  });

  it('点缩略图：打开看大图，原图地址排第一，带上原图宽高', async () => {
    const { wrapper } = mountList();
    const viewer = () => wrapper.getComponent({ name: 'ImageViewer' });
    expect(viewer().props('open')).toBe(false);
    await wrapper.get('.recent-row__thumb--button').trigger('click');
    expect(viewer().props('open')).toBe(true);
    expect(viewer().props('srcs')[0]).toBe('https://img.example/cat.png');
    expect(viewer().props('width')).toBe(800);
    expect(viewer().props('name')).toBe('cat.png');
  });
});
