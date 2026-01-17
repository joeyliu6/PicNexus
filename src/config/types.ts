// src/config/types.ts
// 新的配置类型定义，支持多图床架构

import { UploadResult } from '../uploaders/base/types';

/**
 * 主题模式类型
 */
export type ThemeMode = 'light' | 'dark';

/**
 * 主题配置接口
 */
export interface ThemeConfig {
  /** 当前主题模式 */
  mode: ThemeMode;

  /** 是否启用主题过渡动画 */
  enableTransitions: boolean;

  /** 过渡动画持续时间（毫秒） */
  transitionDuration: number;
}

/**
 * 图片元数据接口（简化版）
 * 由 Rust 后端 get_image_metadata 命令返回
 * 性能优化：移除了 color_type 和 has_alpha 字段，这些字段实际使用中不需要
 */
export interface ImageMetadata {
  /** 图片宽度（像素） */
  width: number;
  /** 图片高度（像素） */
  height: number;
  /** 宽高比（width / height） */
  aspect_ratio: number;
  /** 文件大小（字节） */
  file_size: number;
  /** 图片格式（jpg, png, webp, gif, bmp 等） */
  format: string;
}

/**
 * Google Analytics 配置接口
 */
export interface AnalyticsConfig {
  /** 是否启用 Analytics 追踪 */
  enabled: boolean;
}

/**
 * 支持的图床服务类型
 */
export type ServiceType = 'weibo' | 'r2' | 'jd' | 'nowcoder' | 'qiyu' | 'zhihu' | 'nami' | 'bilibili' | 'chaoxing' | 'smms' | 'github' | 'imgur' | 'tencent' | 'aliyun' | 'qiniu' | 'upyun';

/**
 * 私有图床服务列表
 * 用户需要提供自己的存储凭证，数据存储在用户自己的账户中
 */
export const PRIVATE_SERVICES: ServiceType[] = ['r2', 'tencent', 'aliyun', 'qiniu', 'upyun'];

/**
 * 公共图床服务列表
 * 使用公共平台的存储服务
 */
export const PUBLIC_SERVICES: ServiceType[] = ['weibo', 'zhihu', 'nami', 'qiyu', 'jd', 'nowcoder', 'bilibili', 'chaoxing', 'smms', 'github', 'imgur'];

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
 * 纳米图床服务配置
 * 需要 Cookie 和 Auth-Token 认证
 * 通过登录窗口自动获取 Cookie，Auth-Token 从 Cookie 中提取
 */
export interface NamiServiceConfig extends BaseServiceConfig {
  /** 纳米 Cookie（完整的 Cookie 字符串） */
  cookie: string;
  /** Auth-Token（从 Cookie 中提取的 JWT Token） */
  authToken: string;
}

/**
 * 哔哩哔哩图床服务配置
 * 需要 Cookie 认证（包含 SESSDATA 和 bili_jct）
 * 通过登录窗口自动获取 Cookie
 */
export interface BilibiliServiceConfig extends BaseServiceConfig {
  /** 哔哩哔哩 Cookie（完整的 Cookie 字符串，包含 SESSDATA 和 bili_jct） */
  cookie: string;
}

/**
 * 超星图床服务配置
 * 需要 Cookie 认证
 * 通过登录窗口自动获取 Cookie
 */
export interface ChaoxingServiceConfig extends BaseServiceConfig {
  /** 超星 Cookie（完整的 Cookie 字符串） */
  cookie: string;
}

/**
 * SM.MS 图床服务配置
 * 公共图床，需要 API Token
 */
export interface SmmsServiceConfig extends BaseServiceConfig {
  /** SM.MS API Token */
  token: string;
}

/**
 * GitHub 图床服务配置
 * 使用 GitHub 仓库作为图床，需要 Personal Access Token
 */
export interface GithubServiceConfig extends BaseServiceConfig {
  /** GitHub Personal Access Token */
  token: string;
  /** 仓库所有者用户名 */
  owner: string;
  /** 仓库名称 */
  repo: string;
  /** 分支名称（默认 main） */
  branch: string;
  /** 存储路径（默认 images/） */
  path: string;
  /** 自定义域名（可选） */
  customDomain?: string;
}

/**
 * Imgur 图床服务配置
 * 公共图床，需要 Client ID
 */
export interface ImgurServiceConfig extends BaseServiceConfig {
  /** Imgur Client ID */
  clientId: string;
  /** Imgur Client Secret（可选，用于匿名上传） */
  clientSecret?: string;
}

