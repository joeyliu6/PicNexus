import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getHttpFetchMock,
  getVersionMock as getTauriVersionMock,
  resetTauriMocks,
} from '../helpers/tauriMock';

const {
  configStoreGetMock,
  configStoreSetMock,
  configStoreSaveMock,
  loggerMock,
} = vi.hoisted(() => ({
  configStoreGetMock: vi.fn(),
  configStoreSetMock: vi.fn(),
  configStoreSaveMock: vi.fn(),
  loggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

interface StoredEvent {
  name: 'first_run' | 'app_start';
  params: {
    session_id: string;
    engagement_time_msec: 100;
    app_version: string;
    os_info: 'Windows' | 'macOS' | 'Linux' | 'Unknown';
    app_platform: 'tauri_desktop';
  };
}

interface StoredBatch {
  timestampMicros: number;
  events: StoredEvent[];
}

interface StoredAnalyticsData {
  clientId: string;
  sessionId: string;
  lastActiveTime: number;
  pendingBatches?: StoredBatch[];
}

let httpFetchMock: ReturnType<typeof getHttpFetchMock>;
let appVersionMock: ReturnType<typeof getTauriVersionMock>;
let storeState: Record<string, unknown>;

vi.mock('@/store/instances', () => ({
  configStore: {
    get: configStoreGetMock,
    set: configStoreSetMock,
    save: configStoreSaveMock,
  },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => loggerMock,
}));

async function importFreshAnalytics() {
  vi.resetModules();
  return import('@/composables/useAnalytics');
}

function setStoreState(value: Record<string, unknown>): void {
  storeState = structuredClone(value);
  configStoreGetMock.mockImplementation(async (key: string) => (
    structuredClone(storeState[key])
  ));
  configStoreSetMock.mockImplementation(async (key: string, data: unknown) => {
    storeState[key] = structuredClone(data);
  });
}

function getStoredAnalyticsData(): StoredAnalyticsData {
  return storeState.analytics_data as StoredAnalyticsData;
}

function mockNavigatorPlatform(platform: string): void {
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: platform,
  });
  Object.defineProperty(navigator, 'userAgentData', {
    configurable: true,
    value: undefined,
  });
}

function createStoredEvent(
  name: StoredEvent['name'],
  sessionId: string,
  appVersion = '1.1.0',
): StoredEvent {
  return {
    name,
    params: {
      session_id: sessionId,
      engagement_time_msec: 100,
      app_version: appVersion,
      os_info: 'Windows',
      app_platform: 'tauri_desktop',
    },
  };
}

function createStoredBatch(timestampMs: number, name: StoredEvent['name'] = 'app_start'): StoredBatch {
  return {
    timestampMicros: timestampMs * 1000,
    events: [createStoredEvent(name, timestampMs.toString())],
  };
}

function getAnalyticsFetchCall(index = 0) {
  const call = httpFetchMock.mock.calls[index];
  if (!call) throw new Error(`Expected analytics fetch call #${index + 1}`);

  const [url, request] = call;
  if (!request || typeof request.body !== 'string') {
    throw new Error(`Expected analytics fetch call #${index + 1} to include a JSON body`);
  }

  return {
    payload: JSON.parse(request.body),
    request,
    url: String(url),
  };
}

async function waitForQueueLength(length: number): Promise<void> {
  await vi.waitFor(() => {
    expect(getStoredAnalyticsData().pendingBatches).toHaveLength(length);
  });
}

describe('useAnalytics', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetTauriMocks();
    vi.clearAllMocks();

    httpFetchMock = getHttpFetchMock();
    appVersionMock = getTauriVersionMock();
    configStoreSaveMock.mockResolvedValue(undefined);
    httpFetchMock.mockResolvedValue({ status: 204 } as never);
    appVersionMock.mockResolvedValue('1.2.3');
    mockNavigatorPlatform('Win32');
    setStoreState({
      config: { analytics: { enabled: true } },
    });
  });

  it('clears pending events without creating an identity when analytics is disabled', async () => {
    setStoreState({
      config: { analytics: { enabled: false } },
      analytics_data: {
        clientId: '123456789.1699999999',
        sessionId: '1700000000000',
        lastActiveTime: 1700000000000,
        pendingBatches: [createStoredBatch(1700000000000)],
      },
    });

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await expect(analytics.initialize()).resolves.toBe(false);

    expect(analytics.isEnabled.value).toBe(false);
    expect(analytics.isInitialized.value).toBe(false);
    expect(getStoredAnalyticsData().clientId).toBe('123456789.1699999999');
    expect(getStoredAnalyticsData().pendingBatches).toEqual([]);
    expect(httpFetchMock).not.toHaveBeenCalled();
  });

  it('persists and sends first_run plus app_start in one request', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const { GA_EVENTS, useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await expect(analytics.initialize()).resolves.toBe(true);
    await vi.waitFor(() => expect(httpFetchMock).toHaveBeenCalledTimes(1));
    await waitForQueueLength(0);

    const { payload, request, url } = getAnalyticsFetchCall();
    expect(url).toContain('https://www.google-analytics.com/mp/collect');
    expect(request).toMatchObject({
      method: 'POST',
      connectTimeout: 5000,
    });
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(payload).toMatchObject({
      client_id: '1073741824.1700000000',
      timestamp_micros: 1700000000000000,
      events: [
        {
          name: GA_EVENTS.FIRST_RUN,
          params: {
            session_id: '1700000000000',
            engagement_time_msec: 100,
            app_version: '1.2.3',
            os_info: 'Windows',
            app_platform: 'tauri_desktop',
          },
        },
        {
          name: GA_EVENTS.APP_START,
          params: {
            session_id: '1700000000000',
            app_version: '1.2.3',
            os_info: 'Windows',
          },
        },
      ],
    });
    expect(loggerMock.info).toHaveBeenCalledWith(
      'GA4 请求已接受: events=first_run,app_start, status=204',
    );
    const loggedContent = JSON.stringify(Object.values(loggerMock).flatMap(mock => mock.mock.calls));
    expect(loggedContent).not.toContain('1073741824.1700000000');
    expect(loggedContent).not.toContain('google-analytics.com');
    expect(loggedContent).not.toContain('api_secret');
    expect(analytics).not.toHaveProperty('trackEvent');
  });

  it('reuses a stored identity and only sends app_start', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000010000);
    setStoreState({
      config: { analytics: { enabled: true } },
      analytics_data: {
        clientId: '123456789.1699999999',
        sessionId: '1700000000000',
        lastActiveTime: 1700000000000,
      },
    });

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await expect(analytics.initialize()).resolves.toBe(true);
    await vi.waitFor(() => expect(httpFetchMock).toHaveBeenCalledTimes(1));
    await waitForQueueLength(0);

    const { payload } = getAnalyticsFetchCall();
    expect(payload.client_id).toBe('123456789.1699999999');
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      name: 'app_start',
      params: {
        session_id: '1700000000000',
        app_version: '1.2.3',
        os_info: 'Windows',
      },
    });
  });

  it('migrates a legacy UUID without emitting first_run', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000010000);
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    setStoreState({
      config: { analytics: { enabled: true } },
      analytics_data: {
        clientId: '88888888-8888-4888-8888-888888888888',
        sessionId: '1700000000000',
        lastActiveTime: 1700000000000,
      },
    });

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await expect(analytics.initialize()).resolves.toBe(true);
    await vi.waitFor(() => expect(httpFetchMock).toHaveBeenCalledTimes(1));

    expect(getAnalyticsFetchCall().payload.client_id).toBe('536870912.1700000010');
    expect(getAnalyticsFetchCall().payload.events.map((event: StoredEvent) => event.name))
      .toEqual(['app_start']);
    expect(loggerMock.debug).toHaveBeenCalledWith('已迁移旧版 Analytics 标识');
  });

  it('keeps failed batches and retries them oldest-first on the next process start', async () => {
    const oldStart = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(1700001000000);
    setStoreState({
      config: { analytics: { enabled: true } },
      analytics_data: {
        clientId: '123456789.1699999999',
        sessionId: oldStart.toString(),
        lastActiveTime: oldStart,
        pendingBatches: [createStoredBatch(oldStart)],
      },
    });
    httpFetchMock.mockResolvedValue({ status: 500 } as never);

    const firstProcess = await importFreshAnalytics();
    await expect(firstProcess.useAnalytics().initialize()).resolves.toBe(true);
    await vi.waitFor(() => expect(httpFetchMock).toHaveBeenCalledTimes(1));

    expect(getAnalyticsFetchCall().payload.timestamp_micros).toBe(oldStart * 1000);
    expect(getStoredAnalyticsData().pendingBatches).toHaveLength(2);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'GA4 请求未接受: events=app_start, status=500；事件保留待下次启动补发',
    );

    httpFetchMock.mockClear();
    loggerMock.info.mockClear();
    httpFetchMock.mockResolvedValue({ status: 204 } as never);
    vi.spyOn(Date, 'now').mockReturnValue(1700002000000);

    const secondProcess = await importFreshAnalytics();
    await expect(secondProcess.useAnalytics().initialize()).resolves.toBe(true);
    await vi.waitFor(() => expect(httpFetchMock).toHaveBeenCalledTimes(3));
    await waitForQueueLength(0);

    const timestamps = httpFetchMock.mock.calls.map((_, index) => (
      getAnalyticsFetchCall(index).payload.timestamp_micros
    ));
    expect(timestamps).toEqual([
      oldStart * 1000,
      1700001000000 * 1000,
      1700002000000 * 1000,
    ]);
    expect(loggerMock.info).toHaveBeenCalledTimes(3);
  });

  it('aborts an in-flight request and clears the queue when disabled', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    let requestSignal: AbortSignal | undefined;
    httpFetchMock.mockImplementation((_url, request) => new Promise((_resolve, reject) => {
      requestSignal = request?.signal ?? undefined;
      requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await expect(analytics.initialize()).resolves.toBe(true);
    await vi.waitFor(() => expect(httpFetchMock).toHaveBeenCalledTimes(1));
    await analytics.disable();

    expect(requestSignal?.aborted).toBe(true);
    expect(analytics.isEnabled.value).toBe(false);
    expect((storeState.config as { analytics: { enabled: boolean } }).analytics.enabled).toBe(false);
    expect(getStoredAnalyticsData().pendingBatches).toEqual([]);
    expect(loggerMock.info).not.toHaveBeenCalled();
  });

  it('initializes only once when called concurrently', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await expect(Promise.all([
      analytics.initialize(),
      analytics.initialize(),
      analytics.initialize(),
    ])).resolves.toEqual([true, true, true]);
    await vi.waitFor(() => expect(httpFetchMock).toHaveBeenCalledTimes(1));
    await waitForQueueLength(0);
  });

  it('uses unknown version and normalized OS values without blocking delivery', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    appVersionMock.mockRejectedValue(new Error('version unavailable'));
    mockNavigatorPlatform('FreeBSD');

    const { normalizeOsInfo, useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await expect(analytics.initialize()).resolves.toBe(true);
    await vi.waitFor(() => expect(httpFetchMock).toHaveBeenCalledTimes(1));

    expect(getAnalyticsFetchCall().payload.events[0].params).toMatchObject({
      app_version: 'unknown',
      os_info: 'Unknown',
    });
    expect(normalizeOsInfo('MacIntel')).toBe('macOS');
    expect(normalizeOsInfo('darwin')).toBe('macOS');
    expect(normalizeOsInfo('Linux x86_64')).toBe('Linux');
    expect(normalizeOsInfo(undefined)).toBe('Unknown');
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('uses unknown when the Tauri version is empty', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    appVersionMock.mockResolvedValue('   ');

    const { useAnalytics } = await importFreshAnalytics();
    await expect(useAnalytics().initialize()).resolves.toBe(true);
    await vi.waitFor(() => expect(httpFetchMock).toHaveBeenCalledTimes(1));

    expect(getAnalyticsFetchCall().payload.events[0].params.app_version).toBe('unknown');
    expect(loggerMock.warn).toHaveBeenCalledWith('应用版本为空，使用 unknown');
  });

  it('aborts after five seconds and retains the event for the next launch', async () => {
    vi.useFakeTimers();
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    httpFetchMock.mockImplementation((_url, request) => new Promise((_resolve, reject) => {
      request?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
      );
    }));

    const { useAnalytics } = await importFreshAnalytics();
    await expect(useAnalytics().initialize()).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(httpFetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(loggerMock.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('GA4 请求超时'),
    );

    await vi.advanceTimersByTimeAsync(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'GA4 请求超时: events=first_run,app_start；事件保留待下次启动补发',
    );
    expect(getStoredAnalyticsData().pendingBatches).toHaveLength(1);
  });

  it('drops expired and malformed batches and caps the queue at 50 events', async () => {
    const now = 1701000000000;
    const withinWindow = now - (60 * 60 * 1000);
    const batches: unknown[] = [
      createStoredBatch(now - (72 * 60 * 60 * 1000) - 1),
      { timestampMicros: 'invalid', events: [] },
      {
        timestampMicros: (withinWindow + 500) * 1000,
        events: [
          createStoredEvent('app_start', withinWindow.toString()),
          createStoredEvent('app_start', withinWindow.toString()),
        ],
      },
      {
        timestampMicros: withinWindow * 1000,
        events: [
          createStoredEvent('first_run', withinWindow.toString()),
          createStoredEvent('app_start', withinWindow.toString()),
        ],
      },
      ...Array.from({ length: 55 }, (_, index) => (
        createStoredBatch(withinWindow + ((index + 1) * 1000))
      )),
    ];
    vi.spyOn(Date, 'now').mockReturnValue(now);
    setStoreState({
      config: { analytics: { enabled: true } },
      analytics_data: {
        clientId: '123456789.1699999999',
        sessionId: withinWindow.toString(),
        lastActiveTime: withinWindow,
        pendingBatches: batches,
      },
    });
    httpFetchMock.mockResolvedValue({ status: 500 } as never);

    const { useAnalytics } = await importFreshAnalytics();
    await expect(useAnalytics().initialize()).resolves.toBe(true);
    await vi.waitFor(() => expect(httpFetchMock).toHaveBeenCalledTimes(1));

    const pending = getStoredAnalyticsData().pendingBatches ?? [];
    expect(pending.flatMap(batch => batch.events)).toHaveLength(50);
    expect(pending.flatMap(batch => batch.events).filter(event => event.name === 'first_run'))
      .toHaveLength(1);
    expect(pending.some(batch => batch.timestampMicros === now * 1000)).toBe(true);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '已丢弃 3 个无效或超过 72 小时的 Analytics 批次',
    );
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('Analytics 待发送队列超过 50 个事件'),
    );
  });

  it('keeps the latest preference when enable and disable overlap', async () => {
    setStoreState({
      config: { analytics: { enabled: false } },
    });
    const defaultGet = configStoreGetMock.getMockImplementation();
    let releaseFirstRead: ((value: unknown) => void) | undefined;
    let configReadCount = 0;
    configStoreGetMock.mockImplementation(async (key: string) => {
      if (key === 'config' && configReadCount++ === 0) {
        return new Promise(resolve => {
          releaseFirstRead = resolve;
        });
      }
      return defaultGet?.(key);
    });

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    const enabling = analytics.enable();
    await vi.waitFor(() => expect(releaseFirstRead).toBeTypeOf('function'));
    const disabling = analytics.disable();
    releaseFirstRead?.({ analytics: { enabled: false } });
    await Promise.all([enabling, disabling]);

    expect(analytics.isEnabled.value).toBe(false);
    expect((storeState.config as { analytics: { enabled: boolean } }).analytics.enabled).toBe(false);
    expect(httpFetchMock).not.toHaveBeenCalled();
  });

  it('does not send when analytics storage cannot be read', async () => {
    configStoreGetMock.mockImplementation(async (key: string) => {
      if (key === 'config') return { analytics: { enabled: true } };
      throw new Error('store unavailable');
    });

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await expect(analytics.initialize()).resolves.toBe(false);

    expect(analytics.isInitialized.value).toBe(false);
    expect(httpFetchMock).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Analytics 初始化失败，本次启动跳过统计',
      expect.any(Error),
    );
  });

  it('persists enable and disable while preserving other analytics settings', async () => {
    setStoreState({
      config: { analytics: { enabled: false, channel: 'stable' } },
    });

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await analytics.enable();
    await vi.waitFor(() => expect(httpFetchMock).toHaveBeenCalledTimes(1));

    expect((storeState.config as { analytics: Record<string, unknown> }).analytics).toEqual({
      enabled: true,
      channel: 'stable',
    });

    await analytics.disable();
    expect((storeState.config as { analytics: Record<string, unknown> }).analytics).toEqual({
      enabled: false,
      channel: 'stable',
    });
    expect(getStoredAnalyticsData().pendingBatches).toEqual([]);
  });
});
