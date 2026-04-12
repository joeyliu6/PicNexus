import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { DEFAULT_LINK_PREFIXES } from '../../../config/types';

// ─── Mock 依赖 ──────────────────────────────────────────

const {
  configStoreGetMock,
  configStoreSetMock,
  configStoreSaveMock,
  toastShowConfigMock,
} = vi.hoisted(() => ({
  configStoreGetMock: vi.fn(),
  configStoreSetMock: vi.fn(),
  configStoreSaveMock: vi.fn(),
  toastShowConfigMock: vi.fn(),
}));

vi.mock('../../../store/instances', () => ({
  configStore: {
    get: configStoreGetMock,
    set: configStoreSetMock,
    save: configStoreSaveMock,
  },
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    showConfig: toastShowConfigMock,
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../crypto', () => ({
  BackupPasswordRequiredError: class BackupPasswordRequiredError extends Error {
    constructor() { super('需要备份密码'); this.name = 'BackupPasswordRequiredError'; }
  },
}));

vi.mock('../../../constants', () => ({
  TOAST_MESSAGES: {
    config: {
      loadFailed: (msg: string) => ({ summary: '加载失败', detail: msg }),
      saveFailed: (msg: string) => ({ summary: '保存失败', detail: msg }),
      validationFailed: (msg: string) => ({ summary: '验证失败', detail: msg }),
    },
    auth: {
      cookieInvalid: { summary: '无效', detail: 'Cookie 无效' },
      cookieUpdated: (name: string) => ({ summary: '成功', detail: `${name} Cookie 已更新` }),
      unsupportedService: (id: string) => ({ summary: '不支持', detail: `${id} 不支持` }),
      loginWindowFailed: (msg: string) => ({ summary: '失败', detail: msg }),
    },
  },
}));

vi.mock('../../../config/cookieProviders', () => ({
  getCookieProvider: (id: string) => {
    const providers: Record<string, unknown> = {
      weibo: { name: '微博', cookieValidation: {} },
      nami: { name: '纳米', cookieValidation: { requiredFields: ['Auth-Token'] } },
      bilibili: { name: '哔哩哔哩' },
    };
    return providers[id] ?? null;
  },
  validateCookie: (_cookie: string, _validation: unknown) => true,
  DEFAULT_LOGIN_WINDOW_SIZE: { width: 800, height: 600 },
}));

const { useConfigManager } = await import('../../../composables/useConfig');

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);
const mockedEmit = vi.mocked(emit);

// ─── 测试用例 ──────────────────────────────────────────