/**
 * 腾讯云图床服务配置
 * 私有图床，需要 SecretId 和 SecretKey
 */
export interface TencentServiceConfig extends BaseServiceConfig {
  /** 腾讯云 SecretId */
  secretId: string;
  /** 腾讯云 SecretKey */
  secretKey: string;
  /** 地域（如 ap-guangzhou） */
  region: string;
  /** 存储桶名称 */
  bucket: string;
  /** 存储路径前缀（默认 images/） */
  path: string;
  /** 公开访问域名 */
  publicDomain: string;
}

/**
 * 阿里云图床服务配置
 * 私有图床，需要 AccessKey ID 和 Secret
 */
export interface AliyunServiceConfig extends BaseServiceConfig {
  /** 阿里云 AccessKey ID */
  accessKeyId: string;
  /** 阿里云 AccessKey Secret */
  accessKeySecret: string;
  /** 地域（如 oss-cn-hangzhou） */
  region: string;
  /** 存储桶名称 */
  bucket: string;
  /** 存储路径前缀（默认 images/） */
  path: string;
  /** 公开访问域名 */
  publicDomain: string;
}

/**
 * 七牛云图床服务配置
 * 私有图床，需要 AK 和 SK
 */
export interface QiniuServiceConfig extends BaseServiceConfig {
  /** 七牛云 AccessKey */
  accessKey: string;
  /** 七牛云 SecretKey */
  secretKey: string;
  /** 存储区域（如 cn-east-1, cn-south-1） */
  region: string;
  /** 存储桶名称 */
  bucket: string;
  /** 域名（如 https://cdn.example.com） */
  domain: string;
  /** 存储路径前缀（默认 images/） */
  path: string;
}

/**
 * 又拍云图床服务配置
 * 私有图床，需要 Operator 和 Password
 */
export interface UpyunServiceConfig extends BaseServiceConfig {
  /** 又拍云 Operator */
  operator: string;
  /** 又提云 Password */
  password: string;
  /** 存储桶名称 */
  bucket: string;
  /** 域名（如 https://cdn.example.com） */
  domain: string;
  /** 存储路径前缀（默认 images/） */
  path: string;
}

/**
 * WebDAV 配置项（单个配置）
 */
export interface WebDAVProfile {
  /** 唯一标识符 */
  id: string;

  /** 显示名称，如"坚果云"、"群晖 NAS" */
  name: string;

  /** WebDAV 服务器 URL */
  url: string;

  /** WebDAV 用户名 */
  username: string;

  /** WebDAV 密码（已废弃，仅用于向后兼容迁移） */
  password?: string;

  /** WebDAV 密码（加密存储） */
  passwordEncrypted?: string;

  /** 远程路径 */
  remotePath: string;
}

/**
 * WebDAV 配置
 * 支持多个配置切换
 */
export interface WebDAVConfig {
  /** WebDAV 配置列表 */
  profiles: WebDAVProfile[];

  /** 当前选中的配置 ID，null 表示未选中 */
  activeId: string | null;
}

/**
 * 服务可用性检测状态
 * 用于持久化保存服务检测结果，实现智能检测策略
 */
export interface ServiceCheckStatus {
  /** 上次检测时间戳 */
  lastCheckTime: number | null;
  /** 上次检测结果 */
  lastCheckResult: boolean;
  /** 下次检测时间戳（仅可用时有效） */
  nextCheckTime: number | null;
}

/**
 * 同步状态
 * 用于持久化保存同步结果
 */
export interface SyncStatus {
  /** 配置上次同步时间 (YYYY-MM-DD HH:mm:ss) */
  configLastSync: string | null;

  /** 配置同步结果 */
  configSyncResult: 'success' | 'failed' | null;

  /** 配置同步错误信息 */
  configSyncError?: string;

  /** 上传记录上次同步时间 */
  historyLastSync: string | null;

  /** 上传记录同步结果 */
  historySyncResult: 'success' | 'failed' | null;

  /** 上传记录同步错误信息 */
  historySyncError?: string;

  /** 京东图床上次检测时间戳 */
  lastJdCheck?: number;

  /** 七鱼图床检测状态 */
  qiyuCheckStatus?: ServiceCheckStatus;
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
/**
 * 当前配置版本号
 * 每次配置格式变更时递增此版本号
 * 迁移函数将根据此版本号决定是否需要执行迁移
 */
export const CONFIG_VERSION = 2;

export interface UserConfig {
  /**
   * 配置版本号
   * 用于追踪配置格式变化，支持增量迁移
   */
  configVersion?: number;

