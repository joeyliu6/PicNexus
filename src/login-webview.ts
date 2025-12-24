// src/login-webview.ts
// 登录窗口 Vue 应用入口
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import { PicNexusPreset } from './theme';
import LoginPanel from './components/login/LoginPanel.vue';
import { COOKIE_PROVIDERS, type CookieProvider } from './config/cookieProviders';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

// 获取当前窗口实例
const appWindow = getCurrentWindow();
import { initLoginTheme } from './composables/useLoginTheme';

// 引入样式（顺序重要）
import 'primeicons/primeicons.css';
import './style.css';
import './theme/dark-theme.css';
import './theme/light-theme.css';
import './theme/transitions.css';

// 解析 URL 参数获取服务类型
const urlParams = new URLSearchParams(window.location.search);
const serviceId = urlParams.get('service') || 'weibo';
const provider: CookieProvider = COOKIE_PROVIDERS[serviceId] || COOKIE_PROVIDERS['weibo'];

console.log(`[LoginWebview] Service: ${serviceId}, Provider:`, provider);

/**
 * 开始登录处理
 */
async function handleStartLogin() {
  try {
    console.log(`[LoginWebview] Starting login for ${provider.name}`);

    // 启动后端 Cookie 监控
    await invoke('start_cookie_monitoring', {
      service_id: serviceId,
      target_domains: provider.domains,  // 传入完整的域名数组
      required_fields: provider.cookieValidation?.requiredFields || [],
      any_of_fields: provider.cookieValidation?.anyOfFields || [],
      initial_delay_ms: provider.cookieValidation?.monitoringDelay?.initialDelayMs,
      polling_interval_ms: provider.cookieValidation?.monitoringDelay?.pollingIntervalMs
    });

    console.log(`[LoginWebview] Cookie monitoring started`);

    // 跳转到登录页面（DOM 将被第三方网站接管）
    window.location.href = provider.loginUrl;
  } catch (error) {
    console.error('[LoginWebview] Start login failed:', error);
    alert(`启动监控失败: ${error}`);
  }
}

/**
 * 手动获取 Cookie（备用方案）
 */
async function handleGetCookie() {
  try {
    console.log(`[LoginWebview] Manual cookie retrieval`);

    let cookie: string | null = null;

    // 尝试从请求头获取（Windows 专用）
    try {
      cookie = await invoke<string>('get_request_header_cookie', {
        service_id: serviceId,
        target_domains: provider.domains,  // 传入完整的域名数组
        required_fields: provider.cookieValidation?.requiredFields || [],
        any_of_fields: provider.cookieValidation?.anyOfFields || []
      });
    } catch (err) {
      console.warn('[LoginWebview] Request header cookie failed:', err);
    }

    // 备用：从 document.cookie 获取
    if (!cookie || cookie.trim().length === 0) {
      cookie = document.cookie.trim();
      console.log('[LoginWebview] Using document.cookie');
    }

    if (!cookie || cookie.trim().length === 0) {
      alert(`未检测到Cookie，请确保已登录${provider.name}`);
      return;
    }

    // 保存 Cookie
    await invoke('save_cookie_from_login', {
      cookie: cookie.trim(),
      service_id: serviceId,
      required_fields: provider.cookieValidation?.requiredFields || [],
      any_of_fields: provider.cookieValidation?.anyOfFields || []
    });

    console.log(`[LoginWebview] Cookie saved successfully`);

    // 2秒后关闭窗口
    setTimeout(() => appWindow.close(), 2000);
  } catch (error) {
    console.error('[LoginWebview] Get cookie failed:', error);
    alert(`获取Cookie失败: ${error}`);
  }
}

/**
 * 关闭窗口
 */
async function handleClose() {
  try {
    await appWindow.close();
  } catch (error) {
    console.error('[LoginWebview] Close window failed:', error);
  }
}

/**
 * 启动 Vue 应用
 */
async function bootstrap() {
  // 初始化主题
  await initLoginTheme();

  // 创建 Vue 应用
  const app = createApp(LoginPanel, {
    provider,
    onStartLogin: handleStartLogin,
    onGetCookie: handleGetCookie,
    onClose: handleClose
  });

  // 配置 PrimeVue
  app.use(PrimeVue, {
    theme: {
      preset: PicNexusPreset,
      options: {
        darkModeSelector: '.dark-theme',
        cssLayer: {
          name: 'primevue',
          order: 'reset, primevue, app'
        }
      }
    },
    ripple: true
  });

  // 挂载应用
  app.mount('#app');

  console.log('[LoginWebview] Vue app mounted');
}

// 启动应用
bootstrap().catch(error => {
  console.error('[LoginWebview] Bootstrap failed:', error);
});
