import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import type { ImageMeta } from '@/types/image-meta';
import { mountWithDefaults } from '../../helpers/vueMount';

vi.mock('@/composables/image/useThumbCache', () => ({ reportThumbnailUrlFailed: vi.fn(), reportThumbnailUrlLoaded: vi.fn() }));

const { default: GalleryTile } = await import('@/views/gallery/GalleryTile.vue');

function meta(name: string, width: number, height: number, extra: Partial<ImageMeta> = {}): ImageMeta {
  return {
    id: name,
    timestamp: 0,
    localFileName: name,
    aspectRatio: width / height,
    width,
    height,
    primaryService: 'jd',
    primaryUrl: `https://jd.example/${name}`,
    copyLinkHealth: 'ok',
    mirrorServices: [{ serviceId: 'jd', url: `https://jd.example/${name}` }, { serviceId: 'r2', url: `https://r2.example/${name}` }],
    ...extra,
  };
}

const mounted: VueWrapper[] = [];

/** 一格 150 高（行高），宽按格子的比例给 */
function mountTile(image: ImageMeta, cell: { width: number; height: number } = { width: 150, height: 150 }) {
  const wrapper = mountWithDefaults(GalleryTile, {
    props: {
      meta: image, x: 0, y: 0, ...cell,
      selected: false, favorited: false, selecting: false, focused: false, copied: false,
      loaded: false, failed: false, displayMode: 'normal', thumbnailUrls: [image.primaryUrl],
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

/** 图片载入（格子由图库标成「已加载」） */
async function load(wrapper: VueWrapper, natural = { width: 480, height: 360 }) {
  const img = wrapper.find('img');
  Object.defineProperty(img.element, 'naturalWidth', { value: natural.width, configurable: true });
  Object.defineProperty(img.element, 'naturalHeight', { value: natural.height, configurable: true });
  await img.trigger('load');
  await wrapper.setProps({ loaded: true });
}

const tags = (wrapper: VueWrapper) => wrapper.findAll('.tile__tag').map((tag) => tag.text());
/** v-show 收起时是行内 display: none（组件没挂到页面上，isVisible 看不出来） */
const shown = (el: ReturnType<VueWrapper['find']>) => !(el.attributes('style') ?? '').includes('display: none');

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

// ImageRatios.dc.html（G13）：只有极端比例才裁切，并用角标说明
describe('GalleryTile picture-ratio rules', () => {
  it('shows a long screenshot from the top, fading out, marked 长图', async () => {
    const wrapper = mountTile(meta('长截图.png', 1080, 6048), { width: 60, height: 150 });
    await load(wrapper);

    expect(wrapper.classes()).toContain('tile--long');
    expect(wrapper.find('.tile__fade').exists()).toBe(true);
    expect(tags(wrapper)).toEqual(['长图']);
  });

  it('marks a panorama with its real ratio', async () => {
    const wrapper = mountTile(meta('全景.jpg', 6000, 1000), { width: 600, height: 150 });
    await load(wrapper);

    expect(tags(wrapper)).toEqual(['全景 6:1']);
  });

  it('keeps a small icon at its own size in a square cell, size noted', async () => {
    const wrapper = mountTile(meta('icon.png', 48, 48));
    await load(wrapper, { width: 48, height: 48 });

    expect(wrapper.classes()).toContain('tile--small');
    expect(wrapper.find('img').attributes('style')).toContain('width: 48px; height: 48px');
    expect(tags(wrapper)).toEqual(['48 × 48']);
  });

  it('shrinks a small picture that is taller than its cell, never enlarging it', async () => {
    const wrapper = mountTile(meta('窄条.png', 110, 300));
    await load(wrapper);

    expect(wrapper.find('img').attributes('style')).toContain('width: 55px; height: 150px');
  });

  // 健康角标与「长图」同在左下角、与原尺寸可能挤在一起：出问题的角标优先
  it('gives way to the health badge where they would collide', async () => {
    const long = mountTile(meta('长截图.png', 1080, 6048, { copyLinkHealth: 'dead' }), { width: 60, height: 150 });
    const icon = mountTile(meta('icon.png', 48, 48, { copyLinkHealth: 'dead' }));
    const pano = mountTile(meta('全景.jpg', 6000, 1000, { copyLinkHealth: 'dead' }), { width: 600, height: 150 });
    await Promise.all([load(long), load(icon, { width: 48, height: 48 }), load(pano)]);

    expect(tags(long)).toEqual([]);
    expect(tags(icon)).toEqual([]);
    expect(tags(pano)).toEqual(['全景 6:1']);
    expect(long.find('.tile__badge').text()).toBe('失效');
  });

  it('lays a checkerboard only under formats that can be transparent', async () => {
    const png = mountTile(meta('logo.png', 800, 800));
    const jpg = mountTile(meta('合影.jpg', 4000, 3000));
    await Promise.all([load(png), load(jpg)]);

    expect(png.find('img').classes()).toContain('tile__img--checker');
    expect(jpg.find('img').classes()).not.toContain('tile__img--checker');
  });

  it('hides the marks until the picture shows and while the hover buttons cover the corners', async () => {
    const wrapper = mountTile(meta('全景.jpg', 6000, 1000), { width: 600, height: 150 });
    expect(tags(wrapper)).toEqual([]);

    await load(wrapper);
    await wrapper.trigger('mouseenter');
    expect(tags(wrapper)).toEqual([]);

    await wrapper.trigger('mouseleave');
    await wrapper.setProps({ copied: true });
    expect(tags(wrapper)).toEqual([]);
  });
});

describe('GalleryTile animated GIF', () => {
  const drawImage = vi.fn();

  beforeEach(() => {
    drawImage.mockReset();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage }) as never);
  });

  afterEach(() => vi.restoreAllMocks());

  it('holds the first frame, marked GIF, and plays only while hovered', async () => {
    const wrapper = mountTile(meta('表情.gif', 480, 360));
    await load(wrapper);

    expect(drawImage).toHaveBeenCalledOnce();
    expect(wrapper.find('img').classes()).toContain('tile__img--still');
    expect(shown(wrapper.find('canvas'))).toBe(true);
    expect(tags(wrapper)).toEqual(['GIF']);

    await wrapper.trigger('mouseenter');
    expect(wrapper.find('img').classes()).not.toContain('tile__img--still');
    expect(shown(wrapper.find('canvas'))).toBe(false);
  });

  it('plays as usual when the first frame cannot be drawn', async () => {
    drawImage.mockImplementation(() => { throw new Error('broken'); });
    const wrapper = mountTile(meta('表情.gif', 480, 360));
    await load(wrapper);

    expect(wrapper.find('img').classes()).not.toContain('tile__img--still');
  });

  it('leaves the GIF corner to the selection circle while selecting', async () => {
    const wrapper = mountTile(meta('表情.gif', 480, 360));
    await load(wrapper);
    await wrapper.setProps({ selecting: true });

    expect(tags(wrapper)).toEqual([]);
  });
});
