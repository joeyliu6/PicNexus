// 图床服务可用性检测 Composable
// 从 SettingsView.vue 中抽取，提供七鱼、京东等服务的可用性检测
// 使用模块级单例模式，确保状态跨组件共享

import { ref, watch, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { SyncStatus } from '../config/types';
import { syncStatusStore } from '../store/instances';
import { useServiceHealth } from './useServiceHealth';
import { isUploading } from './uploadState';

const { markVerified, markTestFailed } = useServiceHealth();

// ==================== 类型定义 ====================

/** useServiceAvailability 返回值类型 */
export interface UseServiceAvailabilityReturn {
  // 状态（共享单例）
  qiyuAvailable: Ref<boolean>;
  jdAvailable: Ref<boolean>;
  isCheckingQiyu: Ref<boolean>;
  isCheckingJd: Ref<boolean>;

  // 方法
  checkQiyuAvailability: (forceCheck?: boolean) => Promise<void>;
  checkJdAvailable: (forceCheck?: boolean) => Promise<void>;
  checkAllAvailabilityWithCooldown: (syncStatus?: SyncStatus) => Promise<void>;
  markServiceAvailable: (serviceId: 'qiyu' | 'jd') => Promise<void>;
  startPeriodicCheck: () => { intervalId: ReturnType<typeof setInterval>; stopWatch: () => void };
}

// ==================== 常量 ====================

/** 检测成功后冷却时间（12小时） */
const CHECK_SUCCESS_COOLDOWN = 12 * 60 * 60 * 1000;

/** 检测失败后冷却时间（30分钟，快速重试） */
const CHECK_FAIL_COOLDOWN = 30 * 60 * 1000;

// ==================== 模块级共享状态（单例） ====================

const qiyuAvailable = ref(false);
const isCheckingQiyu = ref(false);
const jdAvailable = ref(false);
const isCheckingJd = ref(false);

// ==================== 检测方法 ====================

/**
 * 七鱼可用性检测
 * 采用智能检测策略：如果上次检测成功，则延长下次检测间隔
 *
 * @param forceCheck 是否强制检测（忽略冷却时间）
 */
async function checkQiyuAvailability(forceCheck = false): Promise<void> {
  // 从存储加载当前状态
  let syncStatus: SyncStatus | null = null;
  try {
    syncStatus = await syncStatusStore.get<SyncStatus>('status');
  } catch (e) {
    console.error('[服务检测] 加载同步状态失败:', e);
  }

  const now = Date.now();

  // 如果不是强制检测，检查是否在冷却期内
  if (!forceCheck && syncStatus?.qiyuCheckStatus?.nextCheckTime) {
    if (now < syncStatus.qiyuCheckStatus.nextCheckTime) {
      qiyuAvailable.value = syncStatus.qiyuCheckStatus.lastCheckResult ?? false;
      console.debug('[七鱼检测] 在冷却期内，使用缓存结果:', qiyuAvailable.value);
      return;
    }
  }

  isCheckingQiyu.value = true;
  let checkResult = false;
  try {
    checkResult = await invoke<boolean>('check_qiyu_available');
    qiyuAvailable.value = checkResult;
    if (checkResult) markVerified('qiyu');
  } catch (e) {
    qiyuAvailable.value = false;
    markTestFailed('qiyu', String(e));
    console.error('[七鱼检测] 检测失败:', e);
  } finally {
    isCheckingQiyu.value = false;
  }

  // 持久化单独处理，失败不影响检测结果
  try {
    const updatedStatus: SyncStatus = syncStatus || { syncByProfile: {} };
    updatedStatus.qiyuCheckStatus = {
      lastCheckTime: now,
      lastCheckResult: checkResult,
      nextCheckTime: checkResult ? now + CHECK_SUCCESS_COOLDOWN : now + CHECK_FAIL_COOLDOWN,
    };
    await syncStatusStore.set('status', updatedStatus);
    await syncStatusStore.save();
  } catch (e) {
    console.warn('[七鱼检测] 状态持久化失败（不影响检测结果）:', e);
  }
}

/**
 * 京东可用性检测
 * 采用与七鱼相同的智能检测策略，支持缓存恢复
 *
 * @param forceCheck 是否强制检测（忽略冷却时间）
 */
async function checkJdAvailable(forceCheck = false): Promise<void> {
  let syncStatus: SyncStatus | null = null;
  try {
    syncStatus = await syncStatusStore.get<SyncStatus>('status');
  } catch (e) {
    console.error('[服务检测] 加载同步状态失败:', e);
  }

  const now = Date.now();

  if (!forceCheck && syncStatus?.jdCheckStatus?.nextCheckTime) {
    if (now < syncStatus.jdCheckStatus.nextCheckTime) {
      jdAvailable.value = syncStatus.jdCheckStatus.lastCheckResult ?? false;
      console.debug('[京东检测] 在冷却期内，使用缓存结果:', jdAvailable.value);
      return;
    }
  }

  isCheckingJd.value = true;
  let checkResult = false;
  try {
    checkResult = await invoke<boolean>('check_jd_available');
    jdAvailable.value = checkResult;
    if (checkResult) markVerified('jd');
  } catch (e) {
    jdAvailable.value = false;
    markTestFailed('jd', String(e));
    console.error('[京东检测] 检测失败:', e);
  } finally {
    isCheckingJd.value = false;
  }

  // 持久化单独处理，失败不影响检测结果
  try {
    const updatedStatus: SyncStatus = syncStatus || { syncByProfile: {} };
    updatedStatus.jdCheckStatus = {
      lastCheckTime: now,
      lastCheckResult: checkResult,
      nextCheckTime: checkResult ? now + CHECK_SUCCESS_COOLDOWN : now + CHECK_FAIL_COOLDOWN,
    };
    await syncStatusStore.set('status', updatedStatus);
    await syncStatusStore.save();
  } catch (e) {
    console.warn('[京东检测] 状态持久化失败（不影响检测结果）:', e);
  }
}

/**
 * 检测所有服务可用性（带冷却）
 *
 * @param initialSyncStatus 初始同步状态（用于恢复缓存值）
 */
async function checkAllAvailabilityWithCooldown(initialSyncStatus?: SyncStatus): Promise<void> {
  // 如果提供了初始状态，先恢复缓存值
  if (initialSyncStatus?.qiyuCheckStatus?.lastCheckResult !== undefined) {
    qiyuAvailable.value = initialSyncStatus.qiyuCheckStatus.lastCheckResult;
  }
  if (initialSyncStatus?.jdCheckStatus?.lastCheckResult !== undefined) {
    jdAvailable.value = initialSyncStatus.jdCheckStatus.lastCheckResult;
  }

  // 串行检测，避免并发写 syncStatusStore 同一 key 导致互相覆盖
  await checkQiyuAvailability(false);
  await checkJdAvailable(false);
}

/**
 * 标记某图床上传成功（视为可用，重置冷却计时器）
 * 供 useUpload.ts 在上传成功后调用
 */
async function markServiceAvailable(serviceId: 'qiyu' | 'jd'): Promise<void> {
  const now = Date.now();
  const nextCheckTime = now + CHECK_SUCCESS_COOLDOWN;

  let syncStatus: SyncStatus | null = null;
  try {
    syncStatus = await syncStatusStore.get<SyncStatus>('status');
  } catch {
    // 忽略读取失败
  }

  const updatedStatus: SyncStatus = syncStatus || { syncByProfile: {} };
  const checkStatus = { lastCheckTime: now, lastCheckResult: true, nextCheckTime };

  if (serviceId === 'qiyu') {
    qiyuAvailable.value = true;
    updatedStatus.qiyuCheckStatus = checkStatus;
  } else {
    jdAvailable.value = true;
    updatedStatus.jdCheckStatus = checkStatus;
  }

  try {
    await syncStatusStore.set('status', updatedStatus);
    await syncStatusStore.save();
  } catch (e) {
    console.warn('[服务检测] 标记可用状态持久化失败:', e);
  }
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

/**
 * 图床服务可用性检测 Composable
 *
 * 使用模块级单例模式，所有组件共享同一份状态
 *
 * @example
 * ```typescript
 * const {
 *   qiyuAvailable,
 *   jdAvailable,
 *   checkAllAvailabilityWithCooldown
 * } = useServiceAvailability();
 *
 * // 检测所有服务可用性
 * await checkAllAvailabilityWithCooldown(syncStatus);
 * ```
 */
export function useServiceAvailability(): UseServiceAvailabilityReturn {
  return {
    // 状态（共享单例）
    qiyuAvailable,
    jdAvailable,
    isCheckingQiyu,
    isCheckingJd,

    // 方法
    checkQiyuAvailability,
    checkJdAvailable,
    checkAllAvailabilityWithCooldown,
    markServiceAvailable,
    startPeriodicCheck,
  };
}
