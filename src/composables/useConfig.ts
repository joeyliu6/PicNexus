// 配置管理 Composable - 封装配置加载、保存、测试连接等功能

import { ref, Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn, emit } from '@tauri-apps/api/event';
import { configStore } from '../store/instances';
import type { Store } from '../store';
import { BackupPasswordRequiredError } from '../crypto';
import {
  UserConfig,
  DEFAULT_CONFIG,
  ServiceType,
  LinkPrefixConfig,
  DEFAULT_PREFIXES,
  migrateConfig
} from '../config/types';
import { getCookieProvider, validateCookie, DEFAULT_LOGIN_WINDOW_SIZE } from '../config/cookieProviders';
import { useToast } from './useToast';
import { TOAST_MESSAGES } from '../constants';
import { createLogger } from '../utils/logger';

const log = createLogger('useConfig');

// --- 全局单例状态（所有组件共享） ---
const config: Ref<UserConfig> = ref<UserConfig>({ ...DEFAULT_CONFIG });
const isLoading = ref(false);
const isSaving = ref(false);

/**
 * Cookie 更新事件的 payload 类型
 */
interface CookieUpdatedPayload {
  serviceId: string;
  cookie: string;
}

/**
 * 测试连接结果
 */
interface TestConnectionResult {
  success: boolean;
  message: string;
}


function toPlainConfig(input: UserConfig): UserConfig {
  return JSON.parse(JSON.stringify(input)) as UserConfig;
}

/**
 * 配置管理 Composable
 */
