// 新架构的主入口文件 - 使用 Vue 3 + PrimeVue 单应用模式

import { createApp } from 'vue';
import App from './App.vue';

// PrimeVue 相关导入
import PrimeVue from 'primevue/config';
import { PicNexusPreset } from './theme/preset';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import Tooltip from 'primevue/tooltip';
import Ripple from 'primevue/ripple';

// 上传器初始化
import { initializeUploaders } from './uploaders';

// 配置和 Store 导入
import { configStore } from './store/instances';
import { StoreError } from './store';
import { DEFAULT_CONFIG, UserConfig } from './config/types';
import { startupFlags } from './store/startupFlags';
import { createLogger } from './utils/logger';

// Analytics 服务
import { useAnalytics } from './composables/useAnalytics';

// 备份文件清理
import { cleanupStoreBackups } from './utils/storeCleanup';

// PrimeVue 样式
import 'primeicons/primeicons.css';
import './theme/dark-theme.css';
import './theme/light-theme.css';
import './theme/primevue-overrides.css';
import './theme/transitions.css';
import './styles/motion.css';
import './styles/bottom-bar-buttons.css';

const log = createLogger('Init');

// 创建 Vue 应用实例
const app = createApp(App);

// 全局错误处理 — 防止未捕获异常导致渲染树崩溃（白屏）
app.config.errorHandler = (err, _instance, info) => {
  log.error(`Vue 错误 [${info}]:`, err);
};

window.addEventListener('unhandledrejection', (event) => {
  log.error('未处理的 Promise 拒绝:', event.reason);
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  log.error('未捕获的全局错误:', event.error);
});

// 配置 PrimeVue
app.use(PrimeVue, {
  theme: {
    preset: PicNexusPreset,
    options: {
      darkModeSelector: '.dark-theme',
      cssLayer: { name: 'primevue', order: 'reset, primevue, app' }
    }
  },
  ripple: true
});

// 配置 PrimeVue 服务
app.use(ToastService);
app.use(ConfirmationService);
app.directive('tooltip', Tooltip);
app.directive('ripple', Ripple);

/**
 * 确保配置同步
 * 在应用启动时检查并初始化配置
 */
async function ensureConfigSync() {
  try {
    const config = await configStore.get<UserConfig>('config');
    if (!config) {
      // 初始化配置
      await configStore.set('config', DEFAULT_CONFIG);
      await configStore.save();
      log.debug('已创建默认配置，启用的图床:', DEFAULT_CONFIG.enabledServices);
    } else {
      log.debug('配置已存在，启用的图床:', config.enabledServices);
    }
  } catch (error) {
    log.error('配置同步失败:', error);
    // 解密失败（密钥不匹配）→ 数据不可恢复，用 setDirect 覆写为默认配置
    if (error instanceof StoreError) {
      log.warn('检测到密钥不匹配，配置将重置为默认值（旧配置无法恢复）');
      try {
        await configStore.setDirect({ config: DEFAULT_CONFIG });
        startupFlags.configResetDueToKeyMismatch = true;
        log.debug('配置已重置为默认值');
      } catch (resetError) {
        log.error('重置配置失败:', resetError);
      }
    }
  }
}

/**
 * 应用启动入口
 * 确保配置加载完成后再挂载应用，避免竞态条件
 */
async function startApp() {
  // 1. 初始化上传器（同步操作）
  initializeUploaders();

  // 2. 确保配置同步完成（等待异步操作）
  await ensureConfigSync();

  // 3. 初始化 Analytics（非阻塞，失败不影响应用）
  const { initialize } = useAnalytics();
  initialize().catch(err => log.warn('Analytics 初始化失败（非致命错误）:', err));

  // 4. 清理过期备份文件（非阻塞，失败不影响应用）
  cleanupStoreBackups().catch(() => {});

  // 5. 挂载应用（确保配置已加载）
  app.mount('#app');
}

// 启动应用
startApp().catch(err => {
  log.error('启动失败:', err);
  // 即使初始化失败，也尝试挂载应用，让用户看到错误界面
  app.mount('#app');
});
