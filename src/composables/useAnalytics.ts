// Google Analytics 4 Measurement Protocol 实现
// 仅收集桌面应用的首次运行与启动趋势。

import { computed, ref } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { fetch } from '@tauri-apps/plugin-http';
import type { UserConfig } from '../config/types';
import { configStore } from '../store/instances';
import { createLogger } from '../utils/logger';

const log = createLogger('Analytics');

const GA_MEASUREMENT_ID = 'G-E8LW7TS55J';
const GA_API_SECRET = 'RBX8PUEPRKyUpUA6IWp4Bg';
const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_EVENT_AGE_MS = 72 * 60 * 60 * 1000;
const MAX_PENDING_EVENTS = 50;
const MAX_EVENTS_PER_REQUEST = 25;
const MAX_CLIENT_ID_RANDOM_PART = 2_147_483_647;
const GA_CLIENT_ID_PATTERN = /^\d+\.\d+$/;

export const GA_EVENTS = {
  FIRST_RUN: 'first_run',
  APP_START: 'app_start',
} as const;

type LifecycleEventName = typeof GA_EVENTS[keyof typeof GA_EVENTS];
type OsInfo = 'Windows' | 'macOS' | 'Linux' | 'Unknown';

interface LifecycleEventParams {
  session_id: string;
  engagement_time_msec: 100;
  app_version: string;
  os_info: OsInfo;
  app_platform: 'tauri_desktop';
}

interface PendingAnalyticsEvent {
  name: LifecycleEventName;
  params: LifecycleEventParams;
}

interface PendingAnalyticsBatch {
  timestampMicros: number;
  events: PendingAnalyticsEvent[];
}

interface AnalyticsData {
  clientId: string;
  sessionId: string;
  lastActiveTime: number;
  pendingBatches: PendingAnalyticsBatch[];
}

interface LoadedAnalyticsData {
  data: AnalyticsData;
  isFirstRun: boolean;
}

interface AppContext {
  app_version: string;
  os_info: OsInfo;
}

type SendResult = 'accepted' | 'deferred' | 'cancelled';

const isInitialized = ref(false);
const isEnabled = ref(true);

let cachedAppVersion: string | null = null;
let initializationPromise: Promise<boolean> | null = null;
let flushChain: Promise<void> = Promise.resolve();
let activeAbortController: AbortController | null = null;
let operationGeneration = 0;
let hasQueuedAppStartThisProcess = false;

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

function isLifecycleEventName(value: unknown): value is LifecycleEventName {
  return value === GA_EVENTS.FIRST_RUN || value === GA_EVENTS.APP_START;
}

function isOsInfo(value: unknown): value is OsInfo {
  return value === 'Windows'
    || value === 'macOS'
    || value === 'Linux'
    || value === 'Unknown';
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

async function getAppContext(): Promise<AppContext> {
  return {
    app_version: await getAppVersion(),
    os_info: getOsInfo(),
  };
}

function normalizePendingEvent(value: unknown): PendingAnalyticsEvent | null {
  if (!isRecord(value) || !isLifecycleEventName(value.name) || !isRecord(value.params)) {
    return null;
  }

  const params = value.params;
  if (
    typeof params.session_id !== 'string'
    || params.session_id.length === 0
    || params.engagement_time_msec !== 100
    || typeof params.app_version !== 'string'
    || params.app_version.length === 0
    || !isOsInfo(params.os_info)
    || params.app_platform !== 'tauri_desktop'
  ) {
    return null;
  }

  return {
    name: value.name,
    params: {
      session_id: params.session_id,
      engagement_time_msec: 100,
      app_version: params.app_version,
      os_info: params.os_info,
      app_platform: 'tauri_desktop',
    },
  };
}

function normalizePendingBatch(value: unknown, now: number): PendingAnalyticsBatch | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.timestampMicros)) return null;

  const timestampMicros = value.timestampMicros as number;
  const eventTime = timestampMicros / 1000;
  if (timestampMicros <= 0 || now - eventTime > MAX_EVENT_AGE_MS || !Array.isArray(value.events)) {
    return null;
  }

  const events = value.events.map(normalizePendingEvent);
  if (
    events.length === 0
    || events.length > MAX_EVENTS_PER_REQUEST
    || events.some(event => event === null)
  ) {
    return null;
  }

  const normalizedEvents = events as PendingAnalyticsEvent[];
  const appStartCount = normalizedEvents.filter(event => event.name === GA_EVENTS.APP_START).length;
  const firstRunCount = normalizedEvents.filter(event => event.name === GA_EVENTS.FIRST_RUN).length;
  if (appStartCount !== 1 || firstRunCount > 1 || normalizedEvents.length > 2) return null;

  return {
    timestampMicros,
    events: normalizedEvents,
  };
}

function countPendingEvents(batches: PendingAnalyticsBatch[]): number {
  return batches.reduce((count, batch) => count + batch.events.length, 0);
}

