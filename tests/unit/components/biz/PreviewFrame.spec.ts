import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { mountWithDefaults } from '../../helpers/vueMount';

vi.mock('@/composables/image/useThumbCache', () => ({ reportThumbnailUrlFailed: vi.fn(), reportThumbnailUrlLoaded: vi.fn() }));
// 详情里的预览框 300 × 188
vi.mock('@vueuse/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vueuse/core')>()),
  useElementSize: () => ({ width: ref(300), height: ref(188) }),
}));

const { default: PreviewFrame } = await import('@/components/biz/PreviewFrame.vue');

const mounted: VueWrapper[] = [];

function mountFrame(props: Record<string, unknown>) {
  const wrapper = mountWithDefaults(PreviewFrame, { props: { srcs: ['https://jd.example/a.png'], name: 'a.png', ratio: 1.5, ...props } });
  mounted.push(wrapper);
  return wrapper;
}

const boxOf = (wrapper: VueWrapper) => wrapper.find('.preview-frame__image').attributes('style');

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

// ImageRatios.dc.html「预览框」：框的尺寸固定，图片完整显示不裁切，空白处用图片自身的模糊放大版填充
describe('PreviewFrame', () => {
  it('shows a portrait picture whole inside the frame', () => {
    expect(boxOf(mountFrame({ ratio: 0.75, naturalWidth: 1080 }))).toContain('width: 141px; height: 188px');
    expect(boxOf(mountFrame({ ratio: 1200 / 630 }))).toContain('width: 300px; height: 158px');
  });

  it('never enlarges a picture beyond its own size', () => {
    expect(boxOf(mountFrame({ ratio: 1, naturalWidth: 48 }))).toContain('width: 48px; height: 48px');
  });

  it('fills the empty space with a blurred copy of the picture it shows', async () => {
    const wrapper = mountFrame({ ratio: 0.75 });
    expect(wrapper.find('.preview-frame__fill').exists()).toBe(false);

    const shown = wrapper.find('.thumbnail-img');
    await shown.trigger('load');
    expect(wrapper.find('.preview-frame__fill').attributes('src')).toBe(shown.attributes('src'));
  });

  it('lays a checkerboard under formats that can be transparent', () => {
    const hasChecker = (props: Record<string, unknown>) => mountFrame(props).find('.preview-frame__image').classes().includes('preview-frame__image--checker');
    expect(hasChecker({ name: 'logo.png' })).toBe(true);
    expect(hasChecker({ name: '合影.jpg' })).toBe(false);
    expect(hasChecker({ name: '合影.jpg', format: 'webp' })).toBe(true);
  });
});
