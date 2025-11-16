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

export interface UserConfig {
  weiboCookie: string;
  r2: R2Config;
  baiduPrefix: string;
  outputFormat: 'baidu' | 'weibo' | 'r2';
}

export interface HistoryItem {
  id: string;                    // 唯一标识符
  timestamp: number;             // 上传时间
  localFileName: string;         // 原始本地文件名
  weiboPid: string;              // 微博返回的 PID (例如 006G4xsfgy1h8pbgtnqirj)
  generatedLink: string;         // 最终复制到剪贴板的链接
  r2Key: string | null;          // 如果 R2 备份成功，存储 R2 上的 Key；否则为 null
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
};

