import { describe, expect, it } from 'vitest';
import { mountWithDefaults } from '../../helpers/vueMount';
import ServiceChipGrid from '../../../components/settings/ServiceChipGrid.vue';

const tooltipDirective = {
  mounted: () => {},
};

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
      global: {
        directives: {
          tooltip: tooltipDirective,
        },
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
});
