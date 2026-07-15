import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getInvokeMock,
  getVersionMock,
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

interface StoredAnalyticsDataV2 {
  schemaVersion: 2;
  clientId: string;
  firstRunPending: boolean;
}

interface SentBatch {
  clientId: string;
  events: Array<{
    name: 'first_run' | 'app_start';
    params: {
      appVersion: string;
      osInfo: 'Windows' | 'macOS' | 'Linux' | 'Unknown';
      appPlatform: 'tauri_desktop';
    };
  }>;
}

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

function getStoredAnalyticsData(): StoredAnalyticsDataV2 {
  return storeState.analytics_data as StoredAnalyticsDataV2;
}

function getSentBatches(): SentBatch[] {
  return getInvokeMock().mock.calls
    .filter(([command]) => command === 'analytics_send_batch')
    .map(([, args]) => (args as { batch: SentBatch }).batch);
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

function legacyEvent(name: 'first_run' | 'app_start'): Record<string, unknown> {
  return {
    name,
    params: {
      session_id: '1700000000000',
      engagement_time_msec: 100,
      app_version: '1.0.0',
      os_info: 'Windows',
      app_platform: 'tauri_desktop',
    },
  };
}

describe('useAnalytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetTauriMocks();
    vi.clearAllMocks();

    configStoreSaveMock.mockResolvedValue(undefined);
    getVersionMock().mockResolvedValue('1.2.3');
    getInvokeMock().mockImplementation(async (command) => (
      command === 'analytics_send_batch' ? 'processed' : undefined
    ));
    mockNavigatorPlatform('Win32');
    setStoreState({
      config: { analytics: { enabled: true } },
    });
  });

  it('creates v2 state and sends first_run plus app_start for a new install', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await expect(analytics.initialize()).resolves.toBe(true);

    expect(getStoredAnalyticsData()).toEqual({
      schemaVersion: 2,
      clientId: '1073741824.1700000000',
      firstRunPending: false,
    });
    expect(getSentBatches()).toEqual([{
      clientId: '1073741824.1700000000',
      events: [
        {
          name: 'first_run',
          params: {
            appVersion: '1.2.3',
            osInfo: 'Windows',
            appPlatform: 'tauri_desktop',
          },
        },
        {
          name: 'app_start',
          params: {
            appVersion: '1.2.3',
            osInfo: 'Windows',
            appPlatform: 'tauri_desktop',
          },
        },
      ],
    }]);
    expect(analytics).not.toHaveProperty('trackEvent');
  });

  it('reuses a valid v2 identity and sends only the current app_start', async () => {
    setStoreState({
      config: { analytics: { enabled: true } },
      analytics_data: {
        schemaVersion: 2,
        clientId: '123456789.1699999999',
        firstRunPending: false,
      },
    });

    const { useAnalytics } = await importFreshAnalytics();
    await expect(useAnalytics().initialize()).resolves.toBe(true);

    expect(getSentBatches()).toHaveLength(1);
    expect(getSentBatches()[0].clientId).toBe('123456789.1699999999');
    expect(getSentBatches()[0].events.map(event => event.name)).toEqual(['app_start']);
  });

  it('migrates a legacy pending first_run and drops historical app_start data', async () => {
    setStoreState({
      config: { analytics: { enabled: true } },
      analytics_data: {
        clientId: '123456789.1699999999',
        sessionId: '1699999999000',
        lastActiveTime: 1_699_999_999_000,
        pendingBatches: [
          { events: [legacyEvent('app_start')] },
          { events: [legacyEvent('first_run'), legacyEvent('app_start')] },
        ],
      },
    });

    const { useAnalytics } = await importFreshAnalytics();
    await expect(useAnalytics().initialize()).resolves.toBe(true);

    expect(getSentBatches()[0].events.map(event => event.name)).toEqual([
      'first_run',
      'app_start',
    ]);
    expect(getStoredAnalyticsData()).toEqual({
      schemaVersion: 2,
      clientId: '123456789.1699999999',
      firstRunPending: false,
    });
  });

  it('replaces a damaged existing identity without inventing first_run', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_010_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    setStoreState({
      config: { analytics: { enabled: true } },
      analytics_data: {
        schemaVersion: 2,
        clientId: '12345678901234567.1699999999',
        firstRunPending: false,
        pendingBatches: [{ events: [{ name: 'first_run' }] }],
      },
    });

    const { useAnalytics } = await importFreshAnalytics();
    await expect(useAnalytics().initialize()).resolves.toBe(true);

    expect(getStoredAnalyticsData().clientId).toBe('536870912.1700000010');
    expect(getSentBatches()[0].events.map(event => event.name)).toEqual(['app_start']);
  });

  it('keeps first_run pending after a failed batch and retries it next launch', async () => {
    getInvokeMock().mockRejectedValueOnce(new Error('transport unavailable'));

    const firstModule = await importFreshAnalytics();
    await expect(firstModule.useAnalytics().initialize()).resolves.toBe(true);

    expect(getStoredAnalyticsData().firstRunPending).toBe(true);
    expect(getSentBatches()[0].events.map(event => event.name)).toEqual([
      'first_run',
      'app_start',
    ]);

    getInvokeMock().mockResolvedValue('processed');
    const nextModule = await importFreshAnalytics();
    await expect(nextModule.useAnalytics().initialize()).resolves.toBe(true);

    expect(getSentBatches()[1].events.map(event => event.name)).toEqual([
      'first_run',
      'app_start',
    ]);
    expect(getStoredAnalyticsData().firstRunPending).toBe(false);
  });

  it('does not persist a failed app_start for cross-launch replay', async () => {
    setStoreState({
      config: { analytics: { enabled: true } },
      analytics_data: {
        schemaVersion: 2,
        clientId: '123456789.1699999999',
        firstRunPending: false,
      },
    });
    getInvokeMock().mockRejectedValueOnce(new Error('transport unavailable'));

    const { useAnalytics } = await importFreshAnalytics();
    await expect(useAnalytics().initialize()).resolves.toBe(true);

    expect(getStoredAnalyticsData()).toEqual({
      schemaVersion: 2,
      clientId: '123456789.1699999999',
      firstRunPending: false,
    });
    expect(getSentBatches()[0].events.map(event => event.name)).toEqual(['app_start']);
  });

  it('migrates and clears legacy retry state when analytics is disabled', async () => {
    setStoreState({
      config: { analytics: { enabled: false } },
      analytics_data: {
        clientId: '123456789.1699999999',
        pendingBatches: [{ events: [legacyEvent('first_run')] }],
      },
    });

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();
    await expect(analytics.initialize()).resolves.toBe(false);

    expect(analytics.isEnabled.value).toBe(false);
    expect(analytics.isInitialized.value).toBe(false);
    expect(getStoredAnalyticsData()).toEqual({
      schemaVersion: 2,
      clientId: '123456789.1699999999',
      firstRunPending: false,
    });
    expect(getInvokeMock()).toHaveBeenCalledWith('analytics_shutdown');
    expect(getSentBatches()).toEqual([]);
  });

  it('cancels an in-flight startup batch when disabled', async () => {
    let releaseBatch: (() => void) | undefined;
    getInvokeMock().mockImplementation(async (command) => {
      if (command === 'analytics_send_batch') {
        return new Promise<string>((resolve) => {
          releaseBatch = () => resolve('processed');
        });
      }
      if (command === 'analytics_shutdown') releaseBatch?.();
      return undefined;
    });

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();
    const initializing = analytics.initialize();
    await vi.waitFor(() => expect(getSentBatches()).toHaveLength(1));

    await analytics.disable();
    await expect(initializing).resolves.toBe(false);

    expect(analytics.isEnabled.value).toBe(false);
    expect(getStoredAnalyticsData().firstRunPending).toBe(false);
    expect(getInvokeMock()).toHaveBeenCalledWith('analytics_shutdown');
  });

  it('attempts the startup batch only once per process under concurrent initialization', async () => {
    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await expect(Promise.all([
      analytics.initialize(),
      analytics.initialize(),
      analytics.initialize(),
    ])).resolves.toEqual([true, true, true]);

    expect(getSentBatches()).toHaveLength(1);
    await expect(analytics.initialize()).resolves.toBe(true);
    expect(getSentBatches()).toHaveLength(1);
  });

  it('keeps the latest preference when enable and disable overlap', async () => {
    setStoreState({
      config: { analytics: { enabled: false, channel: 'stable' } },
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
    releaseFirstRead?.({ analytics: { enabled: false, channel: 'stable' } });
    await Promise.all([enabling, disabling]);

    expect(analytics.isEnabled.value).toBe(false);
    expect((storeState.config as { analytics: Record<string, unknown> }).analytics).toEqual({
      enabled: false,
      channel: 'stable',
    });
    expect(getSentBatches()).toEqual([]);
  });

  it('serializes delayed preference writes so a later disable wins', async () => {
    setStoreState({
      config: { analytics: { enabled: false } },
    });
    const defaultSet = configStoreSetMock.getMockImplementation();
    let releaseEnableWrite: (() => void) | undefined;
    let configWriteCount = 0;
    configStoreSetMock.mockImplementation(async (key: string, data: unknown) => {
      if (key === 'config' && configWriteCount++ === 0) {
        await new Promise<void>(resolve => {
          releaseEnableWrite = resolve;
        });
      }
      await defaultSet?.(key, data);
    });

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();
    const enabling = analytics.enable();
    await vi.waitFor(() => expect(releaseEnableWrite).toBeTypeOf('function'));
    const disabling = analytics.disable();
    releaseEnableWrite?.();
    await Promise.all([enabling, disabling]);

    expect((storeState.config as { analytics: { enabled: boolean } }).analytics.enabled).toBe(false);
    expect(analytics.isEnabled.value).toBe(false);
  });

  it('normalizes OS values and falls back when the app version is unavailable', async () => {
    getVersionMock().mockRejectedValue(new Error('version unavailable'));
    mockNavigatorPlatform('FreeBSD');

    const { normalizeOsInfo, useAnalytics } = await importFreshAnalytics();
    await expect(useAnalytics().initialize()).resolves.toBe(true);

    expect(getSentBatches()[0].events[0].params).toMatchObject({
      appVersion: 'unknown',
      osInfo: 'Unknown',
    });
    expect(normalizeOsInfo('MacIntel')).toBe('macOS');
    expect(normalizeOsInfo('darwin')).toBe('macOS');
    expect(normalizeOsInfo('Linux x86_64')).toBe('Linux');
    expect(normalizeOsInfo(undefined)).toBe('Unknown');
    expect(loggerMock.warn).toHaveBeenCalled();
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
    expect(getSentBatches()).toEqual([]);
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Analytics 初始化失败，本次启动跳过统计',
      expect.any(Error),
    );
  });
});
