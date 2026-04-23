import { computed, ref, type ComputedRef, type Ref } from 'vue';
import pLimit from 'p-limit';
import type { BatchTestProgress } from '../types/batchTest';
import type { ServiceCheckMode, ServiceCheckSession, ServiceCheckSummarySnapshot } from '../types/serviceCheck';
import type { ServiceHealthStatus } from '../types/serviceHealth';

export const MAX_SERVICE_CHECK_CONCURRENCY = 3;

export interface ServiceCheckTask {
  serviceId: string;
  label: string;
  run: () => Promise<void>;
}

interface RunServiceChecksOptions {
  mode: ServiceCheckMode;
  tasks: ServiceCheckTask[];
  baselineStatuses: Record<string, ServiceHealthStatus>;
  summarySnapshot: ServiceCheckSummarySnapshot;
  resolveStatus: (serviceId: string) => ServiceHealthStatus;
}

interface ServiceCheckController {
  cancelled: boolean;
}

const testingConnections = ref<Record<string, boolean>>({});
const activeSession: Ref<ServiceCheckSession | null> = ref(null);
const visibleRefreshingServiceIds: ComputedRef<Set<string>> = computed(() => {
  return new Set(activeSession.value?.refreshingIds ?? []);
});
const batchTestProgress = ref<BatchTestProgress | null>(null);
const batchTestCompletionKey = ref(0);

const isBatchTesting: ComputedRef<boolean> = computed(() => {
  return activeSession.value?.mode === 'batch' || activeSession.value?.mode === 'background';
});

let currentController: ServiceCheckController | null = null;

const SUMMARY_LABELS: Record<ServiceHealthStatus, string> = {
  verified: '个正常',
  error: '个异常',
  pending: '个未检测',
  unconfigured: '个未配置',
};

function ensureTestingConnection(serviceId: string): void {
  if (!(serviceId in testingConnections.value)) {
    testingConnections.value[serviceId] = false;
  }
}

function replaceSession(next: ServiceCheckSession | null): void {
  if (!next) {
    activeSession.value = null;
    return;
  }

  activeSession.value = {
    ...next,
    targetIds: [...next.targetIds],
    refreshingIds: [...next.refreshingIds],
    runningIds: [...next.runningIds],
    completedIds: [...next.completedIds],
    baselineStatuses: { ...next.baselineStatuses },
    resultStatuses: { ...next.resultStatuses },
    summarySkeletonStatuses: [...next.summarySkeletonStatuses],
    summarySnapshot: { ...next.summarySnapshot },
  };
}

function mutateSession(mutator: (session: ServiceCheckSession) => void): void {
  const current = activeSession.value;
  if (!current) return;
  const next: ServiceCheckSession = {
    ...current,
    targetIds: [...current.targetIds],
    refreshingIds: [...current.refreshingIds],
    runningIds: [...current.runningIds],
    completedIds: [...current.completedIds],
    baselineStatuses: { ...current.baselineStatuses },
    resultStatuses: { ...current.resultStatuses },
    summarySkeletonStatuses: [...current.summarySkeletonStatuses],
    summarySnapshot: { ...current.summarySnapshot },
  };
  mutator(next);
  replaceSession(next);
}

export function buildServiceCheckSummarySnapshot(
  statusMap: Record<string, ServiceHealthStatus>
): ServiceCheckSummarySnapshot {
  const counts: Record<ServiceHealthStatus, number> = {
    verified: 0,
    error: 0,
    pending: 0,
    unconfigured: 0,
  };

  for (const status of Object.values(statusMap)) {
    counts[status]++;
  }

  return {
    verified: `${counts.verified} ${SUMMARY_LABELS.verified}`,
    error: `${counts.error} ${SUMMARY_LABELS.error}`,
    pending: `${counts.pending} ${SUMMARY_LABELS.pending}`,
    unconfigured: `${counts.unconfigured} ${SUMMARY_LABELS.unconfigured}`,
    counts,
  };
}

// 骨架 pill 集合严格跟随检测前的真实 count：只渲染 count>0 的状态，
// 确保检测前→检测中→检测后三个阶段顶部 pill 数量一致，不会因进入/退出骨架态而抖动。
function buildSummarySkeletonStatuses(
  mode: ServiceCheckMode,
  baselineStatuses: Record<string, ServiceHealthStatus>,
  summaryCounts: Record<ServiceHealthStatus, number>
): ServiceHealthStatus[] {
  if (mode === 'single') {
    const firstStatus = Object.values(baselineStatuses).find(status => status !== 'unconfigured');
    return firstStatus ? [firstStatus] : [];
  }

  return (['verified', 'error', 'pending', 'unconfigured'] as const)
    .filter(status => summaryCounts[status] > 0);
}

