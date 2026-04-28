import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref, type Component } from 'vue';
import { mountWithDefaults } from '../../../../helpers/vueMount';
import SourceList from '../../../../../components/views/linkcheck/migrate/components/SourceList.vue';
import TargetCard from '../../../../../components/views/linkcheck/migrate/components/TargetCard.vue';
import MigrateFilterBar from '../../../../../components/views/linkcheck/migrate/components/MigrateFilterBar.vue';
import MigrateBottomBar from '../../../../../components/views/linkcheck/migrate/components/MigrateBottomBar.vue';
import MigrateProgressPhase from '../../../../../components/views/linkcheck/migrate/MigrateProgressPhase.vue';
import { MIGRATE_KEY, type MigrateContext } from '../../../../../components/views/linkcheck/migrate/keys';
import type { MigrateItemStatus, MigrateResult, MigrateTargetService } from '../../../../../types/batchMigrate';
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
    { serviceId: 'github', displayName: 'GitHub', isConfigured: true, pendingCount: 2, checked: true },
    { serviceId: 'smms', displayName: 'SM.MS', isConfigured: true, pendingCount: 1, checked: false },
  ]);

  const ctx: MigrateContext = {
    phase: ref('done'),
    isInitialized: ref(true),
    isFilterApplied: ref(true),
    isRefiltering: ref(false),
    maxSuccessCount: ref(999),
    sourceServiceFilter: ref(['jd']),
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

function mountWithMigrateContext(component: Component, ctx: MigrateContext, options = {}) {
  return mountWithDefaults(component, {
    ...options,
    global: {
      provide: {
        [MIGRATE_KEY as symbol]: ctx,
      },
      stubs: {
        Checkbox: CheckboxStub,
        Menu: MenuStub,
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
        checked: false,
        healthStatus: 'verified',
      },
    });
    const error = mountWithDefaults(TargetCard, {
      props: {
        serviceId: 'smms',
        displayName: 'SM.MS',
        pendingCount: 3,
        checked: false,
        healthStatus: 'error',
      },
    });

    await healthy.get('.target-card').trigger('click');
    await error.get('.target-card').trigger('click');

    expect(healthy.emitted('toggle')).toHaveLength(1);
    expect(error.emitted('toggle')).toBeUndefined();
    expect(error.get('.target-card').attributes('aria-disabled')).toBe('true');
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
  });
});
