// 图床服务可用性检测 Composable
// 从 SettingsView.vue 中抽取，提供七鱼、京东等服务的可用性检测
// 使用模块级单例模式，确保状态跨组件共享

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { SyncStatus } from '../config/types';
import { syncStatusStore } from '../store/instances';
import { useServiceHealth } from './useServiceHealth';
import { isUploading } from './uploadState';
import { buildServiceCheckSummarySnapshot, useServiceCheckRunner } from './useServiceCheckRunner';
import type { ServiceCheckMode } from '../types/serviceCheck';
import type { ServiceHealthStatus } from '../types/serviceHealth';

const serviceHealth = useServiceHealth();
const { markVerified, markTestFailed } = serviceHealth;
const { runServiceChecks, testingConnections } = useServiceCheckRunner();

type BuiltinServiceId = 'qiyu' | 'jd';

// ==================== 类型定义 ====================

/** useServiceAvailability 返回值类型 */
export interface UseServiceAvailabilityReturn {
  // 状态（共享单例）
  qiyuAvailable: Ref<boolean>;
  jdAvailable: Ref<boolean>;
  isCheckingQiyu: ComputedRef<boolean>;
  isCheckingJd: ComputedRef<boolean>;

  // 方法
  checkQiyuAvailability: (forceCheck?: boolean) => Promise<void>;
  checkJdAvailable: (forceCheck?: boolean) => Promise<void>;
  checkAllAvailabilityWithCooldown: (syncStatus?: SyncStatus) => Promise<void>;
  markServiceAvailable: (serviceId: BuiltinServiceId) => Promise<void>;
  startPeriodicCheck: () => { intervalId: ReturnType<typeof setInterval>; stopWatch: () => void };
}

// ==================== 常量 ====================

/** 检测成功后冷却时间（12小时） */
const CHECK_SUCCESS_COOLDOWN = 12 * 60 * 60 * 1000;

/** 检测失败后冷却时间（30分钟，快速重试） */
const CHECK_FAIL_COOLDOWN = 30 * 60 * 1000;

const BUILTIN_SERVICE_LABELS: Record<BuiltinServiceId, string> = {
  jd: '京东图床',
  qiyu: '七鱼图床',
};

const BUILTIN_SERVICE_COMMANDS: Record<BuiltinServiceId, string> = {
  jd: 'check_jd_available',
  qiyu: 'check_qiyu_available',
};

// ==================== 模块级共享状态（单例） ====================

const qiyuAvailable = ref(false);
const jdAvailable = ref(false);

const isCheckingQiyu = computed(() => !!testingConnections.value.qiyu);
const isCheckingJd = computed(() => !!testingConnections.value.jd);

let syncStatusWriteChain: Promise<void> = Promise.resolve();

// ==================== 工具函数 ====================

function getAvailabilityRef(serviceId: BuiltinServiceId): Ref<boolean> {
  return serviceId === 'qiyu' ? qiyuAvailable : jdAvailable;
}

function getHealthStatus(serviceId: string): ServiceHealthStatus {
  return serviceHealth.healthStatusMap?.value?.[serviceId] ?? 'pending';
}

function getHealthStatusMapSnapshot(): Record<string, ServiceHealthStatus> {
  return serviceHealth.healthStatusMap?.value ?? {};
}

function getSyncStatusKey(serviceId: BuiltinServiceId): 'qiyuCheckStatus' | 'jdCheckStatus' {
  return serviceId === 'qiyu' ? 'qiyuCheckStatus' : 'jdCheckStatus';
}

function getUnavailableMessage(serviceId: BuiltinServiceId): string {
  return `${BUILTIN_SERVICE_LABELS[serviceId]}当前不可用`;
}

async function loadSyncStatusSafe(): Promise<SyncStatus | null> {
  try {
    return await syncStatusStore.get<SyncStatus>('status');
  } catch (error) {
    console.error('[服务检测] 加载同步状态失败:', error);
    return null;
  }
}

