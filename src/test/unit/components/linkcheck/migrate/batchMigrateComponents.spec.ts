import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref, type Component } from 'vue';
import { mountWithDefaults } from '../../../../helpers/vueMount';
import { getDialogSaveMock, getFsMocks } from '../../../../helpers/tauriMock';
import SourceList from '../../../../../components/views/linkcheck/migrate/components/SourceList.vue';
import TargetCard from '../../../../../components/views/linkcheck/migrate/components/TargetCard.vue';
import MigrateFilterBar from '../../../../../components/views/linkcheck/migrate/components/MigrateFilterBar.vue';
import MigrateBottomBar from '../../../../../components/views/linkcheck/migrate/components/MigrateBottomBar.vue';
import MigrateFilterPopover from '../../../../../components/views/linkcheck/migrate/components/MigrateFilterPopover.vue';
import MigrateSelectPhase from '../../../../../components/views/linkcheck/migrate/MigrateSelectPhase.vue';
import MigrateProgressPhase from '../../../../../components/views/linkcheck/migrate/MigrateProgressPhase.vue';
import { MIGRATE_KEY, type MigrateContext } from '../../../../../components/views/linkcheck/migrate/keys';
import type { MigrateItemStatus, MigrateResult, MigrateScope, MigrateTargetService } from '../../../../../types/batchMigrate';
import { flushPromisesAndTicks } from '../../../../helpers/wait';

vi.mock('../../../../../composables/useToast', () => ({
  useToast: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    silent: vi.fn(),
  }),
}));

vi.mock('../../../../../composables/useConfig', async () => {
  const { ref: vueRef } = await import('vue');
  return {
    useConfigManager: () => ({
      config: vueRef({
        linkOutput: { defaultFormat: 'url', customTemplate: '', autoCopy: false },
      }),
    }),
  };
});

vi.mock('../../../../../services/database', () => ({
  historyDB: {
    getItemsByIds: vi.fn().mockResolvedValue([]),
  },
}));

const CheckboxStub = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: `
    <input
      class="checkbox-stub"
      type="checkbox"
      :checked="modelValue"
      @click.stop
      @change="$emit('update:modelValue', $event.target.checked)"
    />
  `,
};

const MenuStub = {
  template: '<div class="menu-stub" />',
  methods: {
    toggle: vi.fn(),
  },
};

const PopoverStub = {
  template: '<div class="popover-stub"><slot /></div>',
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
        Checkbox: CheckboxStub,
        Menu: MenuStub,
        ...optionGlobal.stubs,
      },
    },
  });
}

