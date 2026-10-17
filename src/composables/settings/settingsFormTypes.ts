import type {
  CustomS3Profile,
  HttpDomainConfirmable,
  EditorServerConfig,
  WebDAVStorageProfile,
} from '@/config/types';

/**
 * 编辑器服务（Typora / Obsidian / CLI）下发凭证时读的那份数据：各图床凭证 + 编辑器选项。
 * 由 editorSync 从磁盘配置拼出来（图床凭证归图床页管，设置页的表单里没有）。
 */
export interface SettingsFormShape {
  weiboCookie: string;
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string; path: string; publicDomain: string; thumbnailProxyEnabled?: boolean } & HttpDomainConfirmable;
  tencent: { secretId: string; secretKey: string; region: string; bucket: string; path: string; publicDomain: string } & HttpDomainConfirmable;
  aliyun: { accessKeyId: string; accessKeySecret: string; region: string; bucket: string; path: string; publicDomain: string } & HttpDomainConfirmable;
  qiniu: { accessKey: string; secretKey: string; region: string; bucket: string; publicDomain: string; path: string } & HttpDomainConfirmable;
  upyun: { operator: string; password: string; bucket: string; publicDomain: string; path: string; s3AccessKey: string; s3SecretKey: string } & HttpDomainConfirmable;
  custom_s3_profiles: CustomS3Profile[];
  webdav_profiles: WebDAVStorageProfile[];
  nowcoder: { cookie: string };
  zhihu: { cookie: string; sourceParamEnabled?: boolean; sourceParamValue?: string };
  nami: { cookie: string; authToken: string };
  bilibili: { cookie: string };
  chaoxing: { cookie: string };
  smms: { token: string };
  github: import('@/config/types').GithubServiceConfig;
  imgur: { clientId: string; clientSecret?: string };
  editorServer: EditorServerConfig;
}
