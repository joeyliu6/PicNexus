// 验证、清洗和迁移函数

import type { UserConfig } from './configInterface';
import type { HistoryItem } from './historyTypes';

/**
 * 清洗配置对象中的敏感信息（用于日志输出）
 * 将敏感字段替换为 ******，防止日志泄露
 *
 * @param config 用户配置对象
 * @returns 清洗后的配置对象（深拷贝）
 */
export function sanitizeConfig(config: UserConfig): UserConfig {
  const sanitized: UserConfig = {
    ...config,
    services: {
      weibo: config.services.weibo ? {
        ...config.services.weibo,
        cookie: sanitizeString(config.services.weibo.cookie, 8, 4)
      } : undefined,
      r2: config.services.r2 ? {
        ...config.services.r2,
        accessKeyId: sanitizeString(config.services.r2.accessKeyId, 4, 4),
        secretAccessKey: sanitizeString(config.services.r2.secretAccessKey, 0, 0)
      } : undefined,
      jd: config.services.jd,  // JD 无需清洗，没有敏感信息

      nowcoder: config.services.nowcoder ? {
        ...config.services.nowcoder,
        cookie: sanitizeString(config.services.nowcoder.cookie, 8, 4)
      } : undefined,
      // 七鱼图床 Token 由后端自动获取，无需脱敏处理
      qiyu: config.services.qiyu,
      zhihu: config.services.zhihu ? {
        ...config.services.zhihu,
        cookie: sanitizeString(config.services.zhihu.cookie, 8, 4)
      } : undefined,
      nami: config.services.nami ? {
        ...config.services.nami,
        cookie: sanitizeString(config.services.nami.cookie, 8, 4),
        authToken: sanitizeString(config.services.nami.authToken, 10, 4)
      } : undefined,
      bilibili: config.services.bilibili ? {
        ...config.services.bilibili,
        cookie: sanitizeString(config.services.bilibili.cookie, 8, 4)
      } : undefined,
      chaoxing: config.services.chaoxing ? {
        ...config.services.chaoxing,
        cookie: sanitizeString(config.services.chaoxing.cookie, 8, 4)
      } : undefined,
      smms: config.services.smms ? {
        ...config.services.smms,
        token: sanitizeString(config.services.smms.token, 4, 4)
      } : undefined,
      github: config.services.github ? {
        ...config.services.github,
        token: sanitizeString(config.services.github.token, 4, 4)
      } : undefined,
      imgur: config.services.imgur ? {
        ...config.services.imgur,
        clientId: sanitizeString(config.services.imgur.clientId, 4, 4),
        clientSecret: sanitizeString(config.services.imgur.clientSecret, 4, 4)
      } : undefined,
      tencent: config.services.tencent ? {
        ...config.services.tencent,
        secretId: sanitizeString(config.services.tencent.secretId, 4, 4),
        secretKey: sanitizeString(config.services.tencent.secretKey, 0, 0)
      } : undefined,
      aliyun: config.services.aliyun ? {
        ...config.services.aliyun,
        accessKeyId: sanitizeString(config.services.aliyun.accessKeyId, 4, 4),
        accessKeySecret: sanitizeString(config.services.aliyun.accessKeySecret, 0, 0)
      } : undefined,
      qiniu: config.services.qiniu ? {
        ...config.services.qiniu,
        accessKey: sanitizeString(config.services.qiniu.accessKey, 4, 4),
        secretKey: sanitizeString(config.services.qiniu.secretKey, 0, 0)
      } : undefined,
      upyun: config.services.upyun ? {
        ...config.services.upyun,
        password: sanitizeString(config.services.upyun.password, 0, 0)
      } : undefined
    },
    custom_s3_profiles: config.custom_s3_profiles?.map(profile => ({
      ...profile,
      accessKeyId: sanitizeString(profile.accessKeyId, 4, 4),
      secretAccessKey: sanitizeString(profile.secretAccessKey, 0, 0)
    })),
    webdav: config.webdav ? {
      profiles: config.webdav.profiles.map(profile => ({
        ...profile,
        password: sanitizeString(profile.password, 0, 0)
      })),
      activeId: config.webdav.activeId
    } : undefined
  };

  return sanitized;
}

/**
 * 清洗字符串，保留前后部分字符，中间用 ****** 替代
 *
 * @param str 要清洗的字符串
 * @param prefixLen 保留前缀长度
 * @param suffixLen 保留后缀长度
 * @returns 清洗后的字符串
 */
function sanitizeString(str: string | undefined, prefixLen: number = 0, suffixLen: number = 0): string {
  if (!str || str.trim().length === 0) {
    return '';
  }

  const trimmed = str.trim();

  // 如果字符串太短，直接返回 ******
  if (trimmed.length <= prefixLen + suffixLen) {
    return '******';
  }

  // 保留前后部分
  const prefix = prefixLen > 0 ? trimmed.substring(0, prefixLen) : '';
  const suffix = suffixLen > 0 ? trimmed.substring(trimmed.length - suffixLen) : '';

  return `${prefix}******${suffix}`;
}

/**
 * 验证对象是否为有效的 UserConfig 格式
 * 用于防止导入错误格式的数据（如历史记录数据）覆盖配置
 *
 * @param obj 要验证的对象
 * @returns 是否为有效的 UserConfig 格式
 */
export function isValidUserConfig(obj: unknown): obj is UserConfig {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }

  const config = obj as Record<string, unknown>;

  // 1. 不应该是数字索引对象（历史记录数据的特征：{"0": {...}, "1": {...}}）
  const keys = Object.keys(config);
  if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
    return false;
  }

  // 2. 不应该包含历史记录特有的字段
  if ('localFileName' in config || 'results' in config || 'generatedLink' in config) {
    return false;
  }

  // 3. 必须包含 UserConfig 的必要字段（enabledServices 必须是数组）
  if (!Array.isArray(config.enabledServices)) {
    return false;
  }

  // 4. services 如果存在必须是对象
  if (config.services !== undefined && (typeof config.services !== 'object' || config.services === null)) {
    return false;
  }

  return true;
}

/**
 * 验证单个上传结果对象的结构
 */
function isValidUploadResultEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return false;
  }

  const e = entry as Record<string, unknown>;

  // 必需字段
  if (typeof e.serviceId !== 'string') return false;
  if (e.status !== 'success' && e.status !== 'failed') return false;

  // 可选字段类型检查
  if (e.error !== undefined && typeof e.error !== 'string') return false;

  return true;
}

/**
 * 验证对象是否为有效的 HistoryItem
 * 用于导入历史记录时的数据验证
 */
export function isValidHistoryItem(obj: unknown): obj is HistoryItem {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }

  const item = obj as Record<string, unknown>;

  // 必需字段检查
  if (typeof item.id !== 'string' || item.id.trim().length === 0) return false;
  if (typeof item.timestamp !== 'number' || !Number.isFinite(item.timestamp)) return false;
  if (typeof item.localFileName !== 'string') return false;
  if (typeof item.primaryService !== 'string') return false;
  if (typeof item.generatedLink !== 'string') return false;

  // results 数组深度验证
  if (!Array.isArray(item.results)) return false;
  if (!item.results.every(isValidUploadResultEntry)) return false;

  // 可选字段类型检查
  if (item.filePath !== undefined && typeof item.filePath !== 'string') return false;

  return true;
}