  /** 用户启用的图床服务列表（上传窗口勾选的图床） */
  enabledServices: ServiceType[];

  /** 全局可用的图床列表（设置中配置，控制上传界面显示哪些图床） */
  availableServices?: ServiceType[];

  /** 各图床服务的配置 */
  services: {
    weibo?: WeiboServiceConfig;
    r2?: R2ServiceConfig;
    jd?: JDServiceConfig;

    nowcoder?: NowcoderServiceConfig;
    qiyu?: QiyuServiceConfig;
    zhihu?: ZhihuServiceConfig;
    nami?: NamiServiceConfig;
    bilibili?: BilibiliServiceConfig;
    chaoxing?: ChaoxingServiceConfig;
    smms?: SmmsServiceConfig;
    github?: GithubServiceConfig;
    imgur?: ImgurServiceConfig;
    tencent?: TencentServiceConfig;
    aliyun?: AliyunServiceConfig;
    qiniu?: QiniuServiceConfig;
    upyun?: UpyunServiceConfig;
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

  /** 主题配置 */
  theme?: ThemeConfig;

  /** Google Analytics 配置 */
  analytics?: AnalyticsConfig;

  /** 自动同步配置 */
  autoSync?: AutoSyncConfig;

  /** 默认历史记录视图模式 */
  defaultHistoryViewMode?: 'table' | 'grid';
}

/**
 * 自动同步配置
 */
export interface AutoSyncConfig {
  /** 是否启用自动同步 */
  enabled: boolean;
  /** 同步间隔（小时），默认 24 */
  intervalHours: number;
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

  /** 链接检测状态（每个图床的检测结果） */
  linkCheckStatus?: {
    [serviceId: string]: {
      isValid: boolean;
      lastCheckTime: number;
      statusCode?: number;
      errorType: 'success' | 'http_4xx' | 'http_5xx' | 'timeout' | 'network' | 'pending';
      responseTime?: number;
      error?: string;
    };
  };

  /** 汇总状态（用于快速筛选） */
  linkCheckSummary?: {
    totalLinks: number;
    validLinks: number;
    invalidLinks: number;
    uncheckedLinks: number;
    lastCheckTime?: number;
  };

  // ========== 图片元信息字段（用于 Justified Layout 布局） ==========

  /** 图片宽度（像素） */
  width?: number;

  /** 图片高度（像素） */
  height?: number;

  /** 宽高比（width / height） */
  aspectRatio?: number;

  /** 文件大小（字节） */
  fileSize?: number;