describe('useConfigManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configStoreSetMock.mockResolvedValue(undefined);
    configStoreSaveMock.mockResolvedValue(undefined);
  });

  // ─── loadConfig ────────────────────────────────────

  describe('loadConfig', () => {
    it('正常加载配置', async () => {
      const mockConfig = { enabledServices: ['weibo'], services: { weibo: { enabled: true, cookie: 'test' } }, weiboProxyMode: 'none' };
      configStoreGetMock.mockResolvedValue(mockConfig);

      const { loadConfig, config } = useConfigManager();
      const result = await loadConfig();

      expect(configStoreGetMock).toHaveBeenCalledWith('config', expect.any(Object));
      expect(result).toEqual(mockConfig);
      expect(config.value).toEqual(mockConfig);
    });

    it('加载失败时降级为默认配置', async () => {
      configStoreGetMock.mockRejectedValue(new Error('读取失败'));

      const { loadConfig } = useConfigManager();
      const result = await loadConfig();

      expect(result.enabledServices).toBeDefined();
      expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.any(Object));
    });

    it('BackupPasswordRequiredError 向上抛出', async () => {
      const { BackupPasswordRequiredError } = await import('../../../crypto');
      configStoreGetMock.mockRejectedValue(new BackupPasswordRequiredError());

      const { loadConfig } = useConfigManager();
      await expect(loadConfig()).rejects.toThrow('需要备份密码');
    });
  });

  // ─── saveConfig ────────────────────────────────────

  describe('saveConfig', () => {
    it('正常保存配置', async () => {
      const newConfig = {
        enabledServices: ['jd'],
        availableServices: ['jd'],
        services: { jd: { enabled: true } },
        weiboProxyMode: 'none' as const,
      };

      const { saveConfig } = useConfigManager();
      await saveConfig(newConfig as any);

      expect(configStoreSetMock).toHaveBeenCalledWith('config', expect.any(Object));
      expect(configStoreSaveMock).toHaveBeenCalled();
      expect(mockedEmit).toHaveBeenCalledWith('config-updated', expect.any(Object));
    });

    it('availableServices 为空时拒绝保存', async () => {
      const badConfig = {
        enabledServices: ['jd'],
        availableServices: [],
        services: {},
        weiboProxyMode: 'none' as const,
      };

      const { saveConfig } = useConfigManager();
      await saveConfig(badConfig as any);

      expect(configStoreSetMock).not.toHaveBeenCalled();
      expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.any(Object));
    });

    it('空前缀列表自动恢复默认', async () => {
      const configWithEmptyPrefixes = {
        enabledServices: ['jd'],
        availableServices: ['jd'],
        services: {},
        weiboProxyMode: 'none' as const,
        linkPrefixConfig: { enabled: true, selectedIndex: 0, prefixList: [] },
      };

      const { saveConfig } = useConfigManager();
      await saveConfig(configWithEmptyPrefixes as any);

      const savedConfig = configStoreSetMock.mock.calls[0][1];
      expect(savedConfig.linkPrefixConfig.prefixList).toEqual(DEFAULT_LINK_PREFIXES);
    });

    it('越界 selectedIndex 自动重置为 0', async () => {
      const configWithBadIndex = {
        enabledServices: ['jd'],
        availableServices: ['jd'],
        services: {},
        weiboProxyMode: 'none' as const,
        linkPrefixConfig: {
          enabled: true,
          selectedIndex: 99,
          prefixList: [
            { name: 'A', template: 'https://a.com/' },
            { name: 'B', template: 'https://b.com/' },
          ],
        },
      };

      const { saveConfig } = useConfigManager();
      await saveConfig(configWithBadIndex as any);

      const savedConfig = configStoreSetMock.mock.calls[0][1];
      expect(savedConfig.linkPrefixConfig.selectedIndex).toBe(0);
    });

    it('负数 selectedIndex 自动重置为 0', async () => {
      const configWithNegIndex = {
        enabledServices: ['jd'],
        availableServices: ['jd'],
        services: {},
        weiboProxyMode: 'none' as const,
        linkPrefixConfig: {
          enabled: true,
          selectedIndex: -1,
          prefixList: [{ name: 'A', template: 'https://a.com/' }],
        },
      };

      const { saveConfig } = useConfigManager();
      await saveConfig(configWithNegIndex as any);

      const savedConfig = configStoreSetMock.mock.calls[0][1];
      expect(savedConfig.linkPrefixConfig.selectedIndex).toBe(0);
    });

    it('保存失败时显示错误提示', async () => {
      configStoreSetMock.mockRejectedValue(new Error('磁盘已满'));

      const newConfig = {
        enabledServices: ['jd'],
        availableServices: ['jd'],
        services: {},
        weiboProxyMode: 'none' as const,
      };

      const { saveConfig } = useConfigManager();
      await expect(saveConfig(newConfig as any)).rejects.toThrow('磁盘已满');
      expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.any(Object));
    });

    it('silent 模式下保存失败不显示提示', async () => {
      configStoreSetMock.mockRejectedValue(new Error('磁盘已满'));

      const newConfig = {
        enabledServices: ['jd'],
        availableServices: ['jd'],
        services: {},
        weiboProxyMode: 'none' as const,
      };

      const { saveConfig } = useConfigManager();
      await expect(saveConfig(newConfig as any, true)).rejects.toThrow();
      expect(toastShowConfigMock).not.toHaveBeenCalled();
    });
  });

  // ─── testCookieConnection 系列 ─────────────────────

  describe('连接测试', () => {
    it('testWeiboConnection 空 cookie 返回失败', async () => {
      const { testWeiboConnection } = useConfigManager();
      const result = await testWeiboConnection('');
      expect(result.success).toBe(false);
      expect(result.message).toContain('不能为空');
    });

    it('testWeiboConnection 成功时返回成功消息', async () => {
      mockedInvoke.mockResolvedValue('连接成功');

      const { testWeiboConnection } = useConfigManager();
      const result = await testWeiboConnection('SUB=xxx');
      expect(result.success).toBe(true);
      expect(result.message).toBe('连接成功');
    });

    it('testWeiboConnection invoke 失败时返回错误消息', async () => {
      mockedInvoke.mockRejectedValue('Cookie 已过期');

      const { testWeiboConnection } = useConfigManager();
      const result = await testWeiboConnection('SUB=xxx');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Cookie 已过期');
    });

    it('testR2Connection 成功', async () => {
      mockedInvoke.mockResolvedValue('R2 连接成功');

      const { testR2Connection } = useConfigManager();
      const result = await testR2Connection({
        accountId: 'acc', accessKeyId: 'key',
        secretAccessKey: 'secret', bucketName: 'bucket',
      });
      expect(result.success).toBe(true);
    });

    it('testBilibiliConnection 缺少 SESSDATA 时前置验证失败', async () => {
      const { testBilibiliConnection } = useConfigManager();
      const result = await testBilibiliConnection('bili_jct=abc');
      expect(result.success).toBe(false);
      expect(result.message).toContain('SESSDATA');
    });
  });

  // ─── setupCookieListener ──────────────────────────

  describe('setupCookieListener', () => {
    it('新格式 payload 正确分发', async () => {
      let capturedHandler: ((event: any) => void) | undefined;
      mockedListen.mockImplementation(async (eventName, handler) => {
        if (eventName === 'cookie-updated') {
          capturedHandler = handler as typeof capturedHandler;
        }
        return vi.fn();
      });

      const onCookieUpdate = vi.fn().mockResolvedValue(undefined);
      const { setupCookieListener } = useConfigManager();
      await setupCookieListener(onCookieUpdate);

      // 模拟新格式事件
      await capturedHandler?.({ payload: { serviceId: 'bilibili', cookie: 'SESSDATA=abc; bili_jct=def' } });

      expect(onCookieUpdate).toHaveBeenCalledWith('bilibili', 'SESSDATA=abc; bili_jct=def');
    });

    it('旧格式 string payload 默认为微博', async () => {
      let capturedHandler: ((event: any) => void) | undefined;
      mockedListen.mockImplementation(async (eventName, handler) => {
        if (eventName === 'cookie-updated') {
          capturedHandler = handler as typeof capturedHandler;
        }
        return vi.fn();
      });

      const onCookieUpdate = vi.fn().mockResolvedValue(undefined);
      const { setupCookieListener } = useConfigManager();
      await setupCookieListener(onCookieUpdate);

      // 模拟旧格式（直接字符串）
      await capturedHandler?.({ payload: 'SUB=xxx' });

      expect(onCookieUpdate).toHaveBeenCalledWith('weibo', 'SUB=xxx');
    });

    it('空 cookie 不触发回调', async () => {
      let capturedHandler: ((event: any) => void) | undefined;
      mockedListen.mockImplementation(async (eventName, handler) => {
        if (eventName === 'cookie-updated') {
          capturedHandler = handler as typeof capturedHandler;
        }
        return vi.fn();
      });

      const onCookieUpdate = vi.fn();
      const { setupCookieListener } = useConfigManager();
      await setupCookieListener(onCookieUpdate);

      await capturedHandler?.({ payload: { serviceId: 'weibo', cookie: '' } });

      expect(onCookieUpdate).not.toHaveBeenCalled();
      expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.any(Object));
    });

    it('返回的 unlisten 能正确清理', async () => {
      const unlistenCookie = vi.fn();
      const unlistenTimeout = vi.fn();
      let callCount = 0;
      mockedListen.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? unlistenCookie : unlistenTimeout;
      });

      const { setupCookieListener } = useConfigManager();
      const unlisten = await setupCookieListener(vi.fn());
      unlisten();

      expect(unlistenCookie).toHaveBeenCalled();
      expect(unlistenTimeout).toHaveBeenCalled();
    });
  });

  // ─── getLinkPrefixConfig ──────────────────────────

  describe('getLinkPrefixConfig', () => {
    const itemA = { name: 'A', template: 'https://a.com/' };
    const itemB = { name: 'B', template: 'https://b.com/' };

    it('返回正确的配置对象', () => {
      const { getLinkPrefixConfig } = useConfigManager();
      const result = getLinkPrefixConfig(true, 1, [itemA, itemB]);

      expect(result.enabled).toBe(true);
      expect(result.selectedIndex).toBe(1);
      expect(result.prefixList).toEqual([itemA, itemB]);
    });

    it('空列表时使用默认前缀', () => {
      const { getLinkPrefixConfig } = useConfigManager();
      const result = getLinkPrefixConfig(true, 0, []);

      expect(result.prefixList).toEqual(DEFAULT_LINK_PREFIXES);
    });
  });

  // ─── getActivePrefix ──────────────────────────────

  describe('getActivePrefix', () => {
    const itemA = { name: 'A', template: 'https://a.com/' };
    const itemB = { name: 'B', template: 'https://b.com/' };

    it('未启用时返回 null', () => {
      const { getActivePrefix } = useConfigManager();
      const result = getActivePrefix({ enabled: false, selectedIndex: 0, prefixList: [itemA] });
      expect(result).toBeNull();
    });

    it('启用且索引有效时返回对应前缀项', () => {
      const { getActivePrefix } = useConfigManager();
      const result = getActivePrefix({ enabled: true, selectedIndex: 1, prefixList: [itemA, itemB] });
      expect(result).toEqual(itemB);
    });

    it('索引越界时回退到第一个', () => {
      const { getActivePrefix } = useConfigManager();
      const result = getActivePrefix({ enabled: true, selectedIndex: 99, prefixList: [itemA] });
      expect(result).toEqual(itemA);
    });
  });
});
