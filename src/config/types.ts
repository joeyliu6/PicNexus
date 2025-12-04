// src/config/types.ts
// 新的配置类型定义，支持多图床架构

import { UploadResult } from '../uploaders/base/types';

/**
 * 支持的图床服务类型
 */
export type ServiceType = 'weibo' | 'r2' | 'jd' | 'tcl' | 'nowcoder' | 'qiyu' | 'zhihu';

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
 * 京东图床服务配置
 * 京东图床无需认证，和 TCL 一样开箱即用
 */
export interface JDServiceConfig extends BaseServiceConfig {
  // 京东图床不需要额外配置
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
 * 七鱼图床服务配置
 * 基于网易七鱼客服系统的 NOS 对象存储
 * Token 由后端自动获取（通过 Chrome/Edge 浏览器），无需手动配置
 */
export interface QiyuServiceConfig extends BaseServiceConfig {
  // Token 已改为后端自动获取，此接口保留用于未来扩展
}

/**
 * 知乎图床服务配置
 * 需要 Cookie 认证
 */
export interface ZhihuServiceConfig extends BaseServiceConfig {
  /** 知乎 Cookie */
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
 * 链接前缀配置
 * 用于微博图床的代理前缀管理
 */
export interface LinkPrefixConfig {
  /** 是否启用代理前缀 */
  enabled: boolean;
  /** 当前选中的前缀索引 */
  selectedIndex: number;
  /** 前缀列表 */
  prefixList: string[];
}

/**
 * 默认前缀列表
 */
export const DEFAULT_PREFIXES: string[] = [
  'https://image.baidu.com/search/down?thumburl=',
  'https://cdn.cdnjson.com/pic.html?url='
];

/**
 * 用户配置（新架构）
 * 支持多图床并行上传
 */
export interface UserConfig {
  /** 用户启用的图床服务列表（上传窗口勾选的图床） */
  enabledServices: ServiceType[];

  /** 全局可用的图床列表（设置中配置，控制上传界面显示哪些图床） */
  availableServices?: ServiceType[];

  /** 各图床服务的配置 */
  services: {
    weibo?: WeiboServiceConfig;
    r2?: R2ServiceConfig;
    jd?: JDServiceConfig;
    tcl?: TCLServiceConfig;
    nowcoder?: NowcoderServiceConfig;
    qiyu?: QiyuServiceConfig;
    zhihu?: ZhihuServiceConfig;
  };

  /** 输出格式 */
  outputFormat: OutputFormat;

  /** @deprecated 使用 linkPrefixConfig 代替，保留用于向后兼容 */
  baiduPrefix?: string;

  /** 链接前缀配置（用于微博图床代理） */
  linkPrefixConfig?: LinkPrefixConfig;

  /** WebDAV 配置（用于历史记录同步） */
  webdav?: WebDAVConfig;

  /** 浏览视图偏好设置 */
  galleryViewPreferences?: {
    viewMode: 'table' | 'grid';
    selectedImageBed?: ServiceType | 'all';
    gridColumnWidth: number;
  };
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
  availableServices: ['weibo', 'r2', 'tcl', 'jd', 'nowcoder', 'qiyu', 'zhihu'],  // 默认所有图床都可用
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
    },
    jd: {
      enabled: true  // 京东图床默认启用，无需额外配置
    },
    nowcoder: {
      enabled: false,  // 牛客图床需要 Cookie，默认不启用
      cookie: ''
    },
    qiyu: {
      enabled: false  // 七鱼图床需要 Chrome/Edge 浏览器，默认不启用
    },
    zhihu: {
      enabled: false,  // 知乎图床需要 Cookie，默认不启用
      cookie: ''
    }
  },
  outputFormat: 'baidu-proxy',
  baiduPrefix: 'https://image.baidu.com/search/down?thumburl=',
  linkPrefixConfig: {
    enabled: true,
    selectedIndex: 0,
    prefixList: [...DEFAULT_PREFIXES]
  },
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
      jd: config.services.jd,  // JD 无需清洗，没有敏感信息
      tcl: config.services.tcl,
      nowcoder: config.services.nowcoder ? {
        ...config.services.nowcoder,
        cookie: sanitizeString(config.services.nowcoder.cookie, 8, 4)
      } : undefined,
      // 七鱼图床 Token 由后端自动获取，无需脱敏处理
      qiyu: config.services.qiyu,
      zhihu: config.services.zhihu ? {
        ...config.services.zhihu,
        cookie: sanitizeString(config.services.zhihu.cookie, 8, 4)
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

/**
 * 获取当前激活的前缀
 * 如果前缀功能禁用，返回 null
 *
 * @param config 用户配置
 * @returns 当前激活的前缀，或 null（如果禁用）
 */
export function getActivePrefix(config: UserConfig): string | null {
  // 如果没有 linkPrefixConfig，尝试使用旧的 baiduPrefix
  if (!config.linkPrefixConfig) {
    return config.baiduPrefix || DEFAULT_PREFIXES[0];
  }

  // 如果功能禁用，返回 null
  if (!config.linkPrefixConfig.enabled) {
    return null;
  }

  const { selectedIndex, prefixList } = config.linkPrefixConfig;

  // 如果列表为空，返回默认前缀
  if (!prefixList || prefixList.length === 0) {
    return DEFAULT_PREFIXES[0];
  }

  // 确保索引有效
  if (selectedIndex >= 0 && selectedIndex < prefixList.length) {
    return prefixList[selectedIndex];
  }

  // 索引无效，返回第一个
  return prefixList[0];
}

/**
 * 迁移旧配置到新格式
 * 将单个 baiduPrefix 迁移为 linkPrefixConfig
 *
 * @param config 用户配置（可能是旧格式）
 * @returns 迁移后的配置
 */
export function migrateConfig(config: UserConfig): UserConfig {
  // 如果已经有 linkPrefixConfig，无需迁移
  if (config.linkPrefixConfig) {
    return config;
  }

  // 创建前缀列表，以默认前缀开始
  const prefixList = [...DEFAULT_PREFIXES];
  let selectedIndex = 0;

  // 如果有旧的 baiduPrefix
  if (config.baiduPrefix) {
    const existingIndex = prefixList.indexOf(config.baiduPrefix);
    if (existingIndex >= 0) {
      // 旧前缀在默认列表中，选中它
      selectedIndex = existingIndex;
    } else {
      // 旧前缀不在默认列表中，添加进去
      prefixList.push(config.baiduPrefix);
      selectedIndex = prefixList.length - 1;
    }
  }

  return {
    ...config,
    linkPrefixConfig: {
      enabled: true,
      selectedIndex,
      prefixList
    }
  };
}