  /** 图片格式（jpg, png, webp, gif, bmp 等） */
  format?: string;
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: UserConfig = {
  enabledServices: ['jd'],  // 默认启用 JD 图床（开箱即用）
  availableServices: ['weibo', 'r2', 'jd', 'nowcoder', 'qiyu', 'zhihu', 'nami', 'bilibili', 'chaoxing', 'smms', 'github', 'imgur', 'tencent', 'aliyun', 'qiniu', 'upyun'],  // 默认所有图床都可用
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
    },
    nami: {
      enabled: false,  // 纳米图床需要 Cookie，默认不启用
      cookie: '',
      authToken: ''
    },
    bilibili: {
      enabled: false,  // 哔哩哔哩图床需要 Cookie，默认不启用
      cookie: ''
    },
    chaoxing: {
      enabled: false,  // 超星图床需要 Cookie，默认不启用
      cookie: ''
    },
    smms: {
      enabled: false,  // SM.MS 需要 Token，默认不启用
      token: ''
    },
    github: {
      enabled: false,  // GitHub 需要配置，默认不启用
      token: '',
      owner: '',
      repo: '',
      branch: 'main',
      path: 'images/'
    },
    imgur: {
      enabled: false,  // Imgur 需要配置，默认不启用
      clientId: '',
      clientSecret: ''
    },
    tencent: {
      enabled: false,  // 腾讯云需要配置，默认不启用
      secretId: '',
      secretKey: '',
      region: '',
      bucket: '',
      path: 'images/',
      publicDomain: ''
    },
    aliyun: {
      enabled: false,  // 阿里云需要配置，默认不启用
      accessKeyId: '',
      accessKeySecret: '',
      region: '',
      bucket: '',
      path: 'images/',
      publicDomain: ''
    },
    qiniu: {
      enabled: false,  // 七牛云需要配置，默认不启用
      accessKey: '',
      secretKey: '',
      region: '',
      bucket: '',
      domain: '',
      path: 'images/'
    },
    upyun: {
      enabled: false,  // 又拍云需要配置，默认不启用
      operator: '',
      password: '',
      bucket: '',
      domain: '',
      path: 'images/'
    }
  },
  outputFormat: 'baidu-proxy',
  linkPrefixConfig: {
    enabled: true,
    selectedIndex: 0,
    prefixList: [...DEFAULT_PREFIXES]
  },
  webdav: {
    profiles: [],
    activeId: null
  },
  theme: {
    mode: 'dark',
    enableTransitions: true,
    transitionDuration: 300
  },
  analytics: {
    enabled: true
  },
  autoSync: {
    enabled: false,
    intervalHours: 48
  },
  defaultHistoryViewMode: 'table'
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
/**
 * 配置迁移函数
 *
 * 根据配置版本号执行增量迁移，确保旧版本配置能正确升级到新版本。
 * 每次配置格式变更时：
 * 1. 递增 CONFIG_VERSION
 * 2. 在此函数中添加对应版本的迁移逻辑
 *
 * @param config 可能来自旧版本的用户配置
 * @returns 迁移后的配置（版本号为最新）
 */
export function migrateConfig(config: UserConfig): UserConfig {
  let migratedConfig = { ...config };
  const currentVersion = config.configVersion || 0;

  // 版本 0 -> 1：将 baiduPrefix 迁移为 linkPrefixConfig
  if (currentVersion < 1) {
    if (!migratedConfig.linkPrefixConfig) {
      const prefixList = [...DEFAULT_PREFIXES];
      let selectedIndex = 0;

      if (migratedConfig.baiduPrefix) {
        const existingIndex = prefixList.indexOf(migratedConfig.baiduPrefix);
        if (existingIndex >= 0) {
          selectedIndex = existingIndex;
        } else {
          prefixList.push(migratedConfig.baiduPrefix);
          selectedIndex = prefixList.length - 1;
        }
      }

      migratedConfig = {
        ...migratedConfig,
        linkPrefixConfig: {
          enabled: true,
          selectedIndex,
          prefixList
        }
      };
    }
    console.log('[配置迁移] 从版本 0 迁移到版本 1：linkPrefixConfig');
  }

  // 版本 1 -> 2：新增 7 个图床的默认配置
  if (currentVersion < 2) {
    const newServices = {
      smms: migratedConfig.services?.smms || { enabled: false, token: '' },
      github: migratedConfig.services?.github || {
        enabled: false,
        token: '',
        owner: '',
        repo: '',
        branch: 'main',
        path: 'images/'
      },
      imgur: migratedConfig.services?.imgur || {
        enabled: false,
        clientId: '',
        clientSecret: ''
      },
      tencent: migratedConfig.services?.tencent || {
        enabled: false,
        secretId: '',
        secretKey: '',
        region: '',
        bucket: '',
        path: 'images/',
        publicDomain: ''
      },
      aliyun: migratedConfig.services?.aliyun || {
        enabled: false,
        accessKeyId: '',
        accessKeySecret: '',
        region: '',
        bucket: '',
        path: 'images/',
        publicDomain: ''
      },
      qiniu: migratedConfig.services?.qiniu || {
        enabled: false,
        accessKey: '',
        secretKey: '',
        region: '',
        bucket: '',
        domain: '',
        path: 'images/'
      },
      upyun: migratedConfig.services?.upyun || {
        enabled: false,
        operator: '',
        password: '',
        bucket: '',
        domain: '',
        path: 'images/'
      }
    };

    migratedConfig = {
      ...migratedConfig,
      services: {
        ...migratedConfig.services,
        ...newServices
      },
      availableServices: [
        ...(migratedConfig.availableServices || ['weibo', 'r2', 'jd', 'nowcoder', 'qiyu', 'zhihu', 'nami', 'bilibili', 'chaoxing']),
        'smms', 'github', 'imgur', 'tencent', 'aliyun', 'qiniu', 'upyun'
      ]
    };

    console.log('[配置迁移] 从版本 1 迁移到版本 2：新增 7 个图床');
  }

  // 未来版本迁移示例：
  // if (currentVersion < 2) {
  //   // 版本 1 -> 2 的迁移逻辑
  //   console.log('[配置迁移] 从版本 1 迁移到版本 2：xxx');
  // }

  // 更新版本号到最新
  migratedConfig.configVersion = CONFIG_VERSION;

  return migratedConfig;
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
