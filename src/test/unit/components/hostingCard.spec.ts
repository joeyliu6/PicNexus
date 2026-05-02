import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithDefaults } from '../../helpers/vueMount';
import HostingCard from '../../../components/settings/HostingCard.vue';

const ButtonStub = {
  props: ['label', 'disabled', 'loading'],
  template: '<button class="button-stub" :disabled="disabled">{{ label }}</button>',
};

const tooltipDirective = {
  mounted: () => {},
};

describe('HostingCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'visible' }));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('内建图床刷新时保留真实状态条 DOM，并禁用检测按钮', () => {
    const wrapper = mountWithDefaults(HostingCard, {
      props: {
        id: 'qiyu',
        name: '七鱼',
        description: '网易七鱼客服系统存储',
        isConfigured: true,
        isBuiltin: true,
        isAvailable: false,
        isRefreshing: true,
        showTestButton: false,
      },
      slots: {
        default: '<div class="slot-content">body</div>',
      },
      global: {
        stubs: {
          Button: ButtonStub,
        },
        directives: {
          tooltip: tooltipDirective,
        },
      },
    });

    wrapper.get('.card-header').trigger('click');

    expect(wrapper.find('.status-dot.refreshing').exists()).toBe(true);
    expect(wrapper.find('.builtin-status.refreshing').exists()).toBe(true);
    expect(wrapper.find('.status-icon').exists()).toBe(true);
    expect(wrapper.find('.status-text span').exists()).toBe(true);
    expect(wrapper.find('.builtin-status-skeleton-line').exists()).toBe(false);
    expect(wrapper.get('.button-stub').attributes('disabled')).toBeDefined();
  });

  it('forceExpand opens the card on mount', () => {
    const wrapper = mountWithDefaults(HostingCard, {
      props: {
        id: 'r2',
        name: 'R2',
        description: 'Cloudflare R2',
        isConfigured: true,
        forceExpand: true,
      },
      slots: {
        default: '<div class="slot-content">body</div>',
      },
      global: {
        stubs: {
          Button: ButtonStub,
        },
        directives: {
          tooltip: tooltipDirective,
        },
      },
    });

    expect(wrapper.get('.hosting-card').classes()).toContain('expanded');
  });
});
