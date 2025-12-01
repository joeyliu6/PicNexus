// src/config/types.ts
// 新的配置类型定义，支持多图床架构

import { UploadResult } from '../uploaders/base/types';

/**
 * 支持的图床服务类型
 */
export type ServiceType = 'weibo' | 'r2' | 'nami' | 'jd' | 'tcl' | 'nowcoder';

/**
 * 基础服务配置接口
 */
export interface BaseServiceConfig {
  /** 服务是否启用 */
  enabled: boolean;
}

/**
 * 微博服务配置
 */
export interface WeiboServiceConfig extends BaseServiceConfig {
  /** 微博 Cookie */
  cookie: string;
}

/**
 * Cloudflare R2 服务配置
 */
export interface R2ServiceConfig extends BaseServiceConfig {
  /** 账户 ID */
  accountId: string;

  /** 访问密钥 ID */
  accessKeyId: string;

  /** 访问密钥 */
  secretAccessKey: string;

  /** 存储桶名称 */
  bucketName: string;

  /** 存储路径前缀 (如 'images/') */
  path: string;

  /** 公开访问域名 (如 'https://cdn.example.com') */
  publicDomain: string;
}

/**
 * 纳米图床服务配置
 */
export interface NamiServiceConfig extends BaseServiceConfig {
  /** 纳米图床 Cookie */
  cookie: string;
}

/**
 * 京东图床服务配置
 */
export interface JDServiceConfig extends BaseServiceConfig {
  /** 京东 Cookie */
  cookie: string;
}

/**
 * TCL 图床服务配置
 * TCL 图床无需认证
 */
export interface TCLServiceConfig extends BaseServiceConfig {
  // TCL 图床不需要额外配置
}

/**
 * 牛客图床服务配置
 */
export interface NowcoderServiceConfig extends BaseServiceConfig {
  /** 牛客 Cookie */
  cookie: string;
}

/**
 * WebDAV 配置
 * 保持与原有结构一致
 */
export interface WebDAVConfig {
  /** WebDAV 服务器 URL */
  url: string;

  /** WebDAV 用户名 */
  username: string;

  /** WebDAV 密码 */
  password: string;

  /** 远程路径 */
  remotePath: string;
}

/**
 * 输出格式类型
 * - direct: 直接返回原始链接
 * - baidu-proxy: 使用百度代理（仅微博支持）
 */
export type OutputFormat = 'direct' | 'baidu-proxy';

/**
 * 用户配置（新架构）
 * 支持多图床并行上传
 */
export interface UserConfig {
  /** 用户启用的图床服务列表（上传窗口勾选的图床） */
  enabledServices: ServiceType[];

  /** 各图床服务的配置 */
  services: {
    weibo?: WeiboServiceConfig;
    r2?: R2ServiceConfig;
    nami?: NamiServiceConfig;
    jd?: JDServiceConfig;
    tcl?: TCLServiceConfig;
    nowcoder?: NowcoderServiceConfig;
  };

  /** 输出格式 */
  outputFormat: OutputFormat;

  /** 百度代理前缀（仅用于微博图床） */
  baiduPrefix?: string;

  /** WebDAV 配置（用于历史记录同步） */
  webdav?: WebDAVConfig;
}

/**
 * 历史记录项（新架构）
 * 支持多图床并行上传结果
 */
export interface HistoryItem {
  /** 唯一标识符 */
  id: string;

  /** 上传时间戳 */
  timestamp: number;

  /** 原始本地文件名 */
  localFileName: string;

  /** 原始文件路径（用于重试上传） */
  filePath?: string;

  /** 主力图床（第一个上传成功的图床） */
  primaryService: ServiceType;

  /** 所有图床的上传结果 */
  results: Array<{
    /** 图床服务 ID */
    serviceId: ServiceType;

    /** 上传结果 */
    result?: UploadResult;

    /** 上传状态 */
    status: 'success' | 'failed';

    /** 错误信息（如果失败） */
    error?: string;
  }>;

  /** 最终生成的链接（基于主力图床） */
  generatedLink: string;
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: UserConfig = {
  enabledServices: ['tcl'],  // 默认启用 TCL 图床（开箱即用）
  services: {
    weibo: {
      enabled: true,
      cookie: ''
    },
    r2: {
      enabled: false,
      accountId: '',
      accessKeyId: '',
      secretAccessKey: '',
      bucketName: '',
      path: '',
      publicDomain: ''
    },
    tcl: {
      enabled: true  // TCL 图床默认启用，无需额外配置
    }
  },
  outputFormat: 'baidu-proxy',
  baiduPrefix: 'https://image.baidu.com/search/down?thumburl=',
  webdav: {
    url: '',
    username: '',
    password: '',
    remotePath: '/WeiboDR/history.json'
  }
};

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
      nami: config.services.nami ? {
        ...config.services.nami,
        cookie: sanitizeString(config.services.nami.cookie, 8, 4)
      } : undefined,
      jd: config.services.jd ? {
        ...config.services.jd,
        cookie: sanitizeString(config.services.jd.cookie, 8, 4)
      } : undefined,
      tcl: config.services.tcl,
      nowcoder: config.services.nowcoder ? {
        ...config.services.nowcoder,
        cookie: sanitizeString(config.services.nowcoder.cookie, 8, 4)
      } : undefined
    },
    webdav: config.webdav ? {
      ...config.webdav,
      password: sanitizeString(config.webdav.password, 0, 0)
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
