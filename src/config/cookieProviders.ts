// 多网站 Cookie 自动获取配置系统

import type { ServiceType } from './types';

/**
 * Cookie 验证配置
 */
export interface CookieValidation {
  /** 必须包含的 Cookie 字段（全部需要） */
  requiredFields?: string[];
  /** 至少包含其中一个字段 */
  anyOfFields?: string[];
  /** 字段值检查：key 为字段名，value 为期望值（如微博 MLOGIN 必须为 '1'） */
  fieldValueChecks?: Record<string, string>;
  /** 事件驱动超时（毫秒），从登录页加载完成后开始计时，默认 60000 */
  timeoutMs?: number;
  /** 降级轮询配置（仅非 Windows 平台使用） */
  monitoringDelay?: {
    /** 初始延迟（毫秒），页面加载后等待多久开始第一次检查 */
    initialDelayMs?: number;
    /** 轮询间隔（毫秒），每次检查之间的等待时间 */
    pollingIntervalMs?: number;
  };
}

/**
 * 登录阶段窗口尺寸配置
 */
export interface LoginWindowSize {
  width: number;
  height: number;
}

/**
 * Cookie 提供者配置
 */
export interface CookieProvider {
  /** 服务标识 */
  serviceId: ServiceType;
  /** 显示名称 */
  name: string;
  /** 登录页面 URL */
  loginUrl: string;
  /** 需要获取 Cookie 的域名列表 */
  domains: string[];
  /** Cookie 验证规则 */
  cookieValidation?: CookieValidation;
  /** 描述文字 */
  description: string;
  /** 图标 */
  icon: string;
  /** 加载登录页时的窗口尺寸（不设置则使用默认值 1000x750） */
  loginWindowSize?: LoginWindowSize;
}

/** 登录页默认窗口尺寸（桌面版网站） */
export const DEFAULT_LOGIN_WINDOW_SIZE: LoginWindowSize = { width: 1000, height: 750 };

/**
 * 所有支持自动获取 Cookie 的服务配置
 *
 * 添加新服务只需：
 * 1. 在此处添加配置
 * 2. 在 tauri.conf.json 添加域名白名单
 * 3. 在设置页面添加"自动获取"按钮
 */
