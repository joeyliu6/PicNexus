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
import { initializeUploaders, syncCustomS3Uploaders, syncWebDAVUploaders } from './uploaders';

// 配置和 Store 导入
import { configStore } from './store/instances';
import { StoreError } from './store';
import { DEFAULT_CONFIG, UserConfig } from './config/types';
import { startupFlags } from './store/startupFlags';
import { purgeOrphanFieldSecrets } from './security/fieldSecrets';
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
 * 清理存量孤儿密文：解不开的字段级密文就地清空，名字交给 App.vue 提示用户重填
 *
 * 来源是历史上的缺陷——设备份密码只换了外层信封的钥匙，内层 `passwordEncrypted`
 * 变成谁也开不了的孤儿（根因已由 `rekeyFieldSecrets` 修掉，这里只处理存量）。
 * 不清的话界面会一直显示「✓ 已保存」，用户直到上传失败才知道密码是死的。
 *
 * ⚠️ 必须跑在 `ensureConfigSync()` **之后**：配置读得出来才说明外层信封开得了、
 * 钥匙是对的，此时内层还解不开才能判定为孤儿。顺序反了会把整份配置误清空。
 */
async function purgeOrphanSecrets() {
  try {
    const config = await configStore.get<UserConfig>('config');
    if (!config) return;

    // 在副本上改，不动 configStore 缓存里的那个对象
    const draft = structuredClone(config);
    const cleared = await purgeOrphanFieldSecrets(draft);
    if (cleared.length === 0) return;   // 没有孤儿就不写盘，别每次启动都白写一次

    await configStore.set('config', draft);
    startupFlags.orphanSecretLabels = cleared;
  } catch (error) {
    log.warn('孤儿密文探测失败（跳过，不影响启动）:', error);
  }
}

/**
 * 注册依赖用户配置的多实例上传器（custom_s3:xxx / webdav:xxx）
 *
 * Why 放在启动流程：这两类上传器的 serviceId 由用户 profile 动态生成，此前只在
 * 设置页打开时才同步。冷启动后直接用托盘菜单或全局快捷键上传，UploaderFactory
 * 里还没有对应注册，会直接报「未知的图床服务」。
 */
async function syncDynamicUploaders() {
  try {
    const config = await configStore.get<UserConfig>('config');
    syncCustomS3Uploaders(config?.custom_s3_profiles ?? []);
    syncWebDAVUploaders(config?.webdav_profiles ?? []);
  } catch (error) {
    log.warn('多实例上传器注册失败（可在设置页保存配置后恢复）:', error);
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

  // 2.1 清理存量孤儿密文（必须在配置读取成功之后、上传器注册之前）
  await purgeOrphanSecrets();

  // 2.2 注册多实例上传器（依赖上一步的配置）
  await syncDynamicUploaders();

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
