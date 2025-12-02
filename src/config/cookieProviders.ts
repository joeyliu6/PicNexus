// src/config/cookieProviders.ts
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
}

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
      requiredFields: ['SUB', 'SUBP']  // 微博登录成功必须有这两个字段
    },
    description: '登录微博账号获取 Cookie',
    icon: '📝'
  },
  nowcoder: {
    serviceId: 'nowcoder',
    name: '牛客',
    loginUrl: 'https://www.nowcoder.com/login',
    domains: ['www.nowcoder.com', 'nowcoder.com'],  // www 在前，因为登录页面在 www 子域
    cookieValidation: {
      requiredFields: ['t', 'csrfToken'],  // 必须有登录Token和CSRF令牌
      anyOfFields: ['acw_tc', 'SERVERID', '__snaker__id', 'gdxidpyhxdE']  // 至少包含一个安全验证字段
    },
    description: '登录牛客账号获取 Cookie',
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

  return true;
}

/**
 * 获取所有支持自动获取 Cookie 的服务列表
 * @returns 服务配置数组
 */
export function getAllCookieProviders(): CookieProvider[] {
  return Object.values(COOKIE_PROVIDERS);
}
