// 压缩预览：点「关闭」能退出（关闭键在右上角）；左原图、右压缩后两栏，缩放默认各管各的，打开「两侧同步」一起动
import { flushPromises, mount } from '@vue/test-utils';
import { TooltipProvider } from 'reka-ui';
import { defineComponent, h, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompressionPreset } from '@/config/types';

vi.mock('@/composables/image/useCompressionTask', () => ({
  useCompressionTask: () => ({
    status: ref('done'),
    fileName: ref('photo.png'),
    originalSrc: ref('asset://original.png'),
    compressedSrc: ref('asset://compressed.webp'),
    result: ref({ outputPath: 'x', originalSize: 2_000_000, compressedSize: 500_000, ratio: 0.25, width: 1600, height: 900, format: 'webp' }),
    errorMsg: ref(''),
    getSaved: () => 75,
    getIsLarger: () => false,
    selectAndCompress: vi.fn().mockResolvedValue(true),
  }),
}));

const { default: CompressionPreviewDialog } = await import('@/components/dialogs/CompressionPreviewDialog.vue');

const preset = { id: 'p', name: '默认', quality: 80, outputFormat: 'webp', maxLongSide: 0, scalePercent: 100, skipIfSmallerKB: 0, stripExif: true } as CompressionPreset;

function mountDialog() {
  const onVisible = vi.fn();
  const wrapper = mount(defineComponent({
    render: () => h(TooltipProvider, null, () => h(CompressionPreviewDialog, { visible: true, preset, 'onUpdate:visible': onVisible })),
  }), { attachTo: document.body });
  return { wrapper, onVisible };
}

const view = () => document.querySelector<HTMLElement>('.compress-view')!;
const pane = (key: string) => view().querySelector<HTMLElement>(`[data-pane="${key}"]`)!;

afterEach(() => { document.body.innerHTML = ''; });

describe('CompressionPreviewDialog', () => {
  it('点「关闭」退出；关闭键在顶栏最右', async () => {
    const { wrapper, onVisible } = mountDialog();
    await flushPromises();
    const top = view().querySelector('.compress-view__top')!;
    const close = top.lastElementChild as HTMLElement;
    expect(close.getAttribute('aria-label')).toBe('关闭');
    close.click();
    expect(onVisible).toHaveBeenLastCalledWith(false);
    wrapper.unmount();
  });

  it('左原图、右压缩后；滚轮只缩放鼠标所在的那一栏', async () => {
    const { wrapper } = mountDialog();
    await flushPromises();
    expect(pane('original').querySelector('img')!.getAttribute('src')).toBe('asset://original.png');
    expect(pane('compressed').querySelector('img')!.getAttribute('src')).toBe('asset://compressed.webp');

    pane('original').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    await flushPromises();
    expect(pane('original').querySelector('img')!.style.transform).toContain('scale(1.12)');
    expect(pane('compressed').querySelector('img')!.style.transform).toContain('scale(1)');
    expect(pane('original').textContent).toContain('112%');
    expect(pane('compressed').textContent).not.toContain('%');
    wrapper.unmount();
  });

  it('打开「两侧同步」：先把右栏对齐到左栏，之后滚哪一栏两栏一起动；关掉又各管各的', async () => {
    const { wrapper } = mountDialog();
    await flushPromises();
    const wheel = (key: string) => pane(key).dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    const transform = (key: string) => pane(key).querySelector('img')!.style.transform;

    wheel('original');
    await flushPromises();
    const sync = view().querySelector<HTMLButtonElement>('[role="switch"][aria-label="两侧同步"]')!;
    sync.click();
    await flushPromises();
    expect(sync.getAttribute('aria-checked')).toBe('true');
    expect(transform('compressed')).toBe(transform('original'));

    wheel('compressed');
    await flushPromises();
    expect(transform('original')).toMatch(/scale\(1\.24/);
    expect(transform('compressed')).toBe(transform('original'));

    sync.click();
    await flushPromises();
    wheel('original');
    await flushPromises();
    expect(transform('original')).toMatch(/scale\(1\.36/);
    expect(transform('compressed')).toMatch(/scale\(1\.24/);
    wrapper.unmount();
  });
});
