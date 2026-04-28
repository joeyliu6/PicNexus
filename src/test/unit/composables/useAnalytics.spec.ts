import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import {
  getHttpFetchMock,
  getVersionMock as getTauriVersionMock,
  resetTauriMocks,
} from '../../helpers/tauriMock';

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

let httpFetchMock: ReturnType<typeof getHttpFetchMock>;
let appVersionMock: ReturnType<typeof getTauriVersionMock>;

vi.mock('../../../store/instances', () => ({
  configStore: {
    get: configStoreGetMock,
    set: configStoreSetMock,
    save: configStoreSaveMock,
  },
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => loggerMock,
}));

async function importFreshAnalytics() {
  vi.resetModules();
  return import('../../../composables/useAnalytics');
}

function mockConfigStoreGet(data: Record<string, unknown>): void {
  configStoreGetMock.mockImplementation(async (key: string) => data[key]);
}

function getAnalyticsFetchCall(index = 0) {
  const call = httpFetchMock.mock.calls[index];

  if (!call) {
    throw new Error(`Expected analytics fetch call #${index + 1}`);
  }

  const [url, request] = call;

  if (!request) {
    throw new Error(`Expected analytics fetch call #${index + 1} to include request options`);
  }

  if (typeof request.body !== 'string') {
    throw new Error(`Expected analytics fetch call #${index + 1} to include a JSON string body`);
  }

  return {
    payload: JSON.parse(request.body),
    request,
    url: String(url),
  };
}

describe('useAnalytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetTauriMocks();
    vi.clearAllMocks();
    httpFetchMock = getHttpFetchMock();
    appVersionMock = getTauriVersionMock();
    configStoreSetMock.mockResolvedValue(undefined);
    configStoreSaveMock.mockResolvedValue(undefined);
    httpFetchMock.mockResolvedValue({ status: 204 } as never);
    appVersionMock.mockResolvedValue('1.2.3');
  });

  it('skips initialization when analytics is disabled in config', async () => {
    mockConfigStoreGet({
      config: { analytics: { enabled: false } },
    });

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await expect(analytics.initialize()).resolves.toBe(false);

    expect(analytics.isEnabled.value).toBe(false);
    expect(analytics.isInitialized.value).toBe(false);
    expect(analytics.analyticsEnabled.value).toBe(false);
    expect(configStoreSetMock).not.toHaveBeenCalled();
    expect(httpFetchMock).not.toHaveBeenCalled();
  });

  it('initializes a new client/session and sends the launch event', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    mockConfigStoreGet({
      config: { analytics: { enabled: true } },
      analytics_data: null,
    });

    const { GA_EVENTS, useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await expect(analytics.initialize()).resolves.toBe(true);

    expect(analytics.isInitialized.value).toBe(true);
    expect(analytics.analyticsEnabled.value).toBe(true);
    expect(configStoreSetMock).toHaveBeenCalledWith('analytics_data', {
      clientId: '88888888-8888-4888-8888-888888888888',
      sessionId: '1700000000000',
      lastActiveTime: 1700000000000,
    });
    expect(configStoreSaveMock).toHaveBeenCalled();
    expect(appVersionMock).toHaveBeenCalledTimes(1);
    expect(httpFetchMock).toHaveBeenCalledTimes(1);

    const { payload, request, url } = getAnalyticsFetchCall();
    expect(url).toContain('https://www.google-analytics.com/mp/collect');
    expect(request.method).toBe('POST');
    expect(payload.client_id).toBe('88888888-8888-4888-8888-888888888888');
    expect(payload.events[0]).toMatchObject({
      name: GA_EVENTS.APP_LAUNCH,
      params: {
        session_id: '1700000000000',
        app_version: '1.2.3',
        platform: 'tauri_desktop',
        app_platform: 'tauri_desktop',
      },
    });
  });

  it('reuses stored identity, refreshes active sessions, and reports failed sends quietly', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000010000);
    mockConfigStoreGet({
      analytics_data: {
        clientId: 'client-1',
        sessionId: 'session-1',
        lastActiveTime: 1700000000000,
      },
    });
    httpFetchMock.mockResolvedValue({ status: 500 } as never);

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await analytics.trackEvent('upload_finished', { count: 2 });

    expect(configStoreSetMock).toHaveBeenCalledWith('analytics_data', {
      clientId: 'client-1',
      sessionId: 'session-1',
      lastActiveTime: 1700000010000,
    });
    expect(configStoreSaveMock).toHaveBeenCalledTimes(1);
    expect(httpFetchMock).toHaveBeenCalledTimes(1);
    expect(getAnalyticsFetchCall().payload).toMatchObject({
      client_id: 'client-1',
      events: [{
        name: 'upload_finished',
        params: {
          count: 2,
          session_id: 'session-1',
        },
      }],
    });
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('creates a fresh session when stored activity is expired', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700005000000);
    mockConfigStoreGet({
      analytics_data: {
        clientId: 'client-1',
        sessionId: 'old-session',
        lastActiveTime: 1700000000000,
      },
    });

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await analytics.trackEvent('image_uploaded');

    expect(configStoreSetMock).toHaveBeenCalledWith('analytics_data', {
      clientId: 'client-1',
      sessionId: '1700005000000',
      lastActiveTime: 1700005000000,
    });
    expect(getAnalyticsFetchCall().payload.events[0].params.session_id)
      .toBe('1700005000000');
  });

  it('persists enable/disable while preserving the analytics config object', async () => {
    mockConfigStoreGet({
      config: { analytics: { enabled: false, channel: 'stable' } },
    });

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await analytics.enable();

    expect(analytics.isEnabled.value).toBe(true);
    expect(configStoreSetMock).toHaveBeenCalledWith('config', {
      analytics: { enabled: true, channel: 'stable' },
    });

    configStoreSetMock.mockClear();
    configStoreSaveMock.mockClear();
    mockConfigStoreGet({
      config: { analytics: { enabled: true, channel: 'stable' } },
    });

    await analytics.disable();
    await nextTick();

    expect(analytics.isEnabled.value).toBe(false);
    expect(configStoreSetMock).toHaveBeenCalledWith('config', {
      analytics: { enabled: false, channel: 'stable' },
    });
    expect(configStoreSaveMock).toHaveBeenCalledTimes(1);
  });

  it('falls back when app version or storage access fails', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    configStoreGetMock.mockImplementation(async (key: string) => {
      if (key === 'config') return { analytics: { enabled: true } };
      throw new Error('store unavailable');
    });
    appVersionMock.mockRejectedValue(new Error('version unavailable'));

    const { useAnalytics } = await importFreshAnalytics();
    const analytics = useAnalytics();

    await expect(analytics.initialize()).resolves.toBe(true);

    const { payload } = getAnalyticsFetchCall();
    expect(payload.client_id).toBe('44444444-4444-4444-8444-444444444444');
    expect(payload.events[0].params.app_version).toBe('3.0.0');
    expect(loggerMock.error).toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalled();
  });
});