export function useConfigManager() {
  const toast = useToast();

  /**
   * 加载配置
   */
  async function loadConfig(): Promise<UserConfig> {
    log.info('开始加载配置...');
    isLoading.value = true;

    try {
      const loadedConfig = await configStore.get<UserConfig>('config', DEFAULT_CONFIG);
      config.value = migrateConfig(loadedConfig || DEFAULT_CONFIG);
      log.info('✓ 配置加载成功');
      return config.value;
    } catch (error) {
      if (error instanceof BackupPasswordRequiredError) {
        throw error;
      }
      // 读取/迁移失败时降级为默认配置
      log.error('读取配置失败，使用默认配置:', error);
      config.value = { ...DEFAULT_CONFIG };
      toast.showConfig('error', TOAST_MESSAGES.config.loadFailed('已使用默认配置'));
      return config.value;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 保存配置
   * @param newConfig 新的配置对象
   * @param silent 静默保存，不显示成功提示（用于自动保存场景）
   */
  async function saveConfig(newConfig: UserConfig, silent = false): Promise<void> {
    try {
      log.info('开始保存配置...');
      isSaving.value = true;
      const configToSave = toPlainConfig(newConfig);

      // 验证至少有一个可用图床
      if (!configToSave.availableServices || configToSave.availableServices.length === 0) {
        toast.showConfig('error', TOAST_MESSAGES.config.validationFailed('至少需要启用一个图床'));
        return;
      }

      // 验证链接前缀配置
      if (configToSave.linkPrefixConfig) {
        // 确保前缀列表不为空
        if (!configToSave.linkPrefixConfig.prefixList || configToSave.linkPrefixConfig.prefixList.length === 0) {
          log.warn('前缀列表为空，恢复默认前缀');
          configToSave.linkPrefixConfig.prefixList = [...DEFAULT_PREFIXES];
        }
        // 确保选中索引在有效范围内
        if (configToSave.linkPrefixConfig.selectedIndex < 0 ||
            configToSave.linkPrefixConfig.selectedIndex >= configToSave.linkPrefixConfig.prefixList.length) {
          log.warn('选中索引无效，重置为 0');
          configToSave.linkPrefixConfig.selectedIndex = 0;
        }
      }

      // 保存到存储
      await configStore.set('config', configToSave);
      await configStore.save();

      // 更新内存中的配置
      config.value = { ...configToSave };

      // 发送配置更新事件，通知其他组件刷新状态
      await emit('config-updated', { timestamp: Date.now() });

      log.info('✓ 配置保存成功');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('保存配置失败:', error);
      if (!silent) {
        toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(errorMsg));
      }
      throw error;
    } finally {
      isSaving.value = false;
    }
  }

  /**
   * 通用 Cookie 连接测试
   * @param serviceName 服务名称（用于日志）
   * @param cookie Cookie 字符串
   * @param invokeCommand Rust 命令名
   * @param invokeParams 命令参数
   * @param preValidate 可选的前置验证函数
   */
  async function testCookieConnectionGeneric(
    serviceName: string,
    cookie: string,
    invokeCommand: string,
    invokeParams: Record<string, unknown>,
    preValidate?: () => TestConnectionResult | null
  ): Promise<TestConnectionResult> {
    try {
      log.info(`[${serviceName}Cookie测试] 开始测试连接...`);

      if (!cookie || cookie.trim().length === 0) {
        return { success: false, message: 'Cookie 不能为空' };
      }

      if (preValidate) {
        const validationResult = preValidate();
        if (validationResult) return validationResult;
      }

      try {
        const successMessage = await invoke<string>(invokeCommand, invokeParams);
        log.info(`[${serviceName}Cookie测试] ✓ 测试成功`);
        return { success: true, message: successMessage };
      } catch (errorMessage) {
        return { success: false, message: String(errorMessage) };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`[${serviceName}Cookie测试] 测试连接失败:`, error);
      return { success: false, message: errorMsg };
    }
  }

  /**
   * 测试微博连接
   */
  async function testWeiboConnection(cookie: string): Promise<TestConnectionResult> {
    return testCookieConnectionGeneric('微博', cookie, 'test_weibo_connection', { weiboCookie: cookie });
  }

  /**
   * 测试 R2 连接
   * @param r2Config R2 配置对象
   */
  async function testR2Connection(r2Config: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
    path?: string;
    publicDomain?: string;
  }): Promise<TestConnectionResult> {
    try {
      log.info('开始测试 R2 连接...');

      try {
        const successMessage = await invoke<string>('test_r2_connection', { config: r2Config });
        log.info('R2 ✓ 测试成功');
        return {
          success: true,
          message: successMessage
        };
      } catch (errorMessage) {
        return {
          success: false,
          message: String(errorMessage)
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('测试 R2 连接失败:', error);
      return {
        success: false,
        message: errorMsg
      };
    }
  }

  /**
   * 测试 WebDAV 连接
   * @param webdavConfig WebDAV 配置对象
   */
  async function testWebDAVConnection(webdavConfig: {
    url: string;
    username: string;
    password: string;
    remotePath: string;
  }): Promise<TestConnectionResult> {
    try {
      log.info('开始测试 WebDAV 连接...');

      try {
        const successMessage = await invoke<string>('test_webdav_connection', { config: webdavConfig });
        log.info('WebDAV ✓ 测试成功');
        return {
          success: true,
          message: successMessage
        };
      } catch (errorMessage) {
        return {
          success: false,
          message: String(errorMessage)
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('测试 WebDAV 连接失败:', error);
      return {
        success: false,
        message: errorMsg
      };
    }
  }

  /**
   * 测试牛客连接
   */
  async function testNowcoderConnection(cookie: string): Promise<TestConnectionResult> {
    return testCookieConnectionGeneric('牛客', cookie, 'test_nowcoder_cookie', { nowcoderCookie: cookie });
  }

  /**
   * 测试知乎连接
   */
  async function testZhihuConnection(cookie: string): Promise<TestConnectionResult> {
    return testCookieConnectionGeneric('知乎', cookie, 'test_zhihu_connection', { zhihuCookie: cookie });
  }

  /**
   * 测试纳米连接
   */
  async function testNamiConnection(cookie: string): Promise<TestConnectionResult> {
    // 从 Cookie 中提取 Auth-Token
    const authTokenMatch = cookie.match(/Auth-Token=([^;]+)/);
    const authToken = authTokenMatch ? authTokenMatch[1] : '';

    return testCookieConnectionGeneric('纳米', cookie, 'test_nami_connection', { cookie, authToken }, () => {
      const provider = getCookieProvider('nami');
      if (provider && !validateCookie(cookie, provider.cookieValidation)) {
        return { success: false, message: 'Cookie 中缺少 Auth-Token 字段（请点击"自动获取Cookie"按钮）' };
      }
      if (!authToken) {
        return { success: false, message: 'Cookie 中未找到 Auth-Token，请重新获取' };
      }
      return null;
    });
  }

  /**
   * 测试哔哩哔哩连接
   */
  async function testBilibiliConnection(cookie: string): Promise<TestConnectionResult> {
    return testCookieConnectionGeneric('哔哩哔哩', cookie, 'test_bilibili_connection', { bilibiliCookie: cookie }, () => {
      if (!cookie.includes('SESSDATA=') || !cookie.includes('bili_jct=')) {
        return { success: false, message: 'Cookie 中缺少 SESSDATA 或 bili_jct 字段' };
      }
      return null;
    });
  }

  /**
   * 测试超星连接
   */
  async function testChaoxingConnection(cookie: string): Promise<TestConnectionResult> {
    return testCookieConnectionGeneric('超星', cookie, 'test_chaoxing_connection', { chaoxingCookie: cookie }, () => {
      if (!cookie.includes('_uid=')) {
        return { success: false, message: 'Cookie 中缺少 _uid 字段（请点击"自动获取Cookie"按钮）' };
      }
      return null;
    });
  }

  /**
   * 打开 WebView 登录窗口获取 Cookie
   * @param serviceId 服务标识（weibo/nowcoder/zhihu/nami/bilibili/chaoxing）
   */
  async function openCookieWebView(serviceId: ServiceType): Promise<void> {
    try {
      const provider = getCookieProvider(serviceId);
      if (!provider) {
        toast.showConfig('error', TOAST_MESSAGES.auth.unsupportedService(serviceId));
        return;
      }

      log.info(`开始打开 ${provider.name} 登录窗口`);

      // 检测当前主题
      const isLight = document.documentElement.classList.contains('light-theme');
      const theme = isLight ? 'light' : 'dark';
      const loginSize = provider.loginWindowSize ?? DEFAULT_LOGIN_WINDOW_SIZE;

      // 通过 Rust 命令创建多 Webview 登录窗口
      await invoke('open_login_window', {
        serviceId,
        serviceName: provider.name,
        width: loginSize.width,
        height: loginSize.height,
        titlebarUrl: `login-titlebar.html?name=${encodeURIComponent(provider.name)}&theme=${theme}`,
        contentUrl: `login-webview.html?service=${serviceId}`,
      });

      log.info(`✓ ${provider.name} 窗口创建成功`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('打开窗口失败:', errorMessage);
      toast.showConfig('error', TOAST_MESSAGES.auth.loginWindowFailed(errorMessage));
    }
  }

  /**
   * 设置 Cookie 更新监听器
   * 监听来自登录窗口的 Cookie 更新事件（支持多服务）
   * @param onCookieUpdate 回调函数，当 Cookie 更新时调用
   */
  async function setupCookieListener(
    onCookieUpdate: (serviceId: string, cookie: string) => Promise<void>
  ): Promise<UnlistenFn> {
    try {
      // 监听新格式的事件 {serviceId, cookie}
      const unlisten = await listen<CookieUpdatedPayload>('cookie-updated', async (event) => {
        try {
          const payload = event.payload;

          // 兼容旧格式（直接是 string）和新格式（{serviceId, cookie}）
          let serviceId: string;
          let cookie: string;

          if (typeof payload === 'string') {
            // 旧格式：直接是 cookie 字符串，默认为微博
            serviceId = 'weibo';
            cookie = payload;
          } else if (payload && typeof payload === 'object') {
            // 新格式：{serviceId, cookie}
            serviceId = payload.serviceId || 'weibo';
            cookie = payload.cookie;
          } else {
            log.error('无效的 payload 格式:', typeof payload);
            return;
          }

          log.info(`收到 ${serviceId} Cookie更新事件，长度:`, cookie?.length || 0);

          // 验证 Cookie
          if (!cookie || typeof cookie !== 'string' || cookie.trim().length === 0) {
            log.error('Cookie为空或无效');
            toast.showConfig('error', TOAST_MESSAGES.auth.cookieInvalid);
            return;
          }

          const trimmedCookie = cookie.trim();

          try {
            // 调用回调函数处理 Cookie 更新
            await onCookieUpdate(serviceId, trimmedCookie);

            // 显示成功提示
            const provider = getCookieProvider(serviceId);
            const serviceName = provider?.name || serviceId;
            toast.showConfig('success', TOAST_MESSAGES.auth.cookieUpdated(serviceName));

          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            log.error('保存Cookie失败:', error);
            toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(errorMsg));
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          log.error('处理Cookie更新事件失败:', error);
          toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(errorMsg));
        }
      });

      // 监听 Cookie 监控超时事件
      const unlistenTimeout = await listen<string>('cookie-monitoring-timeout', (event) => {
        const serviceId = event.payload;
        const provider = getCookieProvider(serviceId);
        const serviceName = provider?.name || serviceId;
        log.warn(`${serviceName} 自动获取超时`);
        toast.showConfig('warn', {
          summary: '自动获取超时',
          detail: `${serviceName} Cookie 自动获取超时，请手动点击「获取 Cookie」按钮`,
          life: 8000
        });
      });

      log.info('✓ 监听器已设置（支持多服务 + 超时通知）');
      return () => {
        unlisten();
        unlistenTimeout();
      };
    } catch (error) {
      log.error('设置监听器失败:', error);
      // 返回空函数以保持接口一致性
      return () => {};
    }
  }

  /**
   * 获取配置存储实例（用于直接访问）
   */
  function getConfigStore(): Store {
    return configStore;
  }

  /**
   * 从 UI 获取链接前缀配置
   * @param prefixEnabled 是否启用前缀
   * @param selectedIndex 选中的前缀索引
   * @param prefixList 前缀列表
   * @param savedConfig 已保存的配置（用于向后兼容）
   */
  function getLinkPrefixConfig(
    prefixEnabled: boolean,
    selectedIndex: number,
    prefixList: string[]
  ): LinkPrefixConfig {
    return {
      enabled: prefixEnabled,
      selectedIndex: selectedIndex,
      prefixList: prefixList.length > 0 ? prefixList : DEFAULT_PREFIXES
    };
  }

  /**
   * 获取当前选中的前缀
   * @param linkPrefixConfig 链接前缀配置
   */
  function getActivePrefix(linkPrefixConfig: LinkPrefixConfig): string | null {
    if (!linkPrefixConfig.enabled) return null;

    const index = linkPrefixConfig.selectedIndex;
    const list = linkPrefixConfig.prefixList || DEFAULT_PREFIXES;

    if (index >= 0 && index < list.length) {
      return list[index];
    }

    return list[0] || DEFAULT_PREFIXES[0];
  }

  return {
    // 状态
    config,
    isLoading,
    isSaving,

    // 配置操作
    loadConfig,
    saveConfig,
    getConfigStore,

    // 测试连接
    testWeiboConnection,
    testR2Connection,
    testWebDAVConnection,
    testNowcoderConnection,
    testZhihuConnection,
    testNamiConnection,
    testBilibiliConnection,
    testChaoxingConnection,

    // Cookie 自动获取
    openCookieWebView,
    setupCookieListener,

    // 链接前缀工具
    getLinkPrefixConfig,
    getActivePrefix
  };
}
