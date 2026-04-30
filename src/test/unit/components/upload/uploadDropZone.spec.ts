import { defineComponent, h } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { mountWithDefaults } from '../../../helpers/vueMount';
import UploadDropZone from '../../../../components/views/upload/UploadDropZone.vue';
import type { CompressionPreset } from '../../../../config/types';

const presets: CompressionPreset[] = [
  {
    id: 'default',
    name: '默认',
    quality: 80,
    outputFormat: 'original',
    maxLongSide: 0,
    scalePercent: 100,
    skipIfSmallerKB: 2048,
    stripExif: true,
  },
  {
    id: 'webp-small',
    name: 'WebP 小图',
    quality: 70,
    outputFormat: 'webp',
    maxLongSide: 1600,
    scalePercent: 100,
    skipIfSmallerKB: 0,
    stripExif: true,
  },
];

const PopoverStub = defineComponent({
  name: 'Popover',
  setup(_, { expose, slots }) {
    expose({
      hide: vi.fn(),
      toggle: vi.fn(),
    });
    return () => h('div', { class: 'popover-stub' }, slots.default?.());
  },
});

function mountDropZone(props = {}) {
  return mountWithDefaults(UploadDropZone, {
    props: {
      isDragging: false,
      isPasting: false,
      isDownloading: false,
      compressionEnabled: false,
      activePreset: presets[0],
      presets,
      ...props,
    },
    global: {
      stubs: {
        Popover: PopoverStub,
      },
    },
  });
}

describe('UploadDropZone', () => {
  it('拖拽、点击、粘贴和 URL 下载入口都会 emit', async () => {
    const wrapper = mountDropZone();

    await wrapper.get('.drop-zone').trigger('click');
    await wrapper.get('.drop-zone').trigger('dragenter');
    await wrapper.get('.drop-zone').trigger('dragover');
    await wrapper.get('.drop-zone').trigger('dragleave');
    await wrapper.get('.drop-zone').trigger('drop');

    const actions = wrapper.findAll('.paste-link');
    await actions[0].trigger('click');
    await actions[1].trigger('click');

    expect(wrapper.emitted('click')).toHaveLength(1);
    expect(wrapper.emitted('drag-enter')).toHaveLength(1);
    expect(wrapper.emitted('drag-over')).toHaveLength(1);
    expect(wrapper.emitted('drag-leave')).toHaveLength(1);
    expect(wrapper.emitted('drop')).toHaveLength(1);
    expect(wrapper.emitted('paste')).toHaveLength(1);
    expect(wrapper.emitted('url-download')).toHaveLength(1);
  });

  it('拖拽和粘贴/下载 loading 状态有明确 UI 反馈', () => {
    const wrapper = mountDropZone({
      isDragging: true,
      isPasting: true,
      isDownloading: true,
    });

    expect(wrapper.get('.drop-zone').classes()).toContain('dragging');
    expect(wrapper.text()).toContain('正在粘贴...');
    expect(wrapper.text()).toContain('正在下载...');
    expect(wrapper.findAll('.paste-link').every(button => button.attributes('disabled') !== undefined)).toBe(true);
  });

  it('压缩 chip 使用 ripple 点击反馈', () => {
    const wrapper = mountDropZone();

    expect(wrapper.get('.compress-chip').attributes('data-ripple')).toBe('true');
  });

  it('压缩开关与预设选择会 emit 配置更新', async () => {
    const wrapper = mountDropZone({ compressionEnabled: false });

    await wrapper.get('.chip-main').trigger('click');
    await wrapper.findAll('.preset-popover-item')
      .find(item => item.text().includes('WebP 小图'))!
      .trigger('click');

    expect(wrapper.emitted('update:compressionEnabled')).toEqual([[true], [true]]);
    expect(wrapper.emitted('update:activePresetId')).toEqual([['webp-small']]);
  });

  it('压缩设置入口会 emit 跳转设置', async () => {
    const wrapper = mountDropZone();

    await wrapper.findAll('.preset-popover-item')
      .find(item => item.text().includes('压缩设置'))!
      .trigger('click');

    expect(wrapper.emitted('go-compression-settings')).toHaveLength(1);
  });
});
