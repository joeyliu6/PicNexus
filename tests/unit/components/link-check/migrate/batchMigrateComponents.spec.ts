import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref, type Component } from 'vue';
import type { MenuItem } from 'primevue/menuitem';
import { mountWithDefaults } from '../../../helpers/vueMount';
import { getEmitMock, getInvokeMock } from '../../../helpers/tauriMock';
import TargetCard from '@/components/views/link-check/migrate/components/TargetCard.vue';
import MigrateOptions from '@/components/views/link-check/migrate/components/MigrateOptions.vue';
import MigrateItemRow from '@/components/views/link-check/migrate/components/MigrateItemRow.vue';
import MigrateSelectPhase from '@/components/views/link-check/migrate/MigrateSelectPhase.vue';
import MigrateProgressPhase from '@/components/views/link-check/migrate/MigrateProgressPhase.vue';
import { MIGRATE_KEY, type MigrateContext } from '@/components/views/link-check/migrate/keys';
import type { MigrateItemStatus, MigrateResult, MigrateTargetService } from '@/types/batchMigrate';
import { flushPromisesAndTicks } from '../../../helpers/wait';

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    silent: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock('@/composables/useConfig', async () => {
  const { ref: vueRef } = await import('vue');
  return {
    useConfigManager: () => ({
      config: vueRef({
        linkOutput: { defaultFormat: 'url', customTemplate: '', autoCopy: false },
      }),
    }),
  };
});

vi.mock('@/services/database', () => ({
  historyDB: {
    getItemsByIds: vi.fn().mockResolvedValue([]),
  },
}));

/** 弹出菜单：只留下 model，测试直接调菜单项的 command */
const MenuStub = {
  props: ['model'],
  template: '<div class="menu-stub" />',
  methods: {
    toggle: vi.fn(),
  },
};

function createStatus(overrides: Partial<MigrateItemStatus> = {}): MigrateItemStatus {
  const historyId = overrides.historyId ?? 'hist-1';
  return {
    historyId,
    fileName: overrides.fileName ?? `${historyId}.jpg`,
    sourceUrl: overrides.sourceUrl ?? `https://img.example.com/${historyId}.jpg`,
    status: overrides.status ?? 'success',
    skipReason: overrides.skipReason,
    error: overrides.error,
    errorType: overrides.errorType,
    failureDetails: overrides.failureDetails,
    convertedFormat: overrides.convertedFormat,
    serviceResults: overrides.serviceResults ?? { github: 'success' },
    existingServiceIds: overrides.existingServiceIds ?? ['jd'],
  };
}

function createMigrateResult(itemsSnapshot: MigrateItemStatus[]): MigrateResult {
  const failures = itemsSnapshot
    .filter(item => item.status === 'failed')
    .map(item => ({
      historyId: item.historyId,
      fileName: item.fileName,
      error: item.error ?? 'upload failed',
      errorType: item.errorType ?? 'upload',
      details: item.failureDetails ?? [{ serviceId: 'github', message: 'upload failed' }],
    }));

  return {
    successCount: itemsSnapshot.filter(item => item.status === 'success').length,
    failedCount: failures.length,
    skippedCount: itemsSnapshot.filter(item => item.status === 'skipped').length,
    failures,
    partialFailures: [],
    durationMs: 1200,
    avgBytesPerSec: 2048,
    targetServiceIds: ['github', 'smms'],
    itemsSnapshot,
  };
}

