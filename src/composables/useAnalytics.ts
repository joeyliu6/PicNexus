// src/composables/useAnalytics.ts
// Google Analytics 4 服务模块

import { ref, computed } from 'vue';
import { useConfigManager } from './useConfig';

/** GA4 全局类型声明 */
declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
    // 用于禁用 GA 的标志
    [key: `ga-disable-${string}`]: boolean;
  }
}

/** 硬编码的 Measurement ID */
const GA_MEASUREMENT_ID = 'G-E8LW7TS55J';

/** 全局状态 */
const isInitialized = ref(false);
const isEnabled = ref(true);

/**
 * GA4 事件名称常量
 */
export const GA_EVENTS = {
  /** 应用启动 */
  APP_LAUNCH: 'app_launch',
  /** 上传开始 */
  UPLOAD_START: 'upload_start',
  /** 上传成功 */
  UPLOAD_SUCCESS: 'upload_success',
  /** 上传失败 */
  UPLOAD_FAILED: 'upload_failed',
  /** 切换图床 */
  SERVICE_SWITCH: 'service_switch',
  /** 切换主题 */
  THEME_CHANGE: 'theme_change'
} as const;

/**
 * 动态加载 gtag.js 脚本
 */
function loadGtagScript(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 检查是否已加载
    if (document.querySelector(`script[src*="googletagmanager.com/gtag"]`)) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;

    script.onload = () => resolve();
    script.onerror = () => reject(new Error('加载 gtag.js 失败'));

    document.head.appendChild(script);
  });
}

/**
 * Analytics 服务 Composable
 */
export function useAnalytics() {
  const configManager = useConfigManager();

  /**
   * 初始化 GA4
   * 加载 gtag.js 脚本并配置
   */
  async function initialize(): Promise<boolean> {
    // 避免重复初始化
    if (isInitialized.value) {
      console.log('[Analytics] 已初始化，跳过');
      return true;
    }

    try {
      // 从配置中读取设置
      const config = await configManager.loadConfig();
      const analyticsConfig = config.analytics;

      // 检查是否启用
      if (analyticsConfig?.enabled === false) {
        console.log('[Analytics] 用户已禁用，跳过初始化');
        isEnabled.value = false;
        return false;
      }

      isEnabled.value = true;

      // 初始化 dataLayer
      window.dataLayer = window.dataLayer || [];
      window.gtag = function(...args: unknown[]) {
        window.dataLayer.push(args);
      };

      // 设置初始时间戳
      window.gtag('js', new Date());

      // 配置 GA4（带隐私保护设置）
      window.gtag('config', GA_MEASUREMENT_ID, {
        // 桌面应用不需要页面浏览事件
        send_page_view: false,
        // 匿名 IP（隐私保护）
        anonymize_ip: true
      });

      // 动态加载 gtag.js 脚本
      await loadGtagScript(GA_MEASUREMENT_ID);

      isInitialized.value = true;
      console.log('[Analytics] ✓ GA4 初始化成功');

      // 发送应用启动事件
      trackEvent(GA_EVENTS.APP_LAUNCH, {
        app_version: '3.0.0',
        platform: 'tauri_desktop'
      });

      return true;
    } catch (error) {
      console.error('[Analytics] 初始化失败:', error);
      return false;
    }
  }

  /**
   * 发送事件追踪
   * @param eventName 事件名称
   * @param params 事件参数
   */
  function trackEvent(eventName: string, params?: Record<string, unknown>): void {
    // 检查是否启用
    if (!isEnabled.value || !isInitialized.value) {
      return;
    }

    try {
      window.gtag('event', eventName, {
        ...params,
        app_platform: 'tauri_desktop'
      });

      console.log(`[Analytics] 事件追踪: ${eventName}`, params);
    } catch (error) {
      console.error('[Analytics] 事件追踪失败:', error);
    }
  }

  /**
   * 设置用户属性
   * @param properties 用户属性
   */
  function setUserProperties(properties: Record<string, unknown>): void {
    if (!isEnabled.value || !isInitialized.value) return;

    try {
      window.gtag('set', 'user_properties', properties);
    } catch (error) {
      console.error('[Analytics] 设置用户属性失败:', error);
    }
  }

  /**
   * 启用 Analytics
   */
  async function enable(): Promise<void> {
    isEnabled.value = true;

    // 更新配置
    const config = await configManager.loadConfig();
    if (config.analytics) {
      config.analytics.enabled = true;
    } else {
      config.analytics = { enabled: true };
    }
    await configManager.saveConfig(config, true);

    // 如果尚未初始化，尝试初始化
    if (!isInitialized.value) {
      await initialize();
    }

    // 移除禁用标志
    window[`ga-disable-${GA_MEASUREMENT_ID}`] = false;

    console.log('[Analytics] 已启用');
  }

  /**
   * 禁用 Analytics
   * 停止所有追踪
   */
  async function disable(): Promise<void> {
    isEnabled.value = false;

    // 更新配置
    const config = await configManager.loadConfig();
    if (config.analytics) {
      config.analytics.enabled = false;
    } else {
      config.analytics = { enabled: false };
    }
    await configManager.saveConfig(config, true);

    // 设置禁用标志
    window[`ga-disable-${GA_MEASUREMENT_ID}`] = true;

    console.log('[Analytics] 已禁用');
  }

  /**
   * 检查是否已启用并初始化
   */
  const analyticsEnabled = computed(() => isEnabled.value && isInitialized.value);

  return {
    // 状态
    isInitialized,
    isEnabled,
    analyticsEnabled,

    // 方法
    initialize,
    trackEvent,
    setUserProperties,
    enable,
    disable,

    // 事件常量
    GA_EVENTS
  };
}
