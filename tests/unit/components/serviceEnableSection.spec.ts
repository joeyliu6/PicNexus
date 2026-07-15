import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithDefaults } from '../helpers/vueMount';

const { showConfigMock, confirmMock } = vi.hoisted(() => ({
  showConfigMock: vi.fn(),
  confirmMock: vi.fn(),
}));

// 组件内用 useToast 做"至少保留一个图床"拦截提示；单测无 PrimeVue ToastService 上下文，
// 直接 mock 成 no-op 避免 mount 时抛 "No PrimeVue Toast provided"
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(),
    show: vi.fn(), clear: vi.fn(),
    showConfig: showConfigMock,
  }),
}));

vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({
    confirm: confirmMock,
  }),
}));

import ServiceEnableSection from '@/components/settings/hosting/ServiceEnableSection.vue';
import ServiceChipGrid from '@/components/settings/ServiceChipGrid.vue';

const tooltipDirective = {
  mounted: () => {},
};

const baseProps = {
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
  serviceCheckSession: null,
  refreshingServiceIds: new Set<string>(),
  testingConnections: {},
  isCheckingJd: false,
  isCheckingQiyu: false,
  availableServices: ['jd', 'weibo'],
  publicServiceRiskAccepted: true,
  serviceNames: {
    weibo: '微博',
    qiyu: '七鱼',
    jd: '京东',
    smms: 'SM.MS',
    imgur: 'Imgur',
  },
};

function mountSection(props = {}) {
  return mountWithDefaults(ServiceEnableSection, {
    props: {
      ...baseProps,
      ...props,
    },
    global: {
      directives: {
        tooltip: tooltipDirective,
      },
    },
  });
}

describe('ServiceEnableSection', () => {
  beforeEach(() => {
    showConfigMock.mockClear();
    confirmMock.mockClear();
    confirmMock.mockResolvedValue(true);
  });

  it('活跃 session 期间顶部统计统一进入骨架态（包含 unconfigured）', () => {
    const wrapper = mountWithDefaults(ServiceEnableSection, {
      props: {
        ...baseProps,
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
        availableServices: ['weibo', 'qiyu', 'jd', 'smms'],
        publicServiceRiskAccepted: true,
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

  it('启用/禁用图床会更新 availableServices 并触发保存', async () => {
    const wrapper = mountSection();

    await wrapper.get('[aria-label="启用 SM.MS"]').trigger('click');
    await wrapper.get('[aria-label="禁用 微博"]').trigger('click');

    expect(wrapper.emitted('update:availableServices')).toEqual([
      [['jd', 'weibo', 'smms']],
      [['jd']],
    ]);
    expect(wrapper.emitted('save')).toHaveLength(2);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('首次启用非官方公共图床前需要确认风险', async () => {
    const wrapper = mountSection({
      availableServices: ['r2'],
      publicServiceRiskAccepted: false,
    });

    await wrapper.get('[aria-label="启用 京东"]').trigger('click');

    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('非官方公共图床'),
      expect.objectContaining({ header: '公共图床风险确认' }),
    );
    expect(wrapper.emitted('accept-public-service-risk')).toHaveLength(1);
    expect(wrapper.emitted('update:availableServices')).toEqual([[['r2', 'jd']]]);
    expect(wrapper.emitted('save')).toHaveLength(1);
  });

  it('取消风险确认时不会启用非官方公共图床', async () => {
    confirmMock.mockResolvedValueOnce(false);
    const wrapper = mountSection({
      availableServices: ['r2'],
      publicServiceRiskAccepted: false,
    });

    await wrapper.get('[aria-label="启用 京东"]').trigger('click');

    expect(wrapper.emitted('accept-public-service-risk')).toBeUndefined();
    expect(wrapper.emitted('update:availableServices')).toBeUndefined();
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('禁止关闭最后一个已启用图床并展示错误提示', async () => {
    const wrapper = mountSection({ availableServices: ['jd'] });

    await wrapper.get('[aria-label="禁用 京东"]').trigger('click');

    expect(wrapper.emitted('update:availableServices')).toBeUndefined();
    expect(wrapper.emitted('save')).toBeUndefined();
    expect(showConfigMock).toHaveBeenCalledWith('warn', expect.objectContaining({
      summary: '至少保留一个图床',
    }));
  });

  it('健康错误筛选与批量检测按钮会 emit 对应动作', async () => {
    const wrapper = mountSection();

    await wrapper.findAll('.health-pill.error')[0].trigger('click');
    await wrapper.get('.health-refresh').trigger('click');
    await wrapper.setProps({ isBatchTesting: true });
    await wrapper.get('.health-refresh').trigger('click');

    expect(wrapper.find('.health-pill.error').classes()).toContain('active');
    expect(wrapper.emitted('testAll')).toHaveLength(1);
    expect(wrapper.emitted('cancelBatchTest')).toHaveLength(1);
  });

  it('renders custom S3 profiles inside the private storage group', () => {
    const customServiceId = 'custom_s3:archive';
    const wrapper = mountSection({
      customS3Profiles: [{
        id: 'archive',
        name: 'Archive S3',
        endpoint: '',
        accessKeyId: '',
        secretAccessKey: '',
        region: '',
        bucket: '',
        path: '',
        publicDomain: '',
      }],
      healthStatusMap: {
        ...baseProps.healthStatusMap,
        r2: 'pending',
        tencent: 'unconfigured',
        aliyun: 'unconfigured',
        qiniu: 'unconfigured',
        upyun: 'unconfigured',
        [customServiceId]: 'unconfigured',
      },
      healthTooltipMap: {
        ...baseProps.healthTooltipMap,
        r2: 'pending',
        tencent: null,
        aliyun: null,
        qiniu: null,
        upyun: null,
        [customServiceId]: null,
      },
      serviceNames: {
        ...baseProps.serviceNames,
        r2: 'Cloudflare R2',
        tencent: 'Tencent',
        aliyun: 'Aliyun',
        qiniu: 'Qiniu',
        upyun: 'Upyun',
      },
    });

    const grids = wrapper.findAllComponents(ServiceChipGrid);
    expect(grids).toHaveLength(2);
    expect(grids[0].props('groupTitle')).toBe('私有存储');
    expect(grids[0].props('services')).toEqual(['r2', 'tencent', 'aliyun', 'qiniu', 'upyun', customServiceId]);
    expect(grids[0].text()).toContain('Archive S3');
    expect(grids[1].props('groupTitle')).toBe('公共图床');
  });
});