function applyCachedAvailability(serviceId: BuiltinServiceId, syncStatus?: SyncStatus | null): void {
  const checkStatus = syncStatus?.[getSyncStatusKey(serviceId)];
  if (checkStatus?.lastCheckResult !== undefined) {
    getAvailabilityRef(serviceId).value = checkStatus.lastCheckResult;
  }
}

function shouldSkipBuiltinCheck(
  serviceId: BuiltinServiceId,
  syncStatus: SyncStatus | null,
  forceCheck: boolean
): boolean {
  if (forceCheck) return false;
  const checkStatus = syncStatus?.[getSyncStatusKey(serviceId)];
  if (!checkStatus?.nextCheckTime) return false;
  return Date.now() < checkStatus.nextCheckTime;
}

async function persistBuiltinCheckStatus(
  patch: Partial<Pick<SyncStatus, 'qiyuCheckStatus' | 'jdCheckStatus'>>
): Promise<void> {
  syncStatusWriteChain = syncStatusWriteChain
    .catch(() => {
      // 上一轮写入失败后继续后续队列
    })
    .then(async () => {
      try {
        const latest = await syncStatusStore.get<SyncStatus>('status').catch(() => null);
        const updatedStatus: SyncStatus = latest || { syncByProfile: {} };

        if (patch.qiyuCheckStatus) updatedStatus.qiyuCheckStatus = patch.qiyuCheckStatus;
        if (patch.jdCheckStatus) updatedStatus.jdCheckStatus = patch.jdCheckStatus;

        await syncStatusStore.set('status', updatedStatus);
        await syncStatusStore.save();
      } catch (error) {
        console.warn('[服务检测] 状态持久化失败（不影响检测结果）:', error);
      }
    });

  await syncStatusWriteChain;
}

export async function probeBuiltinServiceAvailability(
  serviceId: BuiltinServiceId,
  forceCheck: boolean = false,
  syncStatus?: SyncStatus | null
): Promise<void> {
  const status = syncStatus ?? await loadSyncStatusSafe();

  if (shouldSkipBuiltinCheck(serviceId, status, forceCheck)) {
    applyCachedAvailability(serviceId, status);
    return;
  }

  const availability = getAvailabilityRef(serviceId);
  const now = Date.now();
  let checkResult = false;

  try {
    checkResult = await invoke<boolean>(BUILTIN_SERVICE_COMMANDS[serviceId]);
    availability.value = checkResult;

    if (checkResult) {
      markVerified(serviceId);
    } else {
      markTestFailed(serviceId, getUnavailableMessage(serviceId));
    }
  } catch (error) {
    availability.value = false;
    markTestFailed(serviceId, String(error));
    throw error;
  } finally {
    await persistBuiltinCheckStatus({
      [getSyncStatusKey(serviceId)]: {
        lastCheckTime: now,
        lastCheckResult: checkResult,
        nextCheckTime: checkResult ? now + CHECK_SUCCESS_COOLDOWN : now + CHECK_FAIL_COOLDOWN,
      },
    });
  }
}

async function runBuiltinChecks(
  serviceIds: BuiltinServiceId[],
  options: {
    forceCheck?: boolean;
    mode: ServiceCheckMode;
    initialSyncStatus?: SyncStatus;
  }
): Promise<void> {
  const persistedSyncStatus = await loadSyncStatusSafe();
  const cachedSyncStatus = options.initialSyncStatus ?? persistedSyncStatus;
  const syncStatus = persistedSyncStatus ?? cachedSyncStatus;

  // 只回填本轮要检测的服务，避免顺带覆盖另一个服务刚由 markServiceAvailable 写入的活动状态。
  for (const serviceId of serviceIds) {
    applyCachedAvailability(serviceId, cachedSyncStatus);
  }

  const dueServiceIds = serviceIds.filter((serviceId) => {
    return !shouldSkipBuiltinCheck(serviceId, syncStatus, !!options.forceCheck);
  });

  if (dueServiceIds.length === 0) return;

  const baselineStatuses = Object.fromEntries(
    dueServiceIds.map((serviceId) => [serviceId, getHealthStatus(serviceId)])
  ) as Record<string, ServiceHealthStatus>;

  await runServiceChecks({
    mode: options.mode,
    tasks: dueServiceIds.map((serviceId) => ({
      serviceId,
      label: BUILTIN_SERVICE_LABELS[serviceId],
      run: () => probeBuiltinServiceAvailability(serviceId, true, syncStatus),
    })),
    baselineStatuses,
    summarySnapshot: buildServiceCheckSummarySnapshot(getHealthStatusMapSnapshot()),
    resolveStatus: getHealthStatus,
  });
}