describe('batch migrate P1 components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SourceList emits single and bulk source selection changes', async () => {
    const wrapper = mountWithDefaults(SourceList, {
      props: {
        sources: [
          { id: 'jd', displayName: 'JD', count: 10 },
          { id: 'github', displayName: 'GitHub', count: 4 },
        ],
        selectedIds: ['jd'],
      },
      global: {
        stubs: {
          Checkbox: CheckboxStub,
          InlineEmptyState: { template: '<div class="inline-empty-stub" />' },
        },
      },
    });

    expect(wrapper.findAll('.source-row')[0].classes()).toContain('source-row--selected');

    await wrapper.findAll('.source-row')[1].trigger('click');
    await wrapper.get('.toggle-all-btn').trigger('click');

    expect(wrapper.emitted('toggle')).toEqual([['github']]);
    expect(wrapper.emitted('toggleAll')).toEqual([[true]]);
  });

  it('TargetCard toggles healthy targets and blocks error targets', async () => {
    const healthy = mountWithDefaults(TargetCard, {
      props: {
        serviceId: 'github',
        displayName: 'GitHub',
        pendingCount: 3,
        backedUpCount: 0,
        checked: false,
        healthStatus: 'verified',
      },
    });
    const error = mountWithDefaults(TargetCard, {
      props: {
        serviceId: 'smms',
        displayName: 'SM.MS',
        pendingCount: 3,
        backedUpCount: 2,
        checked: false,
        healthStatus: 'error',
      },
    });

    await healthy.get('.target-card').trigger('click');
    await error.get('.target-card').trigger('click');

    expect(healthy.emitted('toggle')).toHaveLength(1);
    expect(error.emitted('toggle')).toBeUndefined();
    expect(error.get('.target-card').attributes('aria-disabled')).toBe('true');
    expect(healthy.get('.target-count-stack').text()).toBe('3张待迁移，0张已备份');
    expect(healthy.text()).not.toContain('无需备份');
  });

  it('MigrateFilterPopover emits recovery scope and shows active badge', async () => {
    const wrapper = mountWithDefaults(MigrateFilterPopover, {
      props: {
        maxSuccessCount: 999,
        timestampAfterMs: null,
        migrateScope: 'all-backups',
      },
      global: {
        stubs: {
          Popover: PopoverStub,
        },
      },
    });

    const allScopeButton = wrapper.findAll('button').find(button => button.text() === '所有缺失备份');
    const recoveryButton = wrapper.findAll('button').find(button => button.text() === '可恢复图片');
    expect(wrapper.text()).toContain('处理范围');
    expect(allScopeButton?.attributes('data-tooltip')).toBe('为符合条件、但目标图床还没有备份的图片补传一份。');
    expect(recoveryButton).toBeTruthy();
    expect(recoveryButton?.attributes('data-tooltip')).toContain('依据最近一次已保存的链接检测结果');
    await recoveryButton!.trigger('click');

    expect(wrapper.emitted('update:migrateScope')?.[0]).toEqual(['broken-with-valid-source']);
    await wrapper.setProps({ migrateScope: 'broken-with-valid-source' });
    expect(wrapper.find('.filter-trigger-badge').text()).toContain('可恢复图片');
    expect(wrapper.get('.filter-trigger').attributes('data-tooltip')).toContain('当前筛选：可恢复图片');
  });

  it('MigrateFilterBar updates status, source service, and search models', async () => {
    const wrapper = mountWithDefaults(MigrateFilterBar, {
      props: {
        activeFilter: 'all',
        selectedSourceServiceId: null,
        showServiceMenu: false,
        searchInput: '',
        counts: { all: 4, processing: 1, success: 1, failed: 1, skipped: 1 },
        showProcessing: true,
        sourceServiceOptions: [
          { serviceId: 'jd', label: 'JD', count: 3 },
          { serviceId: 'github', label: 'GitHub', count: 1 },
        ],
      },
    });

    await wrapper.get('.mf-chip--failed').trigger('click');
    await wrapper.get('.mf-filter-chip').trigger('click');
    await wrapper.findAll('.mf-sdi')[2].trigger('click');
    await wrapper.get('input.mf-search__input').setValue('failed');

    expect(wrapper.emitted('update:activeFilter')).toEqual([['failed']]);
    expect(wrapper.emitted('update:showServiceMenu')).toEqual([[true], [false]]);
    expect(wrapper.emitted('update:selectedSourceServiceId')).toEqual([['github']]);
    expect(wrapper.emitted('update:searchInput')?.at(-1)).toEqual(['failed']);
  });

  it('MigrateSelectPhase blocks start until a source is selected', async () => {
    const sourceServiceFilter = ref<string[]>([]);
    const targetServices = ref<MigrateTargetService[]>([
      { serviceId: 'r2', displayName: 'R2', isConfigured: true, pendingCount: 3, backedUpCount: 0, checked: true },
    ]);
    const ctx = createMigrateContext({
      phase: ref('configuring'),
      sourceServiceFilter,
      availableSourceServices: ref([{ id: 'jd', displayName: 'JD', count: 3 }]),
      configuredServices: computed(() => targetServices.value),
      unconfiguredServices: computed(() => []),
      checkedTargets: computed(() => targetServices.value.filter(service => service.checked)),
      totalPending: computed(() => 3),
      isAllBackedUp: computed(() => false),
      healthStatusMap: ref({ r2: 'verified' }),
      healthTooltipMap: ref({ r2: 'ready' }),
    });

    const wrapper = mountWithMigrateContext(MigrateSelectPhase, ctx, {
      global: {
        stubs: {
          MigrateFilterPopover: { template: '<button class="filter-popover-stub" />' },
        },
      },
    });

    const startButton = wrapper.get('.bottom-actions .btn-primary');
    expect(startButton.attributes('disabled')).toBeDefined();

    await wrapper.get('.source-row').trigger('click');
    await flushPromisesAndTicks();

    expect(sourceServiceFilter.value).toEqual(['jd']);
    expect(startButton.attributes('disabled')).toBeUndefined();

    await startButton.trigger('click');
    expect(wrapper.emitted('start')).toHaveLength(1);
  });

  it('MigrateSelectPhase uses scope-specific bottom action copy', async () => {
    const migrateScope = ref<MigrateScope>('broken-with-valid-source');
    const targetServices = ref<MigrateTargetService[]>([
      { serviceId: 'r2', displayName: 'R2', isConfigured: true, pendingCount: 3, backedUpCount: 0, checked: true },
    ]);
    const ctx = createMigrateContext({
      phase: ref('configuring'),
      migrateScope,
      sourceServiceFilter: ref(['jd']),
      availableSourceServices: ref([{ id: 'jd', displayName: 'JD', count: 3 }]),
      configuredServices: computed(() => targetServices.value),
      unconfiguredServices: computed(() => []),
      checkedTargets: computed(() => targetServices.value.filter(service => service.checked)),
      totalPending: computed(() => 3),
      isAllBackedUp: computed(() => false),
      healthStatusMap: ref({ r2: 'verified' }),
      healthTooltipMap: ref({ r2: 'ready' }),
    });

    const wrapper = mountWithMigrateContext(MigrateSelectPhase, ctx, {
      global: {
        stubs: {
          MigrateFilterPopover: { template: '<button class="filter-popover-stub" />' },
        },
      },
    });

    expect(wrapper.get('.bottom-stat').text()).toContain('恢复备份');

    migrateScope.value = 'all-backups';
    await flushPromisesAndTicks();

    expect(wrapper.get('.bottom-stat').text()).toContain('补传备份');
  });

  it('MigrateProgressPhase filters terminal results and retries failed rows', async () => {
    const retrySingleFailed = vi.fn();
    const items = [
      createStatus({ historyId: 'h-success', fileName: 'success-alpha.jpg', status: 'success', existingServiceIds: ['jd'] }),
      createStatus({
        historyId: 'h-failed',
        fileName: 'failed-beta.jpg',
        status: 'failed',
        error: 'upload failed',
        errorType: 'upload',
        serviceResults: { github: 'failed', smms: 'pending' },
        existingServiceIds: ['github'],
      }),
      createStatus({ historyId: 'h-skipped', fileName: 'skipped-gamma.jpg', status: 'skipped', existingServiceIds: ['jd'] }),
    ];
    const ctx = createMigrateContext({
      phase: ref('done'),
      migrateResult: ref(createMigrateResult(items)),
      retrySingleFailed,
    });

    const wrapper = mountWithMigrateContext(MigrateProgressPhase, ctx);
    await flushPromisesAndTicks();

    expect(wrapper.text()).toContain('success-alpha.jpg');
    expect(wrapper.text()).toContain('failed-beta.jpg');
    expect(wrapper.text()).toContain('skipped-gamma.jpg');

    await wrapper.get('.mf-chip--failed').trigger('click');
    await flushPromisesAndTicks();

    expect(wrapper.text()).not.toContain('success-alpha.jpg');
    expect(wrapper.text()).toContain('failed-beta.jpg');
    expect(wrapper.findAll('.mi-row')).toHaveLength(1);

    await wrapper.get('.mi-row__retry-btn').trigger('click');

    expect(retrySingleFailed).toHaveBeenCalledWith('h-failed');
  });

  it('MigrateProgressPhase treats partial successes as retryable failed-filter rows', async () => {
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
      historyId: 'h-partial',
      fileName: 'partial-delta.jpg',
      error: 'GitHub · bad token',
      errorType: 'upload',
      details: [{ serviceId: 'github', message: 'bad token' }],
      isPartial: true,
      failedTargets: ['github'],
    }];
    result.partialFailures = [{ historyId: 'h-partial', fileName: 'partial-delta.jpg', failedTargets: ['github'] }];
    const ctx = createMigrateContext({
      phase: ref('done'),
      migrateResult: ref(result),
      retrySingleFailed,
    });

    const wrapper = mountWithMigrateContext(MigrateProgressPhase, ctx);
    await flushPromisesAndTicks();

    await wrapper.get('.mf-chip--failed').trigger('click');
    await flushPromisesAndTicks();

    expect(wrapper.text()).toContain('partial-delta.jpg');
    await wrapper.get('.mi-row__retry-btn').trigger('click');
    expect(retrySingleFailed).toHaveBeenCalledWith('h-partial');
  });

  it('MigrateProgressPhase exports the final report through Tauri file APIs', async () => {
    getDialogSaveMock().mockResolvedValue('C:/tmp/migrate.csv');
    getFsMocks().writeTextFile.mockResolvedValue(undefined);
    const items = [
      createStatus({ historyId: 'h-success', fileName: 'success-alpha.jpg', status: 'success', existingServiceIds: ['jd'] }),
    ];
    const ctx = createMigrateContext({
      phase: ref('done'),
      migrateResult: ref(createMigrateResult(items)),
    });
    const BottomBarExportStub = defineComponent({
      emits: ['export'],
      template: '<button class="export-csv" type="button" @click="$emit(\'export\', \'csv\')">export</button>',
    });

    const wrapper = mountWithMigrateContext(MigrateProgressPhase, ctx, {
      global: {
        stubs: {
          MigrateBottomBar: BottomBarExportStub,
        },
      },
    });

    await wrapper.get('.export-csv').trigger('click');
    await flushPromisesAndTicks();

    expect(getDialogSaveMock()).toHaveBeenCalledWith(expect.objectContaining({
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    }));
    expect(getFsMocks().writeTextFile).toHaveBeenCalledWith(
      'C:/tmp/migrate.csv',
      expect.stringContaining('success-alpha.jpg'),
    );
  });

  it('MigrateBottomBar covers pause, resume, cancel, retrying, and export states', async () => {
    const running = mountWithDefaults(MigrateBottomBar, {
      props: { mode: 'migrating', isPaused: false, isPausing: false, isCancelling: false },
    });

    await running.findAll('button')[0].trigger('click');
    await running.findAll('button')[1].trigger('click');

    expect(running.emitted('pause')).toHaveLength(1);
    expect(running.emitted('cancel')).toHaveLength(1);

    const paused = mountWithDefaults(MigrateBottomBar, {
      props: { mode: 'migrating', isPaused: true, isPausing: false, isCancelling: false },
    });
    await paused.findAll('button')[0].trigger('click');
    expect(paused.emitted('resume')).toHaveLength(1);

    const pending = mountWithDefaults(MigrateBottomBar, {
      props: { mode: 'done', canRetryAll: true, retryingCount: 2 },
      global: { stubs: { Menu: MenuStub } },
    });

    const retryAll = pending.findAll('button').find(button => button.classes().includes('btn-ghost') && button.attributes('disabled') !== undefined);
    expect(retryAll?.exists()).toBe(true);

    const ExportMenuStub = defineComponent({
      props: ['model'],
      template: '<button class="menu-csv" type="button" @click="model[0].command()">csv</button>',
    });
    const done = mountWithDefaults(MigrateBottomBar, {
      props: { mode: 'done', canRetryAll: false, retryingCount: 0 },
      global: { stubs: { Menu: ExportMenuStub } },
    });

    await done.get('.menu-csv').trigger('click');

    expect(done.emitted('export')).toEqual([['csv']]);
  });
});