function createMigrateContext(overrides: Partial<MigrateContext> = {}): MigrateContext {
  const targetServices = ref<MigrateTargetService[]>([
    { serviceId: 'github', displayName: 'GitHub', isConfigured: true, pendingCount: 2, backedUpCount: 1, checked: true },
    { serviceId: 'smms', displayName: 'SM.MS', isConfigured: true, pendingCount: 1, backedUpCount: 0, checked: false },
  ]);

  const ctx: MigrateContext = {
    phase: ref('done'),
    isInitialized: ref(true),
    isFilterApplied: ref(true),
    isRefiltering: ref(false),
    maxSuccessCount: ref(999),
    sourceServiceFilter: ref(['jd']),
    migrateScope: ref<MigrateScope>('all-backups'),
    availableSourceServices: ref([{ id: 'jd', displayName: 'JD', count: 3 }]),
    timestampAfterMs: ref(null),
    configuredServices: computed(() => targetServices.value.filter(service => service.isConfigured)),
    unconfiguredServices: computed(() => targetServices.value.filter(service => !service.isConfigured)),
    checkedTargets: computed(() => targetServices.value.filter(service => service.checked && service.isConfigured)),
    totalPending: computed(() => Math.max(0, ...targetServices.value.filter(service => service.checked).map(service => service.pendingCount))),
    isAllBackedUp: computed(() => targetServices.value.every(service => !service.isConfigured || service.pendingCount === 0)),
    itemStatuses: ref([]),
    allItemStatuses: ref([]),
    globalProgress: ref({ current: 0, total: 0, percent: 0 }),
    migrateResult: ref(null),
    cumulativeCounts: ref({ success: 0, failed: 0, skipped: 0 }),
    retryingIds: ref(new Set<string>()),
    estimatedTimeRemaining: computed(() => null),
    averageSpeed: computed(() => 0),
    concurrentCount: computed(() => 0),
    initError: ref(null),
    initConfiguring: vi.fn(),
    applyFilter: vi.fn(),
    startMigrate: vi.fn(),
    cancelMigrate: vi.fn(),
    pauseMigrate: vi.fn(),
    resumeMigrate: vi.fn(),
    isPaused: ref(false),
    isPausing: ref(false),
    isCancelling: ref(false),
    retryFailed: vi.fn(),
    retrySingleFailed: vi.fn(),
    resetToConfiguring: vi.fn(),
    migrateStats: ref({ startTime: 0, elapsedMs: 0, processedCount: 0, totalCount: 0, totalBytes: 0 }),
    healthStatusMap: ref({ github: 'verified', smms: 'pending' }),
    healthTooltipMap: ref({ github: 'ready', smms: 'pending' }),
  };

  return {
    ...ctx,
    ...overrides,
  };
}

function mountWithMigrateContext(component: Component, ctx: MigrateContext, options: any = {}) {
  const optionGlobal = options.global ?? {};
  return mountWithDefaults(component, {
    ...options,
    global: {
      ...optionGlobal,
      provide: {
        ...optionGlobal.provide,
        [MIGRATE_KEY as symbol]: ctx,
      },
      stubs: {
        Menu: MenuStub,
        ...optionGlobal.stubs,
      },
    },
  });
}

function selectContext(overrides: Partial<MigrateContext> = {}, targets?: MigrateTargetService[]) {
  const targetServices = ref<MigrateTargetService[]>(targets ?? [
    { serviceId: 'github', displayName: 'GitHub', isConfigured: true, pendingCount: 2, backedUpCount: 1, checked: true },
    { serviceId: 'smms', displayName: 'SM.MS', isConfigured: true, pendingCount: 1, backedUpCount: 0, checked: false },
  ]);
  return createMigrateContext({
    phase: ref('configuring'),
    configuredServices: computed(() => targetServices.value.filter(service => service.isConfigured)),
    unconfiguredServices: computed(() => targetServices.value.filter(service => !service.isConfigured)),
    checkedTargets: computed(() => targetServices.value.filter(service => service.checked && service.isConfigured)),
    totalPending: computed(() => Math.max(0, ...targetServices.value.filter(service => service.checked).map(service => service.pendingCount))),
    ...overrides,
  });
}

const menuModel = (wrapper: ReturnType<typeof mountWithDefaults>) =>
  wrapper.findComponent(MenuStub).props('model') as MenuItem[];

describe('补充备份 · 目标卡片', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('能用的目标可以勾选；连接异常的点不了，并说明去设置里检查', async () => {
    const healthy = mountWithDefaults(TargetCard, {
      props: { serviceId: 'github', displayName: 'GitHub', pendingCount: 3, backedUpCount: 0, checked: false, healthStatus: 'verified' },
    });
    const error = mountWithDefaults(TargetCard, {
      props: { serviceId: 'smms', displayName: 'SM.MS', pendingCount: 3, backedUpCount: 2, checked: false, healthStatus: 'error' },
    });

    await healthy.get('.target-card').trigger('click');
    await error.get('.target-card').trigger('click');

    expect(healthy.emitted('toggle')).toHaveLength(1);
    expect(error.emitted('toggle')).toBeUndefined();
    expect(error.get('.target-card').attributes('aria-disabled')).toBe('true');
    expect(healthy.get('.target-count-stack').text()).toBe('3张待备份');
    expect(error.get('.target-count-stack').text()).toBe('连接异常，先去设置里检查');
    expect(error.get('.target-card-tooltip-hitbox').attributes('data-tooltip')).toBe('图床异常，请先检查配置\n2 张已经存在这里，不用再补');
  });

  it('都已经存过的目标直接说「都已经存过了」', () => {
    const done = mountWithDefaults(TargetCard, {
      props: { serviceId: 'github', displayName: 'GitHub', pendingCount: 0, backedUpCount: 5, checked: false, healthStatus: 'verified' },
    });
    expect(done.get('.target-count-stack').text()).toContain('都已经存过了');
  });

  it('名字放不下时，悬停提示第一行给全名', () => {
    const longName = '我家里那台群晖 NAS 上的 WebDAV 图床';
    const wrapper = mountWithDefaults(TargetCard, {
      props: { serviceId: 'webdav:abc123', displayName: longName, pendingCount: 3, backedUpCount: 0, checked: false, healthStatus: 'verified' },
    });
    expect(wrapper.get('.target-card-tooltip-hitbox').attributes('data-tooltip')).toBe(longName);
  });
});