function beginSession(options: RunServiceChecksOptions): ServiceCheckController | null {
  if (activeSession.value || options.tasks.length === 0) return null;

  const targetIds = options.tasks.map(task => task.serviceId);
  const controller: ServiceCheckController = {
    cancelled: false,
  };

  for (const serviceId of targetIds) {
    ensureTestingConnection(serviceId);
  }

  currentController = controller;

  replaceSession({
    mode: options.mode,
    startedAt: Date.now(),
    targetIds,
    refreshingIds: [...targetIds],
    runningIds: [],
    completedIds: [],
    baselineStatuses: options.baselineStatuses,
    resultStatuses: {},
    summarySkeletonStatuses: buildSummarySkeletonStatuses(
      options.mode,
      options.baselineStatuses,
      options.summarySnapshot.counts
    ),
    summarySnapshot: options.summarySnapshot,
  });

  if (options.mode !== 'single') {
    batchTestProgress.value = {
      current: 0,
      total: targetIds.length,
      currentService: '',
    };
  } else {
    batchTestProgress.value = null;
  }

  return controller;
}

function markTaskStarted(serviceId: string, label: string): void {
  testingConnections.value[serviceId] = true;

  mutateSession((session) => {
    if (!session.runningIds.includes(serviceId)) {
      session.runningIds.push(serviceId);
    }
  });

  if (batchTestProgress.value) {
    batchTestProgress.value = {
      ...batchTestProgress.value,
      currentService: label,
    };
  }
}

function markTaskSettled(
  serviceId: string,
  label: string,
  status: ServiceHealthStatus
): void {
  testingConnections.value[serviceId] = false;

  mutateSession((session) => {
    session.runningIds = session.runningIds.filter(id => id !== serviceId);
    session.refreshingIds = session.refreshingIds.filter(id => id !== serviceId);
    if (!session.completedIds.includes(serviceId)) {
      session.completedIds.push(serviceId);
    }
    session.resultStatuses[serviceId] = status;
  });

  if (batchTestProgress.value && activeSession.value) {
    batchTestProgress.value = {
      current: activeSession.value.completedIds.length,
      total: activeSession.value.targetIds.length,
      currentService: label,
    };
  }
}

function finalizeSession(controller: ServiceCheckController): void {
  if (currentController !== controller) return;

  const session = activeSession.value;
  if (session?.mode !== 'single') {
    batchTestCompletionKey.value++;
  }

  replaceSession(null);
  batchTestProgress.value = null;
  currentController = null;
}

async function runServiceChecks(options: RunServiceChecksOptions): Promise<void> {
  const tasks = options.tasks.filter(task => task.serviceId);
  if (tasks.length === 0) return;

  const controller = beginSession({
    ...options,
    tasks,
  });
  if (!controller) return;

  const limit = pLimit(MAX_SERVICE_CHECK_CONCURRENCY);

  await Promise.all(tasks.map(task => limit(async () => {
    if (currentController !== controller) return;
    if (controller.cancelled) return;

    markTaskStarted(task.serviceId, task.label);

    try {
      await task.run();
    } catch {
      // 具体错误由任务自身负责落健康状态，这里只保证不会中断其他任务
    } finally {
      markTaskSettled(task.serviceId, task.label, options.resolveStatus(task.serviceId));
    }
  })));

  finalizeSession(controller);
}

function cancelBatchTest(): void {
  const controller = currentController;
  const session = activeSession.value;
  if (!controller || !session || session.mode === 'single') return;

  controller.cancelled = true;

  const queuedIds = session.targetIds.filter((serviceId) => {
    return !session.runningIds.includes(serviceId) && !session.completedIds.includes(serviceId);
  });

  mutateSession((draft) => {
    draft.targetIds = draft.targetIds.filter(id => !queuedIds.includes(id));
    draft.refreshingIds = draft.refreshingIds.filter(id => !queuedIds.includes(id));
  });

  if (batchTestProgress.value && activeSession.value) {
    batchTestProgress.value = {
      current: activeSession.value.completedIds.length,
      total: activeSession.value.targetIds.length,
      currentService: batchTestProgress.value.currentService,
    };
  }
}

export function useServiceCheckRunner(): {
  testingConnections: Ref<Record<string, boolean>>;
  activeSession: Ref<ServiceCheckSession | null>;
  visibleRefreshingServiceIds: ComputedRef<Set<string>>;
  isBatchTesting: ComputedRef<boolean>;
  batchTestProgress: Ref<BatchTestProgress | null>;
  batchTestCompletionKey: Ref<number>;
  runServiceChecks: (options: RunServiceChecksOptions) => Promise<void>;
  cancelBatchTest: () => void;
} {
  return {
    testingConnections,
    activeSession,
    visibleRefreshingServiceIds,
    isBatchTesting,
    batchTestProgress,
    batchTestCompletionKey,
    runServiceChecks,
    cancelBatchTest,
  };
}

export function __resetServiceCheckRunnerForTests(): void {
  testingConnections.value = {};
  batchTestProgress.value = null;
  batchTestCompletionKey.value = 0;
  replaceSession(null);
  currentController = null;
}
