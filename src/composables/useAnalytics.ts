// Google Analytics 4 Measurement Protocol 实现
// 专为桌面应用设计，使用 HTTP 直接请求代替 gtag.js

import { ref, computed } from 'vue';
import { Store } from '../store';
import { fetch } from '@tauri-apps/plugin-http';
import { getVersion } from '@tauri-apps/api/app';
import { UserConfig } from '../config/types';

/** GA4 配置 */
const GA_MEASUREMENT_ID = 'G-E8LW7TS55J';
const GA_API_SECRET = 'RBX8PUEPRKyUpUA6IWp4Bg';
const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

/** 会话超时时间（30 分钟） */
const SESSION_TIMEOUT = 30 * 60 * 1000;

/** 全局状态 */
const isInitialized = ref(false);
const isEnabled = ref(true);

/** 全局缓存（修复 #1：移到全局作用域，所有 useAnalytics 实例共享） */
let cachedClientId: string | null = null;
let cachedSessionId: string | null = null;
let cachedLastActiveTime: number = 0;
let cachedAppVersion: string | null = null;

/** Analytics 数据存储 */
interface AnalyticsData {
  clientId: string;
  sessionId: string;
  lastActiveTime: number;
}

/** 配置存储实例 */
const configStore = new Store('.settings.dat');

/**
 * GA4 事件名称常量
 * 修复 #5：仅保留实际使用的事件
 */
export const GA_EVENTS = {
  /** 应用启动 */
  APP_LAUNCH: 'app_launch'
} as const;

/**
 * 生成 UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 获取应用版本号
 * 修复 #3：从 Tauri API 动态获取，避免硬编码
 */
async function getAppVersion(): Promise<string> {
  if (cachedAppVersion) {
    return cachedAppVersion;
  }

  try {
    cachedAppVersion = await getVersion();
    return cachedAppVersion;
  } catch (error) {
    // Tauri API 不可用时（如开发模式下的纯 Web 环境），返回默认值
    console.warn('[Analytics] 无法获取应用版本，使用默认值');
    return '3.0.0';
  }
}

/**
 * 获取或创建 Client ID
 * Client ID 是用户的唯一标识，首次生成后永久保存
 */
async function getOrCreateClientId(): Promise<string> {
  // 优先使用缓存
  if (cachedClientId) {
    return cachedClientId;
  }

  try {
    const data = await configStore.get<AnalyticsData>('analytics_data');
    if (data?.clientId) {
      cachedClientId = data.clientId;
      cachedLastActiveTime = data.lastActiveTime || 0;
      return data.clientId;
    }

    // 首次使用，生成新的 Client ID
    const clientId = generateUUID();
    const now = Date.now();

    await configStore.set('analytics_data', {
      clientId,
      sessionId: now.toString(),
      lastActiveTime: now
    });
    await configStore.save();

    cachedClientId = clientId;
    cachedSessionId = now.toString();
    cachedLastActiveTime = now;

    // 修复 #6：移除 Client ID 的详细日志
    console.log('[Analytics] 新用户，已生成标识');
    return clientId;
  } catch (error) {
    console.error('[Analytics] 获取 Client ID 失败:', error);
    // 返回临时 ID，不影响功能
    const tempId = generateUUID();
    cachedClientId = tempId;
    return tempId;
  }
}

/**
 * 获取或刷新 Session ID
 * 修复 #4：优化 I/O，仅在会话过期或首次调用时写入存储
 */
async function getOrRefreshSessionId(): Promise<string> {
  const now = Date.now();

  // 如果有缓存且未过期，直接使用（不写存储）
  if (cachedSessionId && cachedLastActiveTime) {
    const timeSinceLastActive = now - cachedLastActiveTime;
    if (timeSinceLastActive < SESSION_TIMEOUT) {
      // 仅更新内存缓存，不写存储
      cachedLastActiveTime = now;
      return cachedSessionId;
    }
  }

  // 会话过期或首次调用，需要创建新会话并写入存储
  try {
    const data = await configStore.get<AnalyticsData>('analytics_data');

    if (data) {
      const timeSinceLastActive = now - (data.lastActiveTime || 0);

      // 如果存储中的会话未过期，使用它
      if (timeSinceLastActive < SESSION_TIMEOUT && data.sessionId) {
        cachedSessionId = data.sessionId;
        cachedLastActiveTime = now;

        // 更新存储中的 lastActiveTime
        await configStore.set('analytics_data', {
          ...data,
          lastActiveTime: now
        });
        await configStore.save();

        return data.sessionId;
      }
    }

    // 创建新会话
    const sessionId = now.toString();
    const clientId = cachedClientId || data?.clientId || generateUUID();

    await configStore.set('analytics_data', {
      clientId,
      sessionId,
      lastActiveTime: now
    });
    await configStore.save();

    cachedClientId = clientId;
    cachedSessionId = sessionId;
    cachedLastActiveTime = now;

    console.log('[Analytics] 创建新会话');
    return sessionId;
  } catch (error) {
    console.error('[Analytics] 获取 Session ID 失败:', error);
    const fallbackSessionId = now.toString();
    cachedSessionId = fallbackSessionId;
    cachedLastActiveTime = now;
    return fallbackSessionId;
  }
}