describe('补充备份 · 更多选项', () => {
  const base = {
    sources: [{ id: 'jd', displayName: '京东', count: 3 }, { id: 'weibo', displayName: '微博', count: 2 }],
    selectedSources: ['jd', 'weibo'],
    timestampAfterMs: null,
    maxSuccessCount: 999,
    scope: 'all-backups' as const,
    note: null,
  };

  it('默认收起，只露一句「可以做什么」；展开后能改来源、时间、份数、范围', async () => {
    const wrapper = mountWithDefaults(MigrateOptions, { props: base });
    expect(wrapper.find('.options-body').exists()).toBe(false);
    expect(wrapper.get('.options-hint').text()).toContain('只备份某些图床上的图');

    await wrapper.get('.options-toggle').trigger('click');
    const choices = () => wrapper.findAll('.choice');
    await choices().find(c => c.text().includes('京东'))!.trigger('click');
    await choices().find(c => c.text() === '最近 30 天')!.trigger('click');
    await choices().find(c => c.text() === '只有 1 份的')!.trigger('click');
    await choices().find(c => c.text() === '只补已经坏了一份的')!.trigger('click');

    expect(wrapper.emitted('update:selectedSources')![0]).toEqual([['weibo']]);
    expect(wrapper.emitted('update:timestampAfterMs')![0][0]).toBeTypeOf('number');
    expect(wrapper.emitted('update:maxSuccessCount')![0]).toEqual([1]);
    expect(wrapper.emitted('update:scope')![0]).toEqual(['broken-with-valid-source']);
  });

  it('设过条件：标题写「已设：……」，并能一键恢复默认', async () => {
    const wrapper = mountWithDefaults(MigrateOptions, { props: { ...base, selectedSources: ['jd'], note: '来自京东' } });
    expect(wrapper.get('.options-note').text()).toBe('已设：来自京东');

    await wrapper.get('.options-toggle').trigger('click');
    await wrapper.get('.options-reset').trigger('click');

    expect(wrapper.emitted('update:selectedSources')!.at(-1)).toEqual([['jd', 'weibo']]);
    expect(wrapper.emitted('update:timestampAfterMs')!.at(-1)).toEqual([null]);
    expect(wrapper.emitted('update:maxSuccessCount')!.at(-1)).toEqual([999]);
    expect(wrapper.emitted('update:scope')!.at(-1)).toEqual(['all-backups']);
  });
});

