import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import ChannelCard from '../../../components/upload/ChannelCard.vue';

vi.mock('@vueuse/core', () => ({
  onClickOutside: vi.fn(),
}));

const configRef = ref({
  linkOutput: {
    customTemplate: '{url}',
  },
});

vi.mock('../../../composables/useConfig', () => ({
  useConfigManager: () => ({
    config: configRef,
  }),
}));

const tooltipDirective = {
  mounted(el: HTMLElement, binding: { value?: string | null }) {
    if (binding.value) {
      el.setAttribute('data-tooltip', binding.value);
    }
  },
  updated(el: HTMLElement, binding: { value?: string | null }) {
    if (binding.value) {
      el.setAttribute('data-tooltip', binding.value);
    } else {
      el.removeAttribute('data-tooltip');
    }
  },
};

describe('ChannelCard tooltip', () => {
  it('失败状态时只显示一套自定义 tooltip，且文案会去重', () => {
    const wrapper = mountWithDefaults(ChannelCard, {
      props: {
        service: 'upyun',
        status: '✗ 失败',
        error: 'upyun 上传失败: 又拍云上传失败: 上传失败: service error',
        fileName: 'a.jpg',
      },
      global: {
        directives: {
          tooltip: tooltipDirective,
        },
      },
    });

    expect(wrapper.attributes('title')).toBeUndefined();
    expect(wrapper.attributes('data-tooltip')).toBe('又拍云上传失败：service error。点击右侧重试。');
  });

  it('失败状态但无错误原因时显示兜底 tooltip 文案', () => {
    const wrapper = mountWithDefaults(ChannelCard, {
      props: {
        service: 'upyun',
        status: '✗ 失败',
        fileName: 'a.jpg',
      },
      global: {
        directives: {
          tooltip: tooltipDirective,
        },
      },
    });

    expect(wrapper.attributes('title')).toBeUndefined();
    expect(wrapper.attributes('data-tooltip')).toBe('又拍云上传失败。点击右侧重试。');
  });

  it('非失败状态不显示失败 tooltip', () => {
    const wrapper = mountWithDefaults(ChannelCard, {
      props: {
        service: 'weibo',
        status: '✓ 完成',
        link: 'https://example.com/a.jpg',
        fileName: 'a.jpg',
      },
      global: {
        directives: {
          tooltip: tooltipDirective,
        },
      },
    });

    expect(wrapper.attributes('title')).toBeUndefined();
    expect(wrapper.attributes('data-tooltip')).toBeUndefined();
  });

  it('复制成功态切换按钮图标、tooltip 和卡片 class', () => {
    const wrapper = mountWithDefaults(ChannelCard, {
      props: {
        service: 'weibo',
        status: '✓ 完成',
        link: 'https://example.com/a.jpg',
        fileName: 'a.jpg',
        copied: true,
      },
      global: {
        directives: {
          tooltip: tooltipDirective,
        },
      },
    });

    expect(wrapper.classes()).toContain('channel-card--copied');
    expect(wrapper.get('.copy-btn').classes()).toContain('copy-btn--copied');
    expect(wrapper.get('.copy-btn').attributes('data-tooltip')).toBe('已复制');
    expect(wrapper.get('.copy-btn i').classes()).toContain('pi-check');
  });

  it('点击普通复制和格式菜单会透传复制 payload', async () => {
    const wrapper = mountWithDefaults(ChannelCard, {
      props: {
        service: 'weibo',
        status: '✓ 完成',
        link: 'https://example.com/a.jpg',
        fileName: 'a.jpg',
      },
    });

    await wrapper.get('.copy-btn').trigger('click');
    expect(wrapper.emitted('copy')).toEqual([[
      {
        url: 'https://example.com/a.jpg',
        serviceId: 'weibo',
        fileName: 'a.jpg',
        format: undefined,
      },
    ]]);

    await wrapper.get('.copy-menu-btn').trigger('click');
    await wrapper.get('.format-item:nth-child(3)').trigger('click');

    expect(wrapper.emitted('copy')).toEqual([
      [{
        url: 'https://example.com/a.jpg',
        serviceId: 'weibo',
        fileName: 'a.jpg',
        format: undefined,
      }],
      [{
        url: 'https://example.com/a.jpg',
        serviceId: 'weibo',
        fileName: 'a.jpg',
        format: 'html',
      }],
    ]);
  });
});
