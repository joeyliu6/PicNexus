import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mountWithDefaults } from '../helpers/vueMount';
import ChannelCard from '@/components/upload/ChannelCard.vue';

vi.mock('@vueuse/core', () => ({
  onClickOutside: vi.fn(),
}));

const configRef = ref({
  linkOutput: {
    customTemplate: '{url}',
  },
});

vi.mock('@/composables/useConfig', () => ({
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

  it('短图床名卡片上已完整显示，不挂重复的 tooltip', () => {
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

    expect(wrapper.get('.channel-name').attributes('data-tooltip')).toBeUndefined();
  });

  it('放不下的长图床名挂全名 tooltip', () => {
    const wrapper = mountWithDefaults(ChannelCard, {
      props: {
        service: 'webdav:msvhpjb373uf1iqfc',
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

    // 查不到 profile 时退化成 `WebDAV (原始ID)`，26 个 ASCII 字符 ≈ 156px，超过 96px 上限
    expect(wrapper.get('.channel-name').attributes('data-tooltip')).toBe('WebDAV (msvhpjb373uf1iqfc)');
  });

  it('失败态不在图床名上重复挂 tooltip，让位给根节点的失败气泡', () => {
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

    expect(wrapper.get('.channel-name').attributes('data-tooltip')).toBeUndefined();
    expect(wrapper.attributes('data-tooltip')).toBe('又拍云上传失败。点击右侧重试。');
  });

  it('私有存储复合 ID 渲染通用图标而不是首字母', () => {
    const wrapper = mountWithDefaults(ChannelCard, {
      props: {
        service: 'webdav:abc123',
        status: '⏳ 等待中',
        fileName: 'a.jpg',
      },
    });

    const logo = wrapper.get('.channel-icon');
    expect(logo.classes()).toContain('pi-server');
    expect(logo.text()).toBe('');
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