export const COOKIE_PROVIDERS: Record<string, CookieProvider> = {
  weibo: {
    serviceId: 'weibo',
    name: '微博',
    loginUrl: 'https://m.weibo.cn/',
    domains: ['weibo.com', 'm.weibo.cn'],
    cookieValidation: {
      requiredFields: ['SUB', 'SUBP'],
      fieldValueChecks: { 'MLOGIN': '1' },
      monitoringDelay: {
        initialDelayMs: 2000,
        pollingIntervalMs: 500
      }
    },
    description: '登录微博账号获取 Cookie',
    icon: '📝',
    loginWindowSize: { width: 420, height: 750 }
  },
  nowcoder: {
    serviceId: 'nowcoder',
    name: '牛客',
    loginUrl: 'https://www.nowcoder.com/login',
    domains: ['www.nowcoder.com', 'nowcoder.com'],  // www 在前，因为登录页面在 www 子域
    cookieValidation: {
      requiredFields: ['t', 'csrfToken'],  // 必须有登录Token和CSRF令牌
      anyOfFields: ['acw_tc', 'SERVERID', '__snaker__id', 'gdxidpyhxdE'],  // 至少包含一个安全验证字段
      monitoringDelay: {
        initialDelayMs: 3000,      // 3秒初始延迟（等待安全令牌）
        pollingIntervalMs: 1000    // 1秒轮询（平衡性能）
      }
    },
    description: '登录牛客账号获取 Cookie',
    icon: '📚'
  },
  zhihu: {
    serviceId: 'zhihu',
    name: '知乎',
    loginUrl: 'https://www.zhihu.com/signin',
    domains: ['www.zhihu.com', 'zhihu.com'],  // www 在前，因为登录页面在 www 子域
    cookieValidation: {
      requiredFields: ['z_c0'],  // 知乎登录凭证（必须）
      anyOfFields: [],
      monitoringDelay: {
        initialDelayMs: 3000,      // 3秒初始延迟（等待登录完成）
        pollingIntervalMs: 1000    // 1秒轮询
      }
    },
    description: '登录知乎账号获取 Cookie',
    icon: '📖'
  },
  nami: {
    serviceId: 'nami',
    name: '纳米',
    loginUrl: 'https://www.n.cn',
    domains: ['www.n.cn', 'n.cn'],  // www 在前，因为主站在 www 子域
    cookieValidation: {
      requiredFields: ['Auth-Token'],  // 纳米登录成功必须有 Auth-Token（JWT）
      anyOfFields: ['Q', 'T'],  // 登录后才会有 Q 或 T 字段，用于验证登录状态
      monitoringDelay: {
        initialDelayMs: 3000,      // 3秒初始延迟（等待登录完成）
        pollingIntervalMs: 1000    // 1秒轮询
      }
    },
    description: '登录纳米账号获取 Cookie',
    icon: '☁️'
  },
  bilibili: {
    serviceId: 'bilibili',
    name: '哔哩哔哩',
    loginUrl: 'https://www.bilibili.com/',
    domains: ['www.bilibili.com', 'bilibili.com', '.bilibili.com'],
    cookieValidation: {
      requiredFields: ['SESSDATA', 'bili_jct'],  // 哔哩哔哩登录成功必须有 SESSDATA 和 bili_jct
      anyOfFields: [],
      monitoringDelay: {
        initialDelayMs: 3000,      // 3秒初始延迟（等待登录完成）
        pollingIntervalMs: 1000    // 1秒轮询
      }
    },
    description: '登录哔哩哔哩账号获取 Cookie',
    icon: '📺'
  },
  chaoxing: {
    serviceId: 'chaoxing',
    name: '超星/学习通',
    loginUrl: 'https://passport2.chaoxing.com/',
    domains: ['chaoxing.com', '.chaoxing.com', 'passport2.chaoxing.com'],
    cookieValidation: {
      requiredFields: ['_uid'],  // 超星登录成功必须有 _uid 字段
      anyOfFields: [],
      monitoringDelay: {
        initialDelayMs: 3000,      // 3秒初始延迟（等待登录完成）
        pollingIntervalMs: 1000    // 1秒轮询
      }
    },
    description: '登录超星/学习通账号获取 Cookie',
    icon: '📚'
  }
};

/**
 * 获取 Cookie 提供者配置
 * @param serviceId 服务标识
 * @returns Cookie 提供者配置，如果不存在返回 undefined
 */
export function getCookieProvider(serviceId: string): CookieProvider | undefined {
  return COOKIE_PROVIDERS[serviceId];
}

/**
 * 检查服务是否支持自动获取 Cookie
 * @param serviceId 服务标识
 * @returns 是否支持
 */
export function supportsCookieAutoFetch(serviceId: string): boolean {
  return serviceId in COOKIE_PROVIDERS;
}

/**
 * 验证 Cookie 是否满足要求
 * @param cookie Cookie 字符串
 * @param validation 验证规则
 * @returns 是否验证通过
 */
export function validateCookie(cookie: string, validation?: CookieValidation): boolean {
  if (!validation) {
    // 没有验证规则，只要非空就通过
    return cookie.trim().length > 0;
  }

  // 检查必须字段
  if (validation.requiredFields && validation.requiredFields.length > 0) {
    for (const field of validation.requiredFields) {
      if (!cookie.includes(`${field}=`)) {
        return false;
      }
    }
  }

  // 检查任意字段（如果有）
  if (validation.anyOfFields && validation.anyOfFields.length > 0) {
    const hasAnyField = validation.anyOfFields.some(field => cookie.includes(`${field}=`));
    if (!hasAnyField) {
      return false;
    }
  }

  // 检查字段值（如微博 MLOGIN=1）
  if (validation.fieldValueChecks) {
    for (const [field, expectedValue] of Object.entries(validation.fieldValueChecks)) {
      const pattern = `${field}=${expectedValue}`;
      if (!cookie.includes(pattern)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * 获取所有支持自动获取 Cookie 的服务列表
 * @returns 服务配置数组
 */
export function getAllCookieProviders(): CookieProvider[] {
  return Object.values(COOKIE_PROVIDERS);
}