describe('补充备份 · 选择页', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('没选目标：卡片说清这页做什么，「开始备份」灰着', () => {
    const ctx = selectContext({}, [
      { serviceId: 'github', displayName: 'GitHub', isConfigured: true, pendingCount: 2, backedUpCount: 1, checked: false },
    ]);
    const wrapper = mountWithMigrateContext(MigrateSelectPhase, ctx);

    expect(wrapper.get('.summary-title').text()).toBe('给图片多存一份');
    expect(wrapper.get('.summary-btn--primary').attributes('disabled')).toBeDefined();
  });

  it('选好目标：卡片直接说要复制几张到哪，点「开始备份」开始', async () => {
    const wrapper = mountWithMigrateContext(MigrateSelectPhase, selectContext());

    expect(wrapper.get('.summary-title').text()).toBe('把 2 张图复制到 GitHub');
    expect(wrapper.get('.summary-subtitle').text()).toContain('原来的图片不动');
    await wrapper.get('.summary-btn--primary').trigger('click');
    expect(wrapper.emitted('start')).toHaveLength(1);
  });

  it('只选了部分来源：卡片上写出只备份哪些，免得忘了自己设过', () => {
    const ctx = selectContext({
      sourceServiceFilter: ref(['jd']),
      availableSourceServices: ref([{ id: 'jd', displayName: '京东', count: 3 }, { id: 'weibo', displayName: '微博', count: 2 }]),
    });
    const wrapper = mountWithMigrateContext(MigrateSelectPhase, ctx);
    expect(wrapper.get('.summary-subtitle').text()).toContain('只备份来自京东');
    expect(wrapper.get('.options-note').text()).toBe('已设：来自京东');
  });

  it('来源全取消了：按钮灰着，说清去哪改', () => {
    const wrapper = mountWithMigrateContext(MigrateSelectPhase, selectContext({ sourceServiceFilter: ref([]) }));
    expect(wrapper.get('.summary-title').text()).toBe('没选来源图床');
    expect(wrapper.get('.summary-btn--primary').attributes('disabled')).toBeDefined();
  });

  it('都已经存过了：不给开始按钮', () => {
    const ctx = selectContext({}, [
      { serviceId: 'github', displayName: 'GitHub', isConfigured: true, pendingCount: 0, backedUpCount: 3, checked: true },
    ]);
    const wrapper = mountWithMigrateContext(MigrateSelectPhase, ctx);
    expect(wrapper.get('.summary-title').text()).toBe('这些图片都已经存到 GitHub 了');
    expect(wrapper.find('.summary-btn--primary').exists()).toBe(false);
  });

  it('一个图床都没配：大号卡片引导去设置', async () => {
    const wrapper = mountWithMigrateContext(MigrateSelectPhase, selectContext({}, []));
    expect(wrapper.get('.summary-title').text()).toBe('先配置一个图床');
    await wrapper.get('.summary-btn--primary').trigger('click');
    expect(getEmitMock()).toHaveBeenCalledWith('navigate-to', { view: 'settings', tab: 'hosting' });
  });
});