function limitPendingBatches(batches: PendingAnalyticsBatch[]): PendingAnalyticsBatch[] {
  const originalEventCount = countPendingEvents(batches);
  if (originalEventCount <= MAX_PENDING_EVENTS) return batches;

  const firstRunBatch = batches.find(batch => (
    batch.events.some(event => event.name === GA_EVENTS.FIRST_RUN)
  ));
  const selected: PendingAnalyticsBatch[] = firstRunBatch ? [firstRunBatch] : [];
  let remaining = MAX_PENDING_EVENTS - countPendingEvents(selected);

  for (let index = batches.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const batch = batches[index];
    if (batch === firstRunBatch || batch.events.length > remaining) continue;
    selected.push(batch);
    remaining -= batch.events.length;
  }

  const limited = selected.sort((left, right) => left.timestampMicros - right.timestampMicros);
  log.warn(
    `Analytics 待发送队列超过 ${MAX_PENDING_EVENTS} 个事件，已丢弃 ${originalEventCount - countPendingEvents(limited)} 个旧事件`,
  );
  return limited;
}

function normalizePendingBatches(value: unknown, now: number): PendingAnalyticsBatch[] {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .map(batch => normalizePendingBatch(batch, now))
    .filter((batch): batch is PendingAnalyticsBatch => batch !== null)
    .sort((left, right) => left.timestampMicros - right.timestampMicros);

  const invalidOrExpiredCount = value.length - normalized.length;
  if (invalidOrExpiredCount > 0) {
    log.warn(`已丢弃 ${invalidOrExpiredCount} 个无效或超过 72 小时的 Analytics 批次`);
  }

  let hasFirstRun = false;
  const deduplicated = normalized.flatMap((batch) => {
    const events = batch.events.filter((event) => {
      if (event.name !== GA_EVENTS.FIRST_RUN) return true;
      if (hasFirstRun) return false;
      hasFirstRun = true;
      return true;
    });
    return events.length > 0 ? [{ ...batch, events }] : [];
  });

  const duplicateCount = countPendingEvents(normalized) - countPendingEvents(deduplicated);
  if (duplicateCount > 0) {
    log.warn(`已丢弃 ${duplicateCount} 个重复的 first_run 事件`);
  }

  return limitPendingBatches(deduplicated);
}

function normalizeAnalyticsData(
  stored: unknown,
  now: number,
  createIfMissing: boolean,
): LoadedAnalyticsData | null {
  if ((stored === null || stored === undefined) && !createIfMissing) return null;

  const record = isRecord(stored) ? stored : {};
  if (record.clientId !== undefined && !isValidClientId(record.clientId)) {
    log.debug('已迁移旧版 Analytics 标识');
  }
  const clientId = isValidClientId(record.clientId)
    ? record.clientId
    : generateClientId(now);
  const sessionId = typeof record.sessionId === 'string' && record.sessionId.length > 0
    ? record.sessionId
    : now.toString();
  const lastActiveTime = typeof record.lastActiveTime === 'number'
    && Number.isFinite(record.lastActiveTime)
    && record.lastActiveTime >= 0
    ? record.lastActiveTime
    : 0;

  return {
    data: {
      clientId,
      sessionId,
      lastActiveTime,
      pendingBatches: normalizePendingBatches(record.pendingBatches, now),
    },
    isFirstRun: stored === null || stored === undefined,
  };
}

function refreshSession(data: AnalyticsData, now: number): void {
  const elapsed = now - data.lastActiveTime;
  if (data.lastActiveTime <= 0 || elapsed < 0 || elapsed >= SESSION_TIMEOUT_MS) {
    data.sessionId = now.toString();
  }
  data.lastActiveTime = now;
}

function createLifecycleEvent(
  name: LifecycleEventName,
  sessionId: string,
  context: AppContext,
): PendingAnalyticsEvent {
  return {
    name,
    params: {
      session_id: sessionId,
      engagement_time_msec: 100,
      app_version: context.app_version,
      os_info: context.os_info,
      app_platform: 'tauri_desktop',
    },
  };
}

function createStartupBatch(
  timestamp: number,
  sessionId: string,
  context: AppContext,
  isFirstRun: boolean,
): PendingAnalyticsBatch {
  const events: PendingAnalyticsEvent[] = [];
  if (isFirstRun) {
    events.push(createLifecycleEvent(GA_EVENTS.FIRST_RUN, sessionId, context));
  }
  events.push(createLifecycleEvent(GA_EVENTS.APP_START, sessionId, context));

  return {
    timestampMicros: timestamp * 1000,
    events,
  };
}

async function persistAnalyticsData(data: AnalyticsData): Promise<void> {
  await configStore.set('analytics_data', data);
  await configStore.save();
}

async function clearPendingBatches(): Promise<void> {
  const stored = await configStore.get<unknown>('analytics_data');
  if (!isRecord(stored)) return;

  await configStore.set('analytics_data', {
    ...stored,
    pendingBatches: [],
  });
  await configStore.save();
}

