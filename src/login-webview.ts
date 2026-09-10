// 登录窗口 Vue 应用入口
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import { PicNexusPreset } from '@/theme/preset';
import LoginPanel from '@/components/login/LoginPanel.vue';
import { COOKIE_PROVIDERS, type CookieProvider } from '@/config/cookieProviders';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { initLoginTheme } from '@/composables/useLoginTheme';
import { createLogger } from '@/utils/logger';

const appWindow = getCurrentWindow();
const log = createLogger('LoginWebview');

// 引入样式（顺序重要）
import 'primeicons/primeicons.css';
import './styles/app.css';
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

    // 使用事件驱动的 Cookie 监控（NavigationCompleted）。仅 Windows 支持；
    // WebView2 事件通道建不起来时后端自动降级为轮询，前端无需感知。
    // 非 Windows 平台这里直接抛错（提取依赖 WebView2，没有跨平台实现）。
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
