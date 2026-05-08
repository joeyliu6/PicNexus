// 登录窗口 Vue 应用入口
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import { PicNexusPreset } from './theme';
import LoginPanel from './components/login/LoginPanel.vue';
import { COOKIE_PROVIDERS, type CookieProvider } from './config/cookieProviders';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { initLoginTheme } from './composables/useLoginTheme';
import { createLogger } from './utils/logger';

const appWindow = getCurrentWindow();
const log = createLogger('LoginWebview');

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

log.info('初始化登录窗口', { serviceId, provider });

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
    log.info('开始登录', { serviceId, providerName: provider.name });

    // 先注册 ready 监听，避免错过 Rust 端瞬时发出的 ready 事件
    const { listen } = await import('@tauri-apps/api/event');
    const readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    unlistenReady = await listen('cookie-monitoring-ready', () => {
      finishReady();
    });

    readyTimer = setTimeout(() => {
      log.warn('cookie-monitoring-ready 超时，继续执行');
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

    log.info('Cookie 事件监控已启动', { serviceId });

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
    log.error('启动登录失败', error);
    alert(`启动 Cookie 监控失败\n${error}\n请重新打开登录窗口`);
  }
}

/**
 * 手动获取 Cookie（备用方案）
 */
async function handleGetCookie() {
  try {
    log.info('手动获取 Cookie', { serviceId });

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
      log.warn('请求头 Cookie 获取失败', err);
    }

    // 备用：从 document.cookie 获取
    if (!cookie || cookie.trim().length === 0) {
      cookie = document.cookie.trim();
      log.info('使用 document.cookie 兜底');
    }

    if (!cookie || cookie.trim().length === 0) {
      alert(`未检测到 Cookie，请确保已登录 ${provider.name}`);
      return;
    }

    // 保存 Cookie
    await invoke('save_cookie_from_login', {
      cookie: cookie.trim(),
      serviceId,
      requiredFields: provider.cookieValidation?.requiredFields || [],
      anyOfFields: provider.cookieValidation?.anyOfFields || []
    });

    log.info('Cookie 保存成功', { serviceId });

    // 2秒后关闭窗口
    setTimeout(() => appWindow.close(), 2000);
  } catch (error) {
    log.error('获取 Cookie 失败', error);
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
    log.error('关闭窗口失败', error);
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
  log.info('Vue app 已挂载，窗口已显示');
}

// 启动应用
bootstrap().catch(error => {
  log.error('Bootstrap 失败', error);
  invoke('show_login_window').catch(() => {});
});
