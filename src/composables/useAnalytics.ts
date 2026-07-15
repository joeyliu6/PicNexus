// 仅收集桌面应用的首次运行与启动趋势。

import { computed, ref } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import type { UserConfig } from '../config/types';
import { configStore } from '../store/instances';
import { createLogger } from '../utils/logger';

const log = createLogger('Analytics');

const ANALYTICS_SCHEMA_VERSION = 2;
const MAX_CLIENT_ID_RANDOM_PART = 2_147_483_647;
const GA_CLIENT_ID_PATTERN = /^\d{1,16}\.\d{1,16}$/;

export const GA_EVENTS = {
  FIRST_RUN: 'first_run',
  APP_START: 'app_start',
} as const;

type LifecycleEventName = typeof GA_EVENTS[keyof typeof GA_EVENTS];
type OsInfo = 'Windows' | 'macOS' | 'Linux' | 'Unknown';

interface AnalyticsEventParams {
  appVersion: string;
  osInfo: OsInfo;
  appPlatform: 'tauri_desktop';
}

interface AnalyticsEvent {
  name: LifecycleEventName;
  params: AnalyticsEventParams;
}

interface AnalyticsBatch {
  clientId: string;
  events: AnalyticsEvent[];
}

interface AnalyticsDataV2 {
  schemaVersion: 2;
  clientId: string;
  firstRunPending: boolean;
}

const isInitialized = ref(false);
const isEnabled = ref(true);

let cachedAppVersion: string | null = null;
let initializationPromise: Promise<boolean> | null = null;
let preferenceWriteChain: Promise<void> = Promise.resolve();
let operationGeneration = 0;
let hasAttemptedAppStartThisProcess = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function generateClientId(now = Date.now()): string {
  const randomPart = Math.floor(Math.random() * MAX_CLIENT_ID_RANDOM_PART) + 1;
  return `${randomPart}.${Math.floor(now / 1000)}`;
}

function isValidClientId(value: unknown): value is string {
  return typeof value === 'string' && GA_CLIENT_ID_PATTERN.test(value);
}

function isLegacyOsInfo(value: unknown): value is OsInfo {
  return value === 'Windows'
    || value === 'macOS'
    || value === 'Linux'
    || value === 'Unknown';
}

function isLegacyPendingFirstRun(value: unknown): boolean {
  if (!isRecord(value) || value.name !== GA_EVENTS.FIRST_RUN || !isRecord(value.params)) {
    return false;
  }

  const params = value.params;
  return typeof params.session_id === 'string'
    && params.session_id.length > 0
    && params.engagement_time_msec === 100
    && typeof params.app_version === 'string'
    && params.app_version.length > 0
    && isLegacyOsInfo(params.os_info)
    && params.app_platform === 'tauri_desktop';
}

function legacyHasPendingFirstRun(record: Record<string, unknown>): boolean {
  if (!Array.isArray(record.pendingBatches)) return false;

  return record.pendingBatches.some((batch) => (
    isRecord(batch)
    && Array.isArray(batch.events)
    && batch.events.some(isLegacyPendingFirstRun)
  ));
}

function normalizeAnalyticsData(stored: unknown, now: number): AnalyticsDataV2 {
  const isNewInstall = stored === null || stored === undefined;
  const record = isRecord(stored) ? stored : {};
  const clientId = isValidClientId(record.clientId)
    ? record.clientId
    : generateClientId(now);

  if (record.clientId !== undefined && !isValidClientId(record.clientId)) {
    log.debug('已迁移旧版 Analytics 标识');
  }

  const isCurrentSchema = record.schemaVersion === ANALYTICS_SCHEMA_VERSION
    && typeof record.firstRunPending === 'boolean';
  const firstRunPending = isNewInstall
    || (isCurrentSchema ? record.firstRunPending as boolean : legacyHasPendingFirstRun(record));

  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    clientId,
    firstRunPending,
  };
}

export function normalizeOsInfo(platform: string | null | undefined): OsInfo {
  const value = (platform || '').toLowerCase();

  if (value.includes('mac') || value.includes('darwin')) return 'macOS';
  if (value.includes('win')) return 'Windows';
  if (value.includes('linux')) return 'Linux';
  return 'Unknown';
}

function getOsInfo(): OsInfo {
  if (typeof navigator === 'undefined') return 'Unknown';

  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };
  return normalizeOsInfo(nav.userAgentData?.platform || nav.platform || nav.userAgent);
}

async function getAppVersion(): Promise<string> {
  if (cachedAppVersion) return cachedAppVersion;

  try {
    const version = (await getVersion()).trim();
    if (!version) {
      log.warn('应用版本为空，使用 unknown');
      return 'unknown';
    }
    cachedAppVersion = version;
    return cachedAppVersion;
  } catch (error) {
    log.warn('无法获取应用版本，使用 unknown', error);
    return 'unknown';
  }
}

function createBatch(data: AnalyticsDataV2, appVersion: string): AnalyticsBatch {
  const params: AnalyticsEventParams = {
    appVersion,
    osInfo: getOsInfo(),
    appPlatform: 'tauri_desktop',
  };
  const events: AnalyticsEvent[] = [];
  if (data.firstRunPending) events.push({ name: GA_EVENTS.FIRST_RUN, params });
  events.push({ name: GA_EVENTS.APP_START, params });

  return { clientId: data.clientId, events };
}

