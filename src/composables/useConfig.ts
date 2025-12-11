// src/composables/useConfig.ts
// 配置管理 Composable - 封装配置加载、保存、测试连接等功能

import { ref, Ref } from 'vue';
import { invoke } from '@tauri-apps/api/tauri';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/window';
import { getClient, ResponseType } from '@tauri-apps/api/http';
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

// --- STORES ---
const configStore = new Store('.settings.dat');

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

  // 配置对象
  const config: Ref<UserConfig> = ref<UserConfig>({ ...DEFAULT_CONFIG });

  // 加载状态
  const isLoading = ref(false);

  // 保存状态
  const isSaving = ref(false);

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
        toast.error('读取配置失败', '已使用默认配置');
        return config.value;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[配置管理] 加载配置失败:', error);
      toast.error('加载配置失败', errorMsg);
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

      // 验证必填字段
      if (newConfig.outputFormat === 'r2' && !newConfig.services?.r2?.publicDomain?.trim()) {
        const errorMsg = '当输出格式为 R2 时，公开访问域名不能为空！';
        console.warn('[配置管理] 验证失败:', errorMsg);
        toast.error('验证失败', errorMsg);
        return;
      }

      // 验证至少有一个可用图床
      if (!newConfig.availableServices || newConfig.availableServices.length === 0) {
        toast.error('验证失败', '至少需要启用一个图床');
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
      try {
        await configStore.set('config', newConfig);
        await configStore.save();

        // 更新内存中的配置
        config.value = { ...newConfig };

        console.log('[配置管理] ✓ 配置保存成功');
        if (!silent) {
          toast.success('保存成功', '配置已保存');
        }
      } catch (saveError) {
        const errorMsg = saveError instanceof Error ? saveError.message : String(saveError);
        console.error('[配置管理] 保存配置失败:', saveError);
        toast.error('保存失败', errorMsg);
        throw saveError;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[配置管理] 保存配置失败:', error);
      toast.error('保存失败', errorMsg);
      throw error;
    } finally {
      isSaving.value = false;
    }
  }

  /**
   * 测试微博连接
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
        // 获取 HTTP 客户端
        const client = await getClient();

        // 发送测试请求（带超时保护）
        const response = await client.get<{ code: string }>(
          'https://weibo.com/aj/onoff/getstatus?sid=0',
          {
            responseType: ResponseType.JSON,
            headers: {
              Cookie: cookie,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
            },
            timeout: 10000, // 10秒超时
          }
        );

        // 检查 HTTP 状态码
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            return {
              success: false,
              message: `HTTP ${response.status}: Cookie 无效或已过期`
            };
          } else if (response.status >= 500) {
            return {
              success: false,
              message: `HTTP ${response.status}: 微博服务器错误`
            };
          } else {
            return {
              success: false,
              message: `HTTP ${response.status}: 请求失败`
            };
          }
        }

        // 检查响应数据
        if (!response.data) {
          return {
            success: false,
            message: '响应数据为空'
          };
        }

        // 验证返回码
        if (response.data.code === '100000') {
          console.log('[Cookie测试] ✓ Cookie 有效');
          return {
            success: true,
            message: 'Cookie 有效（已登录）'
          };
        } else {
          return {
            success: false,
            message: `Cookie 无效或已过期 (返回码: ${response.data.code || '未知'})`
          };
        }
      } catch (err: any) {
        const errorStr = err?.toString() || String(err) || '';
        const errorMsg = err?.message || errorStr || '';
        const fullError = (errorMsg + ' ' + errorStr).toLowerCase();

        console.error('[Cookie测试] 测试失败:', err);

        if (fullError.includes('json') || fullError.includes('parse')) {
          return {
            success: false,
            message: 'Cookie 完全无效或格式错误（无法解析响应）'
          };
        } else if (fullError.includes('network') || fullError.includes('fetch') || fullError.includes('connection')) {
          return {
            success: false,
            message: '网络连接失败，请检查网络连接或防火墙设置'
          };
        } else if (fullError.includes('timeout') || fullError.includes('超时')) {
          return {
            success: false,
            message: '请求超时，请检查网络连接'
          };
        } else {
          const shortError = errorMsg.length > 100 ? errorMsg.substring(0, 100) + '...' : errorMsg;
          return {
            success: false,
            message: shortError || '未知错误'
          };
        }
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
   * 打开 WebView 登录窗口获取 Cookie
   * @param serviceId 服务标识（weibo/nowcoder/zhihu/nami）
   */
  async function openCookieWebView(serviceId: ServiceType): Promise<void> {
    let errorOccurred = false;
    let errorMessage = '';

    try {
      // 获取 Cookie 提供者配置
      const provider = getCookieProvider(serviceId);
      if (!provider) {
        toast.error('不支持的服务', `${serviceId} 不支持自动获取 Cookie`);
        console.error('[WebView登录窗口] 不支持的服务:', serviceId);
        return;
      }

      console.log(`[WebView登录窗口] 开始打开 ${provider.name} 登录窗口`);

      // 检查窗口是否已存在
      try {
        const existingWindow = WebviewWindow.getByLabel('login-webview');
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

        loginWindow.once('tauri://error', (e) => {
          errorOccurred = true;
          errorMessage = e && typeof e === 'object' && 'payload' in e ? String(e.payload) : String(e);
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
      toast.error('打开登录窗口失败', errorMessage || String(error), 5000);
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
            toast.error('Cookie 无效', '接收到的 Cookie 为空');
            return;
          }

          const trimmedCookie = cookie.trim();

          try {
            // 调用回调函数处理 Cookie 更新
            await onCookieUpdate(serviceId, trimmedCookie);

            // 显示成功提示
            const provider = getCookieProvider(serviceId);
            const serviceName = provider?.name || serviceId;
            toast.success('Cookie 已更新', `${serviceName} Cookie 已自动填充并保存！`);

          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('[Cookie更新] 保存Cookie失败:', error);
            toast.error('保存失败', errorMsg);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error('[Cookie更新] 处理Cookie更新事件失败:', error);
          toast.error('处理失败', errorMsg);
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
    prefixList: string[],
    savedConfig?: LinkPrefixConfig
  ): LinkPrefixConfig {
    return {
      enabled: prefixEnabled,
      selectedIndex: selectedIndex,
      prefixList: prefixList.length > 0 ? prefixList : DEFAULT_PREFIXES,
      // 向后兼容：保留旧的 activePrefix 字段
      activePrefix: savedConfig?.activePrefix || (prefixList[selectedIndex] || DEFAULT_PREFIXES[0])
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

    // Cookie 自动获取
    openCookieWebView,
    setupCookieListener,

    // 链接前缀工具
    getLinkPrefixConfig,
    getActivePrefix
  };
}
