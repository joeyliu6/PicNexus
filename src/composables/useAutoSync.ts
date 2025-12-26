// src/composables/useAutoSync.ts
// 自动同步调度 Composable
// v2.10: 支持定时自动同步 WebDAV 配置和历史记录

import { ref, computed, onMounted, onUnmounted, watch, type Ref, type ComputedRef } from 'vue';
import { useWebDAVSync } from './useWebDAVSync';
import type { WebDAVProfile } from '../config/types';

// ==================== 类型定义 ====================

/**
 * 自动同步配置
 */
export interface AutoSyncConfig {
  /** 是否启用自动同步 */
  enabled: boolean;
  /** 同步间隔（分钟） */
  intervalMinutes: number;
}

/**
 * 自动同步选项
 */
export interface AutoSyncOptions {
  /** 同步间隔（毫秒），默认 30 分钟 */
  interval?: number;
  /** 是否在启动时立即同步 */
  syncOnMount?: boolean;
  /** 是否同步配置 */
  syncSettings?: boolean;
  /** 是否同步历史记录 */
  syncHistory?: boolean;
}

/**
 * 自动同步状态
 */
export interface AutoSyncState {
  /** 是否已启用 */
  isEnabled: boolean;
  /** 上次自动同步时间 */
  lastAutoSync: Date | null;
  /** 下次自动同步时间 */
  nextAutoSync: Date | null;
  /** 是否正在同步 */
  isSyncing: boolean;
  /** 上次同步结果 */
  lastResult: 'success' | 'partial' | 'failed' | null;
  /** 上次同步错误信息 */
  lastError: string | null;
}

// ==================== 默认配置 ====================

const DEFAULT_INTERVAL = 30 * 60 * 1000; // 30 分钟
const MIN_INTERVAL = 5 * 60 * 1000;      // 最小 5 分钟
const MAX_INTERVAL = 24 * 60 * 60 * 1000; // 最大 24 小时

// ==================== 主 Composable ====================

/**
 * 自动同步调度 Composable
 *
 * @param getActiveProfile 获取当前活动的 WebDAV 配置的函数
 * @param options 自动同步选项
 *
 * @example
 * ```typescript
 * const { isEnabled, lastAutoSync, start, stop } = useAutoSync(
 *   () => activeWebDAVProfile.value,
 *   { interval: 30 * 60 * 1000, syncOnMount: false }
 * );
 *
 * // 启动自动同步
 * start();
 *
 * // 手动触发一次同步
 * await syncNow();
 *
 * // 停止自动同步
 * stop();
 * ```
 */