describe('补充备份 · 进行中 / 完成', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const doneItems = () => [
    createStatus({ historyId: 'h-success', fileName: 'success-alpha.jpg', status: 'success', existingServiceIds: ['jd'] }),
    createStatus({
      historyId: 'h-failed',
      fileName: 'failed-beta.jpg',
      status: 'failed',
      error: 'GitHub · bad token',
      errorType: 'upload',
      serviceResults: { github: 'failed', smms: 'pending' },
      existingServiceIds: ['jd'],
    }),
    createStatus({ historyId: 'h-skipped', fileName: 'skipped-gamma.jpg', status: 'skipped', skipReason: 'already-there', existingServiceIds: ['github'] }),
  ];

  it('完成且有失败：直接列失败的，主按钮重试全部失败的，行上也能单独重试', async () => {
    const retryFailed = vi.fn();
    const retrySingleFailed = vi.fn();
    const ctx = createMigrateContext({
      phase: ref('done'),
      migrateResult: ref(createMigrateResult(doneItems())),
      retryFailed,
      retrySingleFailed,
    });

    const wrapper = mountWithMigrateContext(MigrateProgressPhase, ctx);
    await flushPromisesAndTicks();

    expect(wrapper.get('.summary-title').text()).toBe('1 张已备份，1 张没成功');
    expect(wrapper.findAll('.mi-row')).toHaveLength(1);
    expect(wrapper.get('.mi-row__status-text').text()).toBe('没成功 · GitHub · bad token');

    await wrapper.get('.summary-btn--primary').trigger('click');
    expect(retryFailed).toHaveBeenCalledWith(['h-failed']);

    await wrapper.get('.mi-row__retry-btn').trigger('click');
    expect(retrySingleFailed).toHaveBeenCalledWith('h-failed');

    await wrapper.findAll('.view-option')[0].trigger('click');
    expect(wrapper.findAll('.mi-row')).toHaveLength(3);
    expect(wrapper.text()).toContain('目标图床上本来就有');
  });

  it('部分目标失败也算失败、能重试', async () => {
    const retrySingleFailed = vi.fn();
    const partial = createStatus({
      historyId: 'h-partial',
      fileName: 'partial-delta.jpg',
      status: 'success',
      error: 'GitHub · bad token',
      errorType: 'upload',
      failureDetails: [{ serviceId: 'github', message: 'bad token' }],
      serviceResults: { github: 'failed', smms: 'success' },
      existingServiceIds: ['jd'],
    });
    const result = createMigrateResult([partial]);
    result.failures = [{
      historyId: 'h-partial', fileName: 'partial-delta.jpg', error: 'GitHub · bad token', errorType: 'upload',
      details: [{ serviceId: 'github', message: 'bad token' }], isPartial: true, failedTargets: ['github'],
    }];
    const ctx = createMigrateContext({ phase: ref('done'), migrateResult: ref(result), retrySingleFailed });

    const wrapper = mountWithMigrateContext(MigrateProgressPhase, ctx);
    await flushPromisesAndTicks();

    expect(wrapper.text()).toContain('partial-delta.jpg');
    await wrapper.get('.mi-row__retry-btn').trigger('click');
    expect(retrySingleFailed).toHaveBeenCalledWith('h-partial');
  });

  it('完成后卡片「⋯」里能导出报告', async () => {
    getInvokeMock().mockResolvedValue('C:/tmp/backup.csv');
    const ctx = createMigrateContext({ phase: ref('done'), migrateResult: ref(createMigrateResult(doneItems())) });
    const wrapper = mountWithMigrateContext(MigrateProgressPhase, ctx);

    const exportCsv = menuModel(wrapper).find(item => item.label === '导出报告（CSV）')!;
    exportCsv.command?.({ originalEvent: new Event('click'), item: exportCsv });
    await flushPromisesAndTicks();

    expect(getInvokeMock()).toHaveBeenCalledWith('export_text_file', expect.objectContaining({
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    }));
    expect((getInvokeMock().mock.calls[0][1] as { content: string }).content).toContain('success-alpha.jpg');
  });

  it('全部成功：一句结论，「完成」回到选择页', async () => {
    const resetToConfiguring = vi.fn();
    const ctx = createMigrateContext({
      phase: ref('done'),
      migrateResult: ref(createMigrateResult([doneItems()[0]])),
      resetToConfiguring,
    });
    const wrapper = mountWithMigrateContext(MigrateProgressPhase, ctx);

    expect(wrapper.get('.summary-title').text()).toBe('已备份 1 张到 GitHub、SM.MS');
    await wrapper.get('.summary-btn--primary').trigger('click');
    expect(resetToConfiguring).toHaveBeenCalled();
  });

  it('进行中：卡片报进度，暂停 / 停止 / 继续都接到对应动作', async () => {
    const pauseMigrate = vi.fn();
    const cancelMigrate = vi.fn();
    const resumeMigrate = vi.fn();
    const isPaused = ref(false);
    const ctx = createMigrateContext({
      phase: ref('migrating'),
      allItemStatuses: ref([createStatus({ historyId: 'h1', status: 'uploading' })]),
      cumulativeCounts: ref({ success: 1, failed: 0, skipped: 0 }),
      globalProgress: ref({ current: 1, total: 3, percent: 33 }),
      pauseMigrate,
      cancelMigrate,
      resumeMigrate,
      isPaused,
    });
    const wrapper = mountWithMigrateContext(MigrateProgressPhase, ctx);

    expect(wrapper.get('.summary-title').text()).toBe('正在备份到 GitHub · 1 / 3');
    expect(wrapper.get('.mi-row__status-text').text()).toBe('上传中…');
    await wrapper.get('.summary-btn--primary').trigger('click');
    await wrapper.get('.summary-btn--ghost').trigger('click');
    expect(pauseMigrate).toHaveBeenCalled();
    expect(cancelMigrate).toHaveBeenCalled();

    isPaused.value = true;
    await flushPromisesAndTicks();
    await wrapper.get('.summary-btn--primary').trigger('click');
    expect(resumeMigrate).toHaveBeenCalled();
  });
});

describe('补充备份 · 一行一张图', () => {
  it('停止后没轮到的说「没来得及处理」，复制成功的说复制到了哪', () => {
    const late = mountWithDefaults(MigrateItemRow, {
      props: { item: { historyId: 'h1', fileName: 'late.jpg', status: 'skipped', skipReason: 'not-attempted', error: '备份已停止，没来得及处理' }, targetServiceIds: ['github'] },
    });
    expect(late.get('.mi-row__status-text').text()).toBe('备份已停止，没来得及处理');

    const copied = mountWithDefaults(MigrateItemRow, {
      props: { item: { historyId: 'h2', fileName: 'ok.jpg', status: 'success', serviceResults: { github: 'success' }, existingServiceIds: ['jd'] }, targetServiceIds: ['github'] },
    });
    expect(copied.get('.mi-row__status-text').text()).toBe('已复制到 GitHub');
  });
});
