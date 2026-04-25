// 登录窗口 Vue 应用入口
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import { PicNexusPreset } from './theme';
import LoginPanel from './components/login/LoginPanel.vue';
import { COOKIE_PROVIDERS, type CookieProvider } from './config/cookieProviders';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { initLoginTheme } from './composables/useLoginTheme';

const appWindow = getCurrentWindow();

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
  let unlistenReady: (() => void) | null = null;
  let readyResolved = false;
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveReady!: () => void;

  const finishReady = () => {
    if (readyResolved) return;
    readyResolved = true;
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    if (unlistenReady) {
      unlistenReady();
      unlistenReady = null;
    }
    resolveReady();
  };

  try {
    console.log(`[LoginWebview] Starting login for ${provider.name}`);

    // 先注册 ready 监听，避免错过 Rust 端瞬时发出的 ready 事件
    const { listen } = await import('@tauri-apps/api/event');
    const readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    unlistenReady = await listen('cookie-monitoring-ready', () => {
      finishReady();
    });

    readyTimer = setTimeout(() => {
      console.warn('[LoginWebview] cookie-monitoring-ready timeout, proceeding anyway');
      finishReady();
    }, 3000);

    // 使用事件驱动的 Cookie 监控（NavigationCompleted），非 Windows 自动降级到轮询
    await invoke('setup_cookie_event_monitoring', {
      serviceId,
      targetDomains: provider.domains,
      requiredFields: provider.cookieValidation?.requiredFields || [],
      anyOfFields: provider.cookieValidation?.anyOfFields || [],
      fieldValueChecks: provider.cookieValidation?.fieldValueChecks || {},
      timeoutMs: provider.cookieValidation?.timeoutMs,
    });

    console.log(`[LoginWebview] Cookie event monitoring started`);

    // 等待 Rust 端 NavigationCompleted handler 注册完成后再跳转
    await readyPromise;

    // 跳转到登录页面（DOM 将被第三方网站接管）
    window.location.href = provider.loginUrl;
  } catch (error) {
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    if (unlistenReady) {
      unlistenReady();
      unlistenReady = null;
    }
    console.error('[LoginWebview] Start login failed:', error);
    alert(`启动 Cookie 监控失败\n${error}\n请重新打开登录窗口`);
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
        serviceId,
        targetDomains: provider.domains,
        requiredFields: provider.cookieValidation?.requiredFields || [],
        anyOfFields: provider.cookieValidation?.anyOfFields || []
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
      serviceId,
      requiredFields: provider.cookieValidation?.requiredFields || [],
      anyOfFields: provider.cookieValidation?.anyOfFields || []
    });

    console.log(`[LoginWebview] Cookie saved successfully`);

    // 2秒后关闭窗口
    setTimeout(() => appWindow.close(), 2000);
  } catch (error) {
    console.error('[LoginWebview] Get cookie failed:', error);
    alert(`获取 Cookie 失败\n${error}\n请确认已登录后重试`);
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

  // CSS 和 Vue 已就绪，通知 Rust 端显示窗口（避免白屏闪烁）
  await invoke('show_login_window');
  console.log('[LoginWebview] Vue app mounted, window shown');
}

// 启动应用
bootstrap().catch(error => {
  console.error('[LoginWebview] Bootstrap failed:', error);
  invoke('show_login_window').catch(() => {});
});