export function useAutoSync(
  getActiveProfile: () => WebDAVProfile | null,
  options: AutoSyncOptions = {}
) {
  const {
    interval = DEFAULT_INTERVAL,
    syncOnMount = false,
    syncSettings = true,
    syncHistory = true
  } = options;

  // 确保间隔在合理范围内
  const safeInterval = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, interval));

  // 使用 WebDAV 同步 composable
  const {
    uploadSettings,
    uploadHistory,
    isSyncing: webdavSyncing
  } = useWebDAVSync();

  // 状态
  const isEnabled = ref(false);
  const lastAutoSync: Ref<Date | null> = ref(null);
  const nextAutoSync: Ref<Date | null> = ref(null);
  const lastResult: Ref<'success' | 'partial' | 'failed' | null> = ref(null);
  const lastError: Ref<string | null> = ref(null);
  const isSyncing = ref(false);

  // 定时器 ID
  let timerId: ReturnType<typeof setTimeout> | null = null;

  /**
   * 计算下次同步时间
   */
  function calculateNextSyncTime(): Date {
    return new Date(Date.now() + safeInterval);
  }

  /**
   * 执行自动同步
   */
  async function performAutoSync(): Promise<void> {
    const profile = getActiveProfile();
    if (!profile) {
      console.log('[自动同步] 没有活动的 WebDAV 配置，跳过同步');
      lastResult.value = null;
      return;
    }

    if (webdavSyncing.value || isSyncing.value) {
      console.log('[自动同步] 正在同步中，跳过本次同步');
      return;
    }

    console.log('[自动同步] 开始执行自动同步...');
    isSyncing.value = true;
    lastError.value = null;

    let settingsSuccess = true;
    let historySuccess = true;
    const errors: string[] = [];

    try {
      // 同步配置
      if (syncSettings) {
        const settingsResult = await uploadSettings(profile);
        settingsSuccess = settingsResult.success;
        if (!settingsSuccess) {
          errors.push(`配置: ${settingsResult.message}`);
        }
      }

      // 同步历史记录
      if (syncHistory) {
        const historyResult = await uploadHistory(profile, { mode: 'merge' });
        historySuccess = historyResult.success;
        if (!historySuccess) {
          errors.push(`历史记录: ${historyResult.message}`);
        }
      }

      // 更新状态
      lastAutoSync.value = new Date();

      if (settingsSuccess && historySuccess) {
        lastResult.value = 'success';
        console.log('[自动同步] 同步完成');
      } else if (settingsSuccess || historySuccess) {
        lastResult.value = 'partial';
        lastError.value = errors.join('; ');
        console.warn('[自动同步] 部分同步成功:', lastError.value);
      } else {
        lastResult.value = 'failed';
        lastError.value = errors.join('; ');
        console.error('[自动同步] 同步失败:', lastError.value);
      }
    } catch (e) {
      lastResult.value = 'failed';
      lastError.value = e instanceof Error ? e.message : String(e);
      console.error('[自动同步] 同步异常:', lastError.value);
    } finally {
      isSyncing.value = false;

      // 如果仍然启用，安排下次同步
      if (isEnabled.value) {
        scheduleNextSync();
      }
    }
  }

  /**
   * 安排下次同步
   */
  function scheduleNextSync(): void {
    // 清除现有定时器
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }

    // 设置新的定时器
    nextAutoSync.value = calculateNextSyncTime();
    timerId = setTimeout(() => {
      performAutoSync();
    }, safeInterval);

    console.log(`[自动同步] 下次同步时间: ${nextAutoSync.value.toLocaleString()}`);
  }

  /**
   * 启动自动同步
   */
  function start(): void {
    if (isEnabled.value) {
      console.log('[自动同步] 已经启动，忽略重复调用');
      return;
    }

    const profile = getActiveProfile();
    if (!profile) {
      console.warn('[自动同步] 无法启动：没有活动的 WebDAV 配置');
      return;
    }

    isEnabled.value = true;
    scheduleNextSync();
    console.log(`[自动同步] 已启动，间隔 ${safeInterval / 1000 / 60} 分钟`);
  }

  /**
   * 停止自动同步
   */
  function stop(): void {
    if (!isEnabled.value) {
      return;
    }

    isEnabled.value = false;
    nextAutoSync.value = null;

    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }

    console.log('[自动同步] 已停止');
  }

  /**
   * 立即执行一次同步
   */
  async function syncNow(): Promise<void> {
    await performAutoSync();
  }

  /**
   * 更新同步间隔
   */
  function updateInterval(newIntervalMinutes: number): void {
    const newInterval = newIntervalMinutes * 60 * 1000;
    const safeNewInterval = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, newInterval));

    if (isEnabled.value) {
      // 重新安排同步
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      nextAutoSync.value = new Date(Date.now() + safeNewInterval);
      timerId = setTimeout(() => {
        performAutoSync();
      }, safeNewInterval);
    }

    console.log(`[自动同步] 间隔已更新为 ${safeNewInterval / 1000 / 60} 分钟`);
  }

  /**
   * 获取剩余时间（秒）
   */
  const remainingSeconds = computed(() => {
    if (!nextAutoSync.value) return null;
    const remaining = Math.max(0, nextAutoSync.value.getTime() - Date.now());
    return Math.ceil(remaining / 1000);
  });

  /**
   * 获取格式化的剩余时间
   */
  const remainingTimeFormatted = computed(() => {
    const seconds = remainingSeconds.value;
    if (seconds === null) return null;

    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (minutes > 0) {
      return `${minutes}分${secs}秒`;
    }
    return `${secs}秒`;
  });

  // 组件挂载时
  onMounted(() => {
    if (syncOnMount) {
      performAutoSync();
    }
  });

  // 组件卸载时
  onUnmounted(() => {
    stop();
  });

  // 返回
  return {
    // 状态
    isEnabled: computed(() => isEnabled.value),
    lastAutoSync: computed(() => lastAutoSync.value),
    nextAutoSync: computed(() => nextAutoSync.value),
    lastResult: computed(() => lastResult.value),
    lastError: computed(() => lastError.value),
    isSyncing: computed(() => isSyncing.value),
    remainingSeconds,
    remainingTimeFormatted,

    // 方法
    start,
    stop,
    syncNow,
    updateInterval
  };
}

/**
 * 创建自动同步配置的默认值
 */
export function createDefaultAutoSyncConfig(): AutoSyncConfig {
  return {
    enabled: false,
    intervalMinutes: 30
  };
}