async function persistAnalyticsData(data: AnalyticsDataV2): Promise<void> {
  await configStore.set('analytics_data', data);
  await configStore.save();
}

async function clearFirstRunPending(): Promise<void> {
  const stored = await configStore.get<unknown>('analytics_data');
  if (stored === null || stored === undefined) return;

  const data = normalizeAnalyticsData(stored, Date.now());
  data.firstRunPending = false;
  await persistAnalyticsData(data);
}

function isCurrentOperation(generation: number): boolean {
  return generation === operationGeneration && isEnabled.value;
}

async function stopTransport(): Promise<void> {
  try {
    await invoke('analytics_shutdown');
  } catch (error) {
    log.warn('关闭 Analytics 隔离传输失败', error);
  }
}

async function sendStartupBatch(
  data: AnalyticsDataV2,
  generation: number,
): Promise<void> {
  const batch = createBatch(data, await getAppVersion());
  if (!isCurrentOperation(generation)) return;

  hasAttemptedAppStartThisProcess = true;
  try {
    await invoke<'processed'>('analytics_send_batch', { batch });
    if (!isCurrentOperation(generation)) return;

    if (data.firstRunPending) {
      data.firstRunPending = false;
      await persistAnalyticsData(data);
    }
    log.info(`GA4 生命周期事件已交给隔离 Google tag: events=${batch.events.map(event => event.name).join(',')}`);
  } catch (error) {
    if (!isCurrentOperation(generation)) {
      log.debug('Analytics 发送已取消');
      return;
    }
    log.warn('Analytics 本次启动发送失败；app_start 不补发，first_run 将在下次启动重试', error);
  }
}

async function prepareAnalytics(generation: number): Promise<boolean> {
  try {
    const config = await configStore.get<UserConfig>('config');
    if (generation !== operationGeneration) return false;

    if (config?.analytics?.enabled === false) {
      isEnabled.value = false;
      isInitialized.value = false;
      await stopTransport();
      await clearFirstRunPending();
      return false;
    }

    isEnabled.value = true;
    const stored = await configStore.get<unknown>('analytics_data');
    if (!isCurrentOperation(generation)) return false;

    const data = normalizeAnalyticsData(stored, Date.now());
    await persistAnalyticsData(data);
    if (!isCurrentOperation(generation)) return false;

    isInitialized.value = true;
    log.debug('Analytics 本地状态初始化成功');

    if (!hasAttemptedAppStartThisProcess) {
      await sendStartupBatch(data, generation);
    }
    return isCurrentOperation(generation);
  } catch (error) {
    if (generation === operationGeneration) isInitialized.value = false;
    log.error('Analytics 初始化失败，本次启动跳过统计', error);
    return false;
  }
}

async function initializeForGeneration(generation: number): Promise<boolean> {
  while (initializationPromise) {
    await initializationPromise;
    if (generation !== operationGeneration) return false;
    if (isInitialized.value && isEnabled.value) return true;
  }

  if (generation !== operationGeneration) return false;
  const task = prepareAnalytics(generation);
  initializationPromise = task;
  try {
    return await task;
  } finally {
    if (initializationPromise === task) initializationPromise = null;
  }
}

async function persistPreference(enabled: boolean, generation: number): Promise<boolean> {
  let persisted = false;
  const task = preferenceWriteChain
    .catch(() => undefined)
    .then(async () => {
      if (generation !== operationGeneration) return;
      const config = await configStore.get<UserConfig>('config');
      if (!config || generation !== operationGeneration) return;

      config.analytics = { ...config.analytics, enabled };
      await configStore.set('config', config);
      await configStore.save();
      persisted = generation === operationGeneration;
    });
  preferenceWriteChain = task.catch(() => undefined);
  await task;
  return persisted;
}

/**
 * P0 Analytics 服务：只负责首次运行和应用启动趋势。
 */
export function useAnalytics() {
  async function initialize(): Promise<boolean> {
    if (isInitialized.value && isEnabled.value) return true;
    return initializeForGeneration(operationGeneration);
  }

  async function enable(): Promise<void> {
    const generation = ++operationGeneration;
    isEnabled.value = true;
    isInitialized.value = false;

    try {
      if (!await persistPreference(true, generation)) return;
      await initializeForGeneration(generation);
      if (isCurrentOperation(generation)) log.debug('已启用');
    } catch (error) {
      if (generation === operationGeneration) isInitialized.value = false;
      log.error('启用 Analytics 失败', error);
    }
  }

  async function disable(): Promise<void> {
    const generation = ++operationGeneration;
    isEnabled.value = false;
    isInitialized.value = false;

    await stopTransport();
    try {
      await persistPreference(false, generation);
      if (generation !== operationGeneration) return;
      await clearFirstRunPending();
      if (generation === operationGeneration) log.debug('已禁用并清理待发送事件');
    } catch (error) {
      log.error('保存 Analytics 禁用设置失败', error);
    }
  }

  const analyticsEnabled = computed(() => isEnabled.value && isInitialized.value);

  return {
    isInitialized,
    isEnabled,
    analyticsEnabled,
    initialize,
    enable,
    disable,
    GA_EVENTS,
  };
}
