// src/main.ts
// 新架构的主入口文件 - 使用 Vue 3 + PrimeVue 单应用模式

import { createApp } from 'vue';
import App from './App.vue';

// PrimeVue 相关导入
import PrimeVue from 'primevue/config';
import { PicNexusPreset } from './theme';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import Tooltip from 'primevue/tooltip';
import Ripple from 'primevue/ripple';

// 上传器初始化
import { initializeUploaders } from './uploaders';

// 配置和 Store 导入
import { Store } from './store';
import { DEFAULT_CONFIG, UserConfig } from './config/types';

// Analytics 服务
import { useAnalytics } from './composables/useAnalytics';

// PrimeVue 样式
import 'primeicons/primeicons.css';
import './theme/transitions.css';
import './theme/dark-theme.css';
import './theme/light-theme.css';

// 创建 Vue 应用实例
const app = createApp(App);

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
  const configStore = new Store('.settings.dat');

  try {
    const config = await configStore.get<UserConfig>('config');
    if (!config) {
      // 初始化配置
      console.log('[初始化] 创建默认配置...');
      await configStore.set('config', DEFAULT_CONFIG);
      await configStore.save();
      console.log('[初始化] ✓ 已创建默认配置，启用的图床:', DEFAULT_CONFIG.enabledServices);
    } else {
      console.log('[初始化] ✓ 配置已存在，启用的图床:', config.enabledServices);
    }
  } catch (error) {
    console.error('[初始化] 配置同步失败:', error);
  }
}

// 初始化上传器和配置同步
initializeUploaders();
ensureConfigSync().then(() => {
  // 配置同步完成后初始化 Analytics
  const { initialize } = useAnalytics();
  initialize().catch(err => console.warn('[Analytics] 初始化失败（非致命错误）:', err));
});

// 挂载应用
app.mount('#app');

console.log('[App] PicNexus 已启动');
