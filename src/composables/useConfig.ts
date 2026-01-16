// src/composables/useConfig.ts
// 配置管理 Composable - 封装配置加载、保存、测试连接等功能

import { ref, Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn, emit } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Store } from '../store';
import {
  UserConfig,
  DEFAULT_CONFIG,
  ServiceType,
  LinkPrefixConfig,
  DEFAULT_PREFIXES,
  migrateConfig
} from '../config/types';
import { getCookieProvider, validateCookie } from '../config/cookieProviders';
import { useToast } from './useToast';
import { TOAST_MESSAGES } from '../constants';

// --- STORES ---
const configStore = new Store('.settings.dat');

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

/**
 * 配置管理 Composable
 */
export function useConfigManager() {
  const toast = useToast();

  /**
   * 加载配置
   */
  async function loadConfig(): Promise<UserConfig> {
    try {
      console.log('[配置管理] 开始加载配置...');
      isLoading.value = true;

      // 读取配置（带自动恢复功能）
      try {
        // 如果配置文件损坏，get 方法会自动使用 DEFAULT_CONFIG 恢复
        const loadedConfig = await configStore.get<UserConfig>('config', DEFAULT_CONFIG);
        const finalConfig = loadedConfig || DEFAULT_CONFIG;

        // 使用迁移函数确保兼容旧配置
        config.value = migrateConfig(finalConfig);

        console.log('[配置管理] ✓ 配置加载成功');
        return config.value;
      } catch (error) {
        console.error('[配置管理] 读取配置失败，使用默认配置:', error);
        config.value = { ...DEFAULT_CONFIG };
        toast.showConfig('error', TOAST_MESSAGES.config.loadFailed('已使用默认配置'));
        return config.value;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[配置管理] 加载配置失败:', error);
      toast.showConfig('error', TOAST_MESSAGES.config.loadFailed(errorMsg));
      throw error;
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
      console.log('[配置管理] 开始保存配置...');
      isSaving.value = true;

      // 验证至少有一个可用图床
      if (!newConfig.availableServices || newConfig.availableServices.length === 0) {
        toast.showConfig('error', TOAST_MESSAGES.config.validationFailed('至少需要启用一个图床'));
        return;
      }

      // 验证链接前缀配置
      if (newConfig.linkPrefixConfig) {
        // 确保前缀列表不为空
        if (!newConfig.linkPrefixConfig.prefixList || newConfig.linkPrefixConfig.prefixList.length === 0) {
          console.warn('[配置管理] 前缀列表为空，恢复默认前缀');
          newConfig.linkPrefixConfig.prefixList = [...DEFAULT_PREFIXES];
        }
        // 确保选中索引在有效范围内
        if (newConfig.linkPrefixConfig.selectedIndex < 0 ||
            newConfig.linkPrefixConfig.selectedIndex >= newConfig.linkPrefixConfig.prefixList.length) {
          console.warn('[配置管理] 选中索引无效，重置为 0');
          newConfig.linkPrefixConfig.selectedIndex = 0;
        }
      }

      // 保存到存储
      await configStore.set('config', newConfig);
      await configStore.save();

      // 更新内存中的配置
      config.value = { ...newConfig };

      // 发送配置更新事件，通知其他组件刷新状态
      await emit('config-updated', { timestamp: Date.now() });

      console.log('[配置管理] ✓ 配置保存成功');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[配置管理] 保存配置失败:', error);
      if (!silent) {
        toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(errorMsg));
      }
      throw error;
    } finally {
      isSaving.value = false;
    }
  }

  /**
   * 测试微博连接
   * 通过 Rust 后端上传测试图片验证 Cookie（与知乎、牛客保持一致）
   * @param cookie 微博 Cookie
   */
  async function testWeiboConnection(cookie: string): Promise<TestConnectionResult> {
    try {
      console.log('[Cookie测试] 开始测试微博连接...');

      if (!cookie || cookie.trim().length === 0) {
        return {
          success: false,
          message: 'Cookie 不能为空'
        };
      }

      try {
        const successMessage = await invoke<string>('test_weibo_connection', { weiboCookie: cookie });
        console.log('[Cookie测试] ✓ 测试成功');
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
      console.error('[Cookie测试] 测试微博连接失败:', error);
      return {
        success: false,
        message: errorMsg
      };
    }
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
      console.log('[R2测试] 开始测试 R2 连接...');

      try {
        const successMessage = await invoke<string>('test_r2_connection', { config: r2Config });
        console.log('[R2测试] ✓ 测试成功');
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
      console.error('[R2测试] 测试 R2 连接失败:', error);
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
      console.log('[WebDAV测试] 开始测试 WebDAV 连接...');

      try {
        const successMessage = await invoke<string>('test_webdav_connection', { config: webdavConfig });
        console.log('[WebDAV测试] ✓ 测试成功');
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
      console.error('[WebDAV测试] 测试 WebDAV 连接失败:', error);
      return {
        success: false,
        message: errorMsg
      };
    }
  }

  /**
   * 测试牛客连接
   * @param cookie 牛客 Cookie
   */
  async function testNowcoderConnection(cookie: string): Promise<TestConnectionResult> {
    try {
      console.log('[牛客Cookie测试] 开始测试牛客连接...');

      if (!cookie || cookie.trim().length === 0) {
        return {
          success: false,
          message: 'Cookie 不能为空'
        };
      }

      try {
        const successMessage = await invoke<string>('test_nowcoder_cookie', { nowcoderCookie: cookie });
        console.log('[牛客Cookie测试] ✓ 测试成功');
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
      console.error('[牛客Cookie测试] 测试牛客连接失败:', error);
      return {
        success: false,
        message: errorMsg
      };
    }
  }

  /**
   * 测试知乎连接
   * @param cookie 知乎 Cookie
   */
  async function testZhihuConnection(cookie: string): Promise<TestConnectionResult> {
    try {
      console.log('[知乎Cookie测试] 开始测试知乎连接...');

      if (!cookie || cookie.trim().length === 0) {
        return {
          success: false,
          message: 'Cookie 不能为空'
        };
      }

      try {
        const successMessage = await invoke<string>('test_zhihu_connection', { zhihuCookie: cookie });
        console.log('[知乎Cookie测试] ✓ 测试成功');
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
      console.error('[知乎Cookie测试] 测试知乎连接失败:', error);
      return {
        success: false,
        message: errorMsg
      };
    }
  }

  /**
   * 测试纳米连接
   * @param cookie 纳米 Cookie
   */
  async function testNamiConnection(cookie: string): Promise<TestConnectionResult> {
    try {
      console.log('[纳米Cookie测试] 开始测试纳米连接...');

      if (!cookie || cookie.trim().length === 0) {
        return {
          success: false,
          message: 'Cookie 不能为空'
        };
      }

      // 验证 Cookie 中是否包含 Auth-Token
      const provider = getCookieProvider('nami');
      if (provider && !validateCookie(cookie, provider.cookieValidation)) {
        return {
          success: false,
          message: 'Cookie 中缺少 Auth-Token 字段（请点击"自动获取Cookie"按钮）'
        };
      }

      // 从 Cookie 中提取 Auth-Token
      const authTokenMatch = cookie.match(/Auth-Token=([^;]+)/);
      const authToken = authTokenMatch ? authTokenMatch[1] : '';

      if (!authToken) {
        return {
          success: false,
          message: 'Cookie 中未找到 Auth-Token，请重新获取'
        };
      }

      try {
        const successMessage = await invoke<string>('test_nami_connection', { cookie, authToken });
        console.log('[纳米Cookie测试] ✓ 测试成功');
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
      console.error('[纳米Cookie测试] 测试纳米连接失败:', error);
      return {
        success: false,
        message: errorMsg
      };
    }
  }

  /**
   * 测试哔哩哔哩连接
   * @param cookie 哔哩哔哩 Cookie
   */
  async function testBilibiliConnection(cookie: string): Promise<TestConnectionResult> {
    try {
      console.log('[哔哩哔哩Cookie测试] 开始测试哔哩哔哩连接...');

      if (!cookie || cookie.trim().length === 0) {
        return {
          success: false,
          message: 'Cookie 不能为空'
        };
      }

      // 验证 Cookie 中是否包含必要字段
      if (!cookie.includes('SESSDATA=') || !cookie.includes('bili_jct=')) {
        return {
          success: false,
          message: 'Cookie 中缺少 SESSDATA 或 bili_jct 字段'
        };
      }

      try {
        const successMessage = await invoke<string>('test_bilibili_connection', { bilibiliCookie: cookie });
        console.log('[哔哩哔哩Cookie测试] ✓ 测试成功');
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
      console.error('[哔哩哔哩Cookie测试] 测试哔哩哔哩连接失败:', error);
      return {
        success: false,
        message: errorMsg
      };
    }
  }

  /**
   * 测试超星连接
   * @param cookie 超星 Cookie
   */
  async function testChaoxingConnection(cookie: string): Promise<TestConnectionResult> {
    try {
      console.log('[超星Cookie测试] 开始测试超星连接...');

      if (!cookie || cookie.trim().length === 0) {
        return {
          success: false,
          message: 'Cookie 不能为空'
        };
      }

      // 验证 Cookie 中是否包含 _uid 字段
      if (!cookie.includes('_uid=')) {
        return {
          success: false,
          message: 'Cookie 中缺少 _uid 字段（请点击"自动获取Cookie"按钮）'
        };
      }

      try {
        const successMessage = await invoke<string>('test_chaoxing_connection', { chaoxingCookie: cookie });
        console.log('[超星Cookie测试] ✓ 测试成功');
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
      console.error('[超星Cookie测试] 测试超星连接失败:', error);
      return {
        success: false,
        message: errorMsg
      };
    }
  }

  /**
   * 打开 WebView 登录窗口获取 Cookie
   * @param serviceId 服务标识（weibo/nowcoder/zhihu/nami/bilibili/chaoxing）
   */
  async function openCookieWebView(serviceId: ServiceType): Promise<void> {
    let errorOccurred = false;
    let errorMessage = '';

    try {
      // 获取 Cookie 提供者配置
      const provider = getCookieProvider(serviceId);
      if (!provider) {
        toast.showConfig('error', TOAST_MESSAGES.auth.unsupportedService(serviceId));
        console.error('[WebView登录窗口] 不支持的服务:', serviceId);
        return;
      }

      console.log(`[WebView登录窗口] 开始打开 ${provider.name} 登录窗口`);

      // 检查窗口是否已存在
      try {
        const existingWindow = await WebviewWindow.getByLabel('login-webview');
        if (existingWindow) {
          console.log('[WebView登录窗口] 窗口已存在，聚焦');
          await existingWindow.setFocus();
          return;
        }
      } catch (error) {
        console.warn('[WebView登录窗口] 检查已存在窗口失败:', error);
        // 窗口不存在是正常情况，继续创建新窗口
      }

      // 创建新的Cookie获取窗口（通过 URL 参数传递服务类型）
      try {
        const loginWindow = new WebviewWindow('login-webview', {
          url: `/login-webview.html?service=${serviceId}`,
          title: `${provider.name}登录 - 自动获取Cookie`,
          width: 500,
          height: 800,
          resizable: true,
          center: true,
          alwaysOnTop: false,
          decorations: true,
          transparent: false,
        });

        loginWindow.once('tauri://created', () => {
          console.log(`[WebView登录窗口] ✓ ${provider.name} 窗口创建成功`);
        });

        loginWindow.once('tauri://error', (e: unknown) => {
          errorOccurred = true;
          errorMessage = e && typeof e === 'object' && 'payload' in e ? String((e as { payload: unknown }).payload) : String(e);
          console.error('[WebView登录窗口] 窗口创建失败:', errorMessage);
        });

        // 等待窗口初始化
        await new Promise((resolve) => setTimeout(resolve, 200));

        if (errorOccurred) {
          throw new Error(errorMessage);
        }
      } catch (createError) {
        errorOccurred = true;
        errorMessage = createError instanceof Error ? createError.message : String(createError);
        console.error('[WebView登录窗口] 创建窗口异常:', createError);
        throw createError;
      }
    } catch (error) {
      // 统一错误处理 - 只在这里显示一次toast
      if (!errorOccurred) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      console.error('[WebView登录窗口] 打开窗口失败:', errorMessage || error);
      toast.showConfig('error', TOAST_MESSAGES.auth.loginWindowFailed(errorMessage || String(error)));
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
            console.error('[Cookie更新] 无效的 payload 格式:', typeof payload);
            return;
          }

          console.log(`[Cookie更新] 收到 ${serviceId} Cookie更新事件，长度:`, cookie?.length || 0);

          // 验证 Cookie
          if (!cookie || typeof cookie !== 'string' || cookie.trim().length === 0) {
            console.error('[Cookie更新] Cookie为空或无效');
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
            console.error('[Cookie更新] 保存Cookie失败:', error);
            toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(errorMsg));
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error('[Cookie更新] 处理Cookie更新事件失败:', error);
          toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(errorMsg));
        }
      });

      console.log('[Cookie更新] ✓ 监听器已设置（支持多服务）');
      return unlisten;
    } catch (error) {
      console.error('[Cookie更新] 设置监听器失败:', error);
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
