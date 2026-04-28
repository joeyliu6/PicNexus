import { computed, defineComponent, inject, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithDefaults } from '../../../helpers/vueMount';
import BatchMigratePanel from '../../../../components/views/linkcheck/BatchMigratePanel.vue';
import { MIGRATE_KEY, type MigrateContext } from '../../../../components/views/linkcheck/migrate/keys';
import type { MigrateTargetService } from '../../../../types/batchMigrate';

const mockState = vi.hoisted(() => ({
  manager: undefined as MigrateContext | undefined,
  healthStatusMap: { value: {} as Record<string, string> },
  healthTooltipMap: { value: {} as Record<string, string> },
}));

vi.mock('../../../../composables/useBatchMigrate', () => ({
  useBatchMigrateManager: () => mockState.manager,
}));

vi.mock('../../../../composables/useServiceHealth', () => ({
  useServiceHealth: () => ({
    healthStatusMap: mockState.healthStatusMap,
    healthTooltipMap: mockState.healthTooltipMap,
  }),
}));

vi.mock('../../../../utils/debounce', () => ({
  debounceWithError: (fn: () => Promise<void>) => Object.assign(
    () => { void fn(); },
    {
      cancel: vi.fn(),
      immediate: fn,
    },
  ),
}));

function createManager(services: MigrateTargetService[], phase = 'configuring'): any {
  const targetServices = ref(services);
  return {
    phase: ref(phase as 'configuring' | 'migrating' | 'done'),
    isInitialized: ref(true),
    isFilterApplied: ref(true),
    isRefiltering: ref(false),
    maxSuccessCount: ref(999),
    sourceServiceFilter: ref(['source']),
    availableSourceServices: ref([{ id: 'source', displayName: 'Source', count: 1 }]),
    timestampAfterMs: ref(null),
    targetServices,
    configuredServices: computed(() => targetServices.value.filter(service => service.isConfigured)),
    unconfiguredServices: computed(() => targetServices.value.filter(service => !service.isConfigured)),
    checkedTargets: computed(() => targetServices.value.filter(service => service.checked && service.isConfigured)),
    totalPending: computed(() => 1),
    isAllBackedUp: computed(() => false),
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
    initConfiguring: vi.fn(async () => undefined),
    applyFilter: vi.fn(async () => undefined),
    startMigrate: vi.fn(async () => undefined),
    cancelMigrate: vi.fn(),
    pauseMigrate: vi.fn(),
    resumeMigrate: vi.fn(),
    isPaused: ref(false),
    isPausing: ref(false),
    isCancelling: ref(false),
    retryFailed: vi.fn(async () => undefined),
    retrySingleFailed: vi.fn(async () => undefined),
    resetToConfiguring: vi.fn(async () => undefined),
    migrateStats: ref({ startTime: 0, elapsedMs: 0, processedCount: 0, totalCount: 0, totalBytes: 0 }),
    healthStatusMap: mockState.healthStatusMap,
    healthTooltipMap: mockState.healthTooltipMap,
    onViewActivated: vi.fn(),
    onViewDeactivated: vi.fn(),
    wasIdleCleared: ref(false),
    dispose: vi.fn(),
  } as unknown as MigrateContext & { targetServices: typeof targetServices };
}

const SelectStub = defineComponent({
  emits: ['start'],
  template: '<button class="select-start" type="button" @click="$emit(\'start\')">start</button>',
});

const ProgressRetryStub = defineComponent({
  setup() {
    const ctx = inject(MIGRATE_KEY)!;
    return { retry: () => ctx.retryFailed(['h1']) };
  },
  template: '<button class="retry-failed" type="button" @click="retry">retry</button>',
});

function mountPanel() {
  return mountWithDefaults(BatchMigratePanel, {
    global: {
      stubs: {
        MigrateSelectPhase: SelectStub,
        MigrateProgressPhase: ProgressRetryStub,
      },
    },
  });
}

describe('BatchMigratePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.healthStatusMap.value = {};
    mockState.healthTooltipMap.value = {};
  });

  it('filters unhealthy checked targets before starting migration', async () => {
    const manager = createManager([
      { serviceId: 'github', displayName: 'GitHub', isConfigured: true, pendingCount: 1, checked: true },
      { serviceId: 'smms', displayName: 'SM.MS', isConfigured: true, pendingCount: 1, checked: true },
    ]);
    mockState.manager = manager;
    mockState.healthStatusMap.value = { github: 'verified', smms: 'error' };
    const wrapper = mountPanel();

    await wrapper.get('.select-start').trigger('click');

    expect(manager.targetServices.value.find((service: MigrateTargetService) => service.serviceId === 'smms')?.checked).toBe(false);
    expect(manager.targetServices.value.find((service: MigrateTargetService) => service.serviceId === 'github')?.checked).toBe(true);
    expect(manager.startMigrate).toHaveBeenCalledTimes(1);
  });

  it('does not start when all checked targets are filtered out as unhealthy', async () => {
    const manager = createManager([
      { serviceId: 'smms', displayName: 'SM.MS', isConfigured: true, pendingCount: 1, checked: true },
    ]);
    mockState.manager = manager;
    mockState.healthStatusMap.value = { smms: 'error' };
    const wrapper = mountPanel();

    await wrapper.get('.select-start').trigger('click');

    expect(manager.targetServices.value[0].checked).toBe(false);
    expect(manager.startMigrate).not.toHaveBeenCalled();
  });

  it('filters unhealthy targets before retrying failed rows', async () => {
    const manager = createManager([
      { serviceId: 'github', displayName: 'GitHub', isConfigured: true, pendingCount: 1, checked: true },
      { serviceId: 'smms', displayName: 'SM.MS', isConfigured: true, pendingCount: 1, checked: true },
    ], 'done');
    mockState.manager = manager;
    mockState.healthStatusMap.value = { github: 'verified', smms: 'error' };
    const wrapper = mountPanel();

    await wrapper.get('.retry-failed').trigger('click');

    expect(manager.targetServices.value.find((service: MigrateTargetService) => service.serviceId === 'smms')?.checked).toBe(false);
    expect(manager.retryFailed).toHaveBeenCalledWith(['h1']);
  });
});
