// 图床服务可用性检测 Composable
// 从 SettingsView.vue 中抽取，提供七鱼、京东等服务的可用性检测
// 使用模块级单例模式，确保状态跨组件共享

import { ref, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { SyncStatus } from '../config/types';
import { syncStatusStore } from '../store/instances';

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
  checkJdAvailable: () => Promise<void>;
  checkAllAvailabilityWithCooldown: (syncStatus?: SyncStatus) => Promise<void>;

  // 工具函数
  getRandomCheckInterval: () => number;
}

// ==================== 常量 ====================

/** 京东检测冷却时间 (5分钟) */
const JD_CHECK_COOLDOWN = 5 * 60 * 1000;

/** 七鱼检测成功后最小间隔 (10小时) */
const QIYU_MIN_INTERVAL = 10 * 60 * 60 * 1000;

/** 七鱼检测成功后最大间隔 (14小时) */
const QIYU_MAX_INTERVAL = 14 * 60 * 60 * 1000;

// ==================== 模块级共享状态（单例） ====================

const qiyuAvailable = ref(false);
const isCheckingQiyu = ref(false);
const jdAvailable = ref(false);
const isCheckingJd = ref(false);

// ==================== 工具函数 ====================

/**
 * 生成随机检测间隔（10-14小时）
 */
function getRandomCheckInterval(): number {
  return QIYU_MIN_INTERVAL + Math.random() * (QIYU_MAX_INTERVAL - QIYU_MIN_INTERVAL);
}

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
      console.log('[七鱼检测] 在冷却期内，使用缓存结果:', qiyuAvailable.value);
      return;
    }
  }

  isCheckingQiyu.value = true;
  try {
    qiyuAvailable.value = await invoke('check_qiyu_available');

    // 更新检测状态
    const updatedStatus: SyncStatus = syncStatus || {
      configLastSync: null,
      configSyncResult: null,
      historyLastSync: null,
      historySyncResult: null
    };

    updatedStatus.qiyuCheckStatus = {
      lastCheckTime: now,
      lastCheckResult: qiyuAvailable.value,
      nextCheckTime: qiyuAvailable.value ? now + getRandomCheckInterval() : null
    };

    await syncStatusStore.set('status', updatedStatus);
    await syncStatusStore.save();

    console.log(`[七鱼检测] 检测完成，结果: ${qiyuAvailable.value ? '可用' : '不可用'}`);
  } catch (e) {
    qiyuAvailable.value = false;
    console.error('[七鱼检测] 检测失败:', e);
  } finally {
    isCheckingQiyu.value = false;
  }
}

/**
 * 京东可用性检测
 */
async function checkJdAvailable(): Promise<void> {
  isCheckingJd.value = true;
  try {
    jdAvailable.value = await invoke('check_jd_available');
  } catch (e) {
    jdAvailable.value = false;
    console.error('[京东检测] 检测失败:', e);
  } finally {
    isCheckingJd.value = false;
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

  let syncStatus: SyncStatus | null = initialSyncStatus || null;

  // 如果没有提供，从存储加载
  if (!syncStatus) {
    try {
      syncStatus = await syncStatusStore.get<SyncStatus>('status');
    } catch (e) {
      console.error('[服务检测] 加载同步状态失败:', e);
    }
  }

  const now = Date.now();
  const lastJdCheck = syncStatus?.lastJdCheck ?? 0;
  const needCooldownCheck = (now - lastJdCheck) > JD_CHECK_COOLDOWN;

  // 并发检测
  await Promise.all([
    checkQiyuAvailability(false),  // 使用智能检测
    needCooldownCheck ? checkJdAvailable() : Promise.resolve()
  ]);

  // 如果执行了京东检测，更新最后检测时间
  if (needCooldownCheck) {
    const updatedStatus: SyncStatus = syncStatus || {
      configLastSync: null,
      configSyncResult: null,
      historyLastSync: null,
      historySyncResult: null
    };
    updatedStatus.lastJdCheck = now;
    await syncStatusStore.set('status', updatedStatus);
    await syncStatusStore.save();
  }
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

    // 工具函数
    getRandomCheckInterval
  };
}
