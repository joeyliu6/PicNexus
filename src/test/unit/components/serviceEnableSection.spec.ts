import { describe, expect, it, vi } from 'vitest';
import { mountWithDefaults } from '../../helpers/vueMount';

// 组件内用 useToast 做"至少保留一个图床"拦截提示；单测无 PrimeVue ToastService 上下文，
// 直接 mock 成 no-op 避免 mount 时抛 "No PrimeVue Toast provided"
vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(),
    show: vi.fn(), clear: vi.fn(),
    showConfig: vi.fn(),
  }),
}));

import ServiceEnableSection from '../../../components/settings/hosting/ServiceEnableSection.vue';

const tooltipDirective = {
  mounted: () => {},
};

describe('ServiceEnableSection', () => {
  it('活跃 session 期间顶部统计统一进入骨架态（包含 unconfigured）', () => {
    const wrapper = mountWithDefaults(ServiceEnableSection, {
      props: {
        healthStatusMap: {
          weibo: 'verified',
          qiyu: 'error',
          jd: 'verified',
          smms: 'pending',
          imgur: 'unconfigured',
        },
        healthTooltipMap: {
          weibo: '可用',
          qiyu: '异常',
          jd: '可用',
          smms: '待验证',
          imgur: '未配置',
        },
        isBatchTesting: false,
        batchTestProgress: null,
        batchTestCompletionKey: 0,
        serviceCheckSession: {
          mode: 'batch',
          startedAt: Date.now(),
          targetIds: ['weibo', 'qiyu'],
          refreshingIds: ['qiyu'],
          runningIds: ['qiyu'],
          completedIds: ['weibo'],
          baselineStatuses: {
            weibo: 'verified',
            qiyu: 'error',
          },
          resultStatuses: {
            weibo: 'verified',
          },
          summarySkeletonStatuses: ['verified', 'error', 'pending', 'unconfigured'],
          summarySnapshot: {
            verified: '2 个正常',
            error: '1 个异常',
            pending: '1 个未检测',
            unconfigured: '1 个未配置',
            counts: { verified: 2, error: 1, pending: 1, unconfigured: 1 },
          },
        },
        refreshingServiceIds: new Set(['qiyu']),
        testingConnections: {},
        isCheckingJd: false,
        isCheckingQiyu: false,
        availableServices: ['weibo', 'qiyu', 'jd', 'smms'],
        serviceNames: {
          weibo: '微博',
          qiyu: '七鱼',
          jd: '京东',
          smms: 'SM.MS',
          imgur: 'Imgur',
        },
      },
      global: {
        directives: {
          tooltip: tooltipDirective,
        },
        stubs: {
          ServiceChipGrid: {
            template: '<div class="chip-grid-stub" />',
          },
        },
      },
    });

    expect(wrapper.text()).toContain('1 个未配置');
    expect(wrapper.findAll('.health-pill--refreshing')).toHaveLength(4);
    expect(wrapper.findAll('.health-pill.verified')).toHaveLength(0);
    expect(wrapper.findAll('.health-pill.error')).toHaveLength(0);
    expect(wrapper.findAll('.health-pill.pending')).toHaveLength(0);
  });
});
