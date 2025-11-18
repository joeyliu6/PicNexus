// src/config.ts
// 共享配置定义

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  path: string;
  publicDomain: string;
}

export interface WebDAVConfig {
  url: string;           // WebDAV URL (例如: https://dav.jianguoyun.com/dav/)
  username: string;      // WebDAV 用户名 (通常是邮箱)
  password: string;     // WebDAV 密码 (通常是应用的授权码)
  remotePath: string;   // 远程路径 (例如: /WeiboDR/history.json)
}

export interface UserConfig {
  weiboCookie: string;
  r2: R2Config;
  baiduPrefix: string;
  outputFormat: 'baidu' | 'weibo' | 'r2';
  webdav: WebDAVConfig; // v1.2 新增
}

export interface HistoryItem {
  id: string;                    // 唯一标识符
  timestamp: number;             // 上传时间
  localFileName: string;         // 原始本地文件名
  weiboPid: string;              // 微博返回的 PID (例如 006G4xsfgy1h8pbgtnqirj)
  generatedLink: string;         // 最终复制到剪贴板的链接
  r2Key: string | null;          // 如果 R2 备份成功，存储 R2 上的 Key；否则为 null
}

export interface FailedItem {
  id: string;                   // 时间戳或UUID
  filePath: string;              // 文件的本地绝对路径
  configSnapshot: UserConfig;    // 失败当时的用户配置
  errorMessage: string;          // 失败原因
}

// 默认配置
export const DEFAULT_CONFIG: UserConfig = {
  weiboCookie: '',
  r2: {
    accountId: '',
    accessKeyId: '',
    secretAccessKey: '',
    bucketName: '',
    path: '',
    publicDomain: '',
  },
  baiduPrefix: 'https://image.baidu.com/search/down?thumburl=',
  outputFormat: 'baidu',
  webdav: {
    url: '',
    username: '',
    password: '',
    remotePath: '/WeiboDR/history.json',
  },
};

/**
 * 清洗配置对象中的敏感信息，用于日志输出
 * 将敏感字段替换为 ******，防止日志泄露
 * 
 * @param config 用户配置对象
 * @returns 清洗后的配置对象（深拷贝）
 */
export function sanitizeConfig(config: UserConfig): UserConfig {
  // 深拷贝配置对象，避免修改原对象
  const sanitized: UserConfig = {
    ...config,
    // 清洗 Cookie（只保留前8个和后4个字符）
    weiboCookie: sanitizeString(config.weiboCookie, 8, 4),
    // 清洗 R2 配置
    r2: {
      ...config.r2,
      // Access Key ID 和 Secret Access Key 是敏感信息
      accessKeyId: sanitizeString(config.r2.accessKeyId, 4, 4),
      secretAccessKey: sanitizeString(config.r2.secretAccessKey, 0, 0), // 完全隐藏
    },
    // 清洗 WebDAV 配置
    webdav: {
      ...config.webdav,
      // 密码是敏感信息
      password: sanitizeString(config.webdav.password, 0, 0), // 完全隐藏
    },
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