function isCurrentOperation(generation: number): boolean {
  return generation === operationGeneration && isEnabled.value;
}

async function sendBatch(
  clientId: string,
  batch: PendingAnalyticsBatch,
  generation: number,
): Promise<SendResult> {
  if (!isCurrentOperation(generation)) return 'cancelled';

  const controller = new AbortController();
  activeAbortController = controller;
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const eventNames = batch.events.map(event => event.name).join(',');

  try {
    const response = await fetch(
      `${GA_ENDPOINT}?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          timestamp_micros: batch.timestampMicros,
          events: batch.events,
        }),
        signal: controller.signal,
        connectTimeout: REQUEST_TIMEOUT_MS,
      },
    );

    if (!isCurrentOperation(generation)) return 'cancelled';

    if (response.status >= 200 && response.status < 300) {
      log.info(`GA4 请求已接受: events=${eventNames}, status=${response.status}`);
      return 'accepted';
    }

    log.warn(
      `GA4 请求未接受: events=${eventNames}, status=${response.status}；事件保留待下次启动补发`,
    );
    return 'deferred';
  } catch (error) {
    if (!isCurrentOperation(generation)) {
      log.debug('GA4 请求已取消');
      return 'cancelled';
    }

    if (controller.signal.aborted) {
      log.warn(`GA4 请求超时: events=${eventNames}；事件保留待下次启动补发`);
    } else {
      log.error(`GA4 请求失败: events=${eventNames}；事件保留待下次启动补发`, error);
    }
    return 'deferred';
  } finally {
    clearTimeout(timeoutId);
    if (activeAbortController === controller) activeAbortController = null;
  }
}

async function flushPendingBatches(generation: number): Promise<void> {
  if (!isCurrentOperation(generation)) return;

  try {
    const stored = await configStore.get<unknown>('analytics_data');
    const loaded = normalizeAnalyticsData(stored, Date.now(), false);
    if (!loaded || !isCurrentOperation(generation)) return;

    const data = loaded.data;
    await persistAnalyticsData(data);

    while (data.pendingBatches.length > 0 && isCurrentOperation(generation)) {
      const batch = data.pendingBatches[0];
      const result = await sendBatch(data.clientId, batch, generation);
      if (result !== 'accepted' || !isCurrentOperation(generation)) return;

      data.pendingBatches.shift();
      try {
        await persistAnalyticsData(data);
      } catch (error) {
        log.warn('GA4 请求已接受，但待发送队列清理失败；下次启动可能重复补发', error);
        return;
      }
    }
  } catch (error) {
    log.error('处理 Analytics 待发送队列失败', error);
  }
}

function scheduleFlush(generation: number): void {
  flushChain = flushChain
    .catch(() => undefined)
    .then(() => flushPendingBatches(generation));
}

async function prepareAnalytics(generation: number): Promise<boolean> {
  try {
    const config = await configStore.get<UserConfig>('config');
    if (generation !== operationGeneration) return false;

    if (config?.analytics?.enabled === false) {
      isEnabled.value = false;
      isInitialized.value = false;
      activeAbortController?.abort();
      try {
        await clearPendingBatches();
      } catch (error) {
        log.error('禁用状态下清理 Analytics 待发送队列失败', error);
      }
      return false;
    }

    isEnabled.value = true;
    const now = Date.now();
    const stored = await configStore.get<unknown>('analytics_data');
    if (!isCurrentOperation(generation)) return false;

    const loaded = normalizeAnalyticsData(stored, now, true);
    if (!loaded) return false;

    const data = loaded.data;
    refreshSession(data, now);
    const context = await getAppContext();
    if (!isCurrentOperation(generation)) return false;

    if (!hasQueuedAppStartThisProcess) {
      data.pendingBatches.push(
        createStartupBatch(now, data.sessionId, context, loaded.isFirstRun),
      );
      data.pendingBatches = limitPendingBatches(data.pendingBatches);
    }

    await persistAnalyticsData(data);
    if (!isCurrentOperation(generation)) return false;

    hasQueuedAppStartThisProcess = true;
    isInitialized.value = true;
    log.debug('Measurement Protocol 本地初始化成功');

    scheduleFlush(generation);
    return true;
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
  const config = await configStore.get<UserConfig>('config');
  if (!config || generation !== operationGeneration) return false;

  config.analytics = { ...config.analytics, enabled };
  await configStore.set('config', config);
  await configStore.save();
  return generation === operationGeneration;
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
      const persisted = await persistPreference(true, generation);
      if (!persisted) return;

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
    activeAbortController?.abort();

    try {
      await persistPreference(false, generation);
    } catch (error) {
      log.error('保存 Analytics 禁用设置失败', error);
    }

    if (generation !== operationGeneration) return;

    try {
      await clearPendingBatches();
      if (generation === operationGeneration) log.debug('已禁用并清空待发送事件');
    } catch (error) {
      log.error('清空 Analytics 待发送队列失败', error);
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
