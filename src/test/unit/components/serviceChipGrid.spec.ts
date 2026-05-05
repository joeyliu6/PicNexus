import { describe, expect, it } from 'vitest';
import { mountWithDefaults } from '../../helpers/vueMount';
import ServiceChipGrid from '../../../components/settings/ServiceChipGrid.vue';

describe('ServiceChipGrid', () => {
  it('keeps the real chip DOM while refreshing and removes stale health classes', () => {
    const wrapper = mountWithDefaults(ServiceChipGrid, {
      props: {
        services: ['weibo', 'jd'],
        groupTitle: 'Public Services',
        healthStatusMap: {
          weibo: 'verified',
          jd: 'error',
        },
        healthTooltipMap: {
          weibo: 'Available',
          jd: 'Error',
        },
        availableServices: ['weibo'],
        serviceNames: {
          weibo: 'Weibo',
          jd: 'JD',
        },
        isBatchTesting: true,
        refreshingServiceIds: new Set(['weibo']),
        batchTestedServices: new Set<string>(),
        batchDoneServices: new Set<string>(),
        activeFilter: null,
      },
    });

    const chips = wrapper.findAll('.toggle-chip');

    expect(chips[0].classes()).toContain('is-refreshing');
    expect(chips[0].classes()).not.toContain('verified');
    expect(chips[0].find('.toggle-label').exists()).toBe(true);
    expect(chips[0].find('.toggle-indicator').exists()).toBe(true);
    expect(chips[0].find('.toggle-skeleton-label').exists()).toBe(false);

    expect(chips[1].classes()).not.toContain('is-refreshing');
    expect(chips[1].classes()).toContain('error');
    expect(chips[1].text()).toContain('JD');
  });

  it('uses the sanitized health tooltip on error chips', () => {
    const wrapper = mountWithDefaults(ServiceChipGrid, {
      props: {
        services: ['weibo'],
        groupTitle: 'Public Services',
        healthStatusMap: {
          weibo: 'error',
        },
        healthTooltipMap: {
          weibo: 'Cookie 无效或已过期',
        },
        availableServices: ['weibo'],
        serviceNames: {
          weibo: 'Weibo',
        },
        isBatchTesting: false,
        refreshingServiceIds: new Set<string>(),
        batchTestedServices: new Set<string>(),
        batchDoneServices: new Set<string>(),
        activeFilter: null,
      },
    });

    expect(wrapper.get('.toggle-chip').attributes('data-tooltip')).toBe('Cookie 无效或已过期');
  });

  it('renders an info tooltip in the group header when provided', () => {
    const groupTooltip = '公共图床为非官方适配，使用风险由用户承担。';
    const wrapper = mountWithDefaults(ServiceChipGrid, {
      props: {
        services: ['jd'],
        groupTitle: '公共图床',
        groupTooltip,
        healthStatusMap: {
          jd: 'verified',
        },
        healthTooltipMap: {
          jd: '可用',
        },
        availableServices: ['jd'],
        serviceNames: {
          jd: '京东',
        },
        isBatchTesting: false,
        refreshingServiceIds: new Set<string>(),
        batchTestedServices: new Set<string>(),
        batchDoneServices: new Set<string>(),
        activeFilter: null,
      },
    });

    const icon = wrapper.get('.service-group-info');
    expect(icon.attributes('aria-label')).toBe('公共图床风险说明');
    expect(icon.attributes('data-tooltip')).toBe(groupTooltip);
    expect(icon.find('.pi-info-circle').exists()).toBe(true);
  });
});