// ==================== 检测方法 ====================

async function checkQiyuAvailability(forceCheck = false): Promise<void> {
  await runBuiltinChecks(['qiyu'], {
    forceCheck,
    mode: forceCheck ? 'single' : 'background',
  });
}

async function checkJdAvailable(forceCheck = false): Promise<void> {
  await runBuiltinChecks(['jd'], {
    forceCheck,
    mode: forceCheck ? 'single' : 'background',
  });
}

/**
 * 检测所有服务可用性（带冷却）
 *
 * @param initialSyncStatus 初始同步状态（用于恢复缓存值）
 */
async function checkAllAvailabilityWithCooldown(initialSyncStatus?: SyncStatus): Promise<void> {
  if (initialSyncStatus?.qiyuCheckStatus?.lastCheckResult !== undefined) {
    qiyuAvailable.value = initialSyncStatus.qiyuCheckStatus.lastCheckResult;
  }
  if (initialSyncStatus?.jdCheckStatus?.lastCheckResult !== undefined) {
    jdAvailable.value = initialSyncStatus.jdCheckStatus.lastCheckResult;
  }

  await runBuiltinChecks(['qiyu', 'jd'], {
    forceCheck: false,
    mode: 'background',
    initialSyncStatus,
  });
}

/**
 * 标记某图床上传成功（视为可用，重置冷却计时器）
 * 供 useUpload.ts 在上传成功后调用
 */
async function markServiceAvailable(serviceId: BuiltinServiceId): Promise<void> {
  const now = Date.now();
  const nextCheckTime = now + CHECK_SUCCESS_COOLDOWN;
  const availability = getAvailabilityRef(serviceId);

  availability.value = true;
  markVerified(serviceId);

  await persistBuiltinCheckStatus({
    [getSyncStatusKey(serviceId)]: {
      lastCheckTime: now,
      lastCheckResult: true,
      nextCheckTime,
    },
  });
}

/**
 * 启动周期性检测（每 12 小时）
 * 若上传期间定时触发，则推迟到上传完成后执行
 *
 * @returns intervalId 供 onUnmounted 清理
 */
function startPeriodicCheck(): { intervalId: ReturnType<typeof setInterval>; stopWatch: () => void } {
  let pendingCheck = false;

  const intervalId = setInterval(async () => {
    if (isUploading.value) {
      pendingCheck = true;
      return;
    }
    await checkAllAvailabilityWithCooldown();
  }, CHECK_SUCCESS_COOLDOWN);

  const stopWatch = watch(isUploading, async (uploading) => {
    if (!uploading && pendingCheck) {
      pendingCheck = false;
      await checkAllAvailabilityWithCooldown();
    }
  });

  return { intervalId, stopWatch };
}

// ==================== 主 Composable ====================

export function useServiceAvailability(): UseServiceAvailabilityReturn {
  return {
    qiyuAvailable,
    jdAvailable,
    isCheckingQiyu,
    isCheckingJd,
    checkQiyuAvailability,
    checkJdAvailable,
    checkAllAvailabilityWithCooldown,
    markServiceAvailable,
    startPeriodicCheck,
  };
}
