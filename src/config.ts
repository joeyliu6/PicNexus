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
  timestamp: number;
  fileName: string; // 本地文件名
  link: string;     // 生成的链接
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