/**
 * 发送事件到 GA4 Measurement Protocol
 */
async function sendToGA4(
  clientId: string,
  sessionId: string,
  eventName: string,
  params: Record<string, unknown> = {}
): Promise<boolean> {
  try {
    const payload = {
      client_id: clientId,
      events: [{
        name: eventName,
        params: {
          ...params,
          session_id: sessionId,
          engagement_time_msec: 100,
          app_platform: 'tauri_desktop'
        }
      }]
    };

    const url = `${GA_ENDPOINT}?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // GA4 Measurement Protocol 成功时返回 204 No Content
    if (response.status === 204 || response.status === 200) {
      console.log(`[Analytics] ✓ 事件: ${eventName}`);
      return true;
    } else {
      console.warn(`[Analytics] 事件发送返回非预期状态码: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error('[Analytics] 事件发送失败:', error);
    return false;
  }
}

/**
 * Analytics 服务 Composable
 * 使用 GA4 Measurement Protocol，适用于桌面应用
 */
export function useAnalytics() {
  /**
   * 初始化 GA4 Measurement Protocol
   */
  async function initialize(): Promise<boolean> {
    if (isInitialized.value) {
      return true;
    }

    try {
      // 修复 #7：使用 UserConfig 类型
      const config = await configStore.get<UserConfig>('config');
      if (config?.analytics?.enabled === false) {
        console.log('[Analytics] 用户已禁用，跳过初始化');
        isEnabled.value = false;
        return false;
      }

      isEnabled.value = true;

      // 获取或创建 Client ID 和 Session ID
      cachedClientId = await getOrCreateClientId();
      cachedSessionId = await getOrRefreshSessionId();

      isInitialized.value = true;
      console.log('[Analytics] ✓ Measurement Protocol 初始化成功');

      // 修复 #3：动态获取版本号
      const appVersion = await getAppVersion();

      // 发送应用启动事件
      await trackEvent(GA_EVENTS.APP_LAUNCH, {
        app_version: appVersion,
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
  async function trackEvent(eventName: string, params?: Record<string, unknown>): Promise<void> {
    if (!isEnabled.value) {
      return;
    }

    try {
      // 确保有 Client ID（使用全局缓存）
      if (!cachedClientId) {
        cachedClientId = await getOrCreateClientId();
      }

      // 刷新 Session ID（已优化，大多数情况只更新内存）
      cachedSessionId = await getOrRefreshSessionId();

      await sendToGA4(cachedClientId, cachedSessionId, eventName, params || {});
    } catch (error) {
      console.error('[Analytics] 事件追踪失败:', error);
    }
  }

  /**
   * 启用 Analytics
   * 修复 #2：使用展开运算符保留其他字段
   */
  async function enable(): Promise<void> {
    isEnabled.value = true;

    try {
      const config = await configStore.get<UserConfig>('config');
      if (config) {
        // 保留 analytics 对象中的其他字段
        config.analytics = { ...config.analytics, enabled: true };
        await configStore.set('config', config);
        await configStore.save();
      }

      // 如果尚未初始化，尝试初始化
      if (!isInitialized.value) {
        await initialize();
      }

      console.log('[Analytics] 已启用');
    } catch (error) {
      console.error('[Analytics] 启用失败:', error);
    }
  }

  /**
   * 禁用 Analytics
   * 修复 #2：使用展开运算符保留其他字段
   */
  async function disable(): Promise<void> {
    isEnabled.value = false;

    try {
      const config = await configStore.get<UserConfig>('config');
      if (config) {
        // 保留 analytics 对象中的其他字段
        config.analytics = { ...config.analytics, enabled: false };
        await configStore.set('config', config);
        await configStore.save();
      }

      console.log('[Analytics] 已禁用');
    } catch (error) {
      console.error('[Analytics] 禁用失败:', error);
    }
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
    enable,
    disable,

    // 事件常量
    GA_EVENTS
  };
}
