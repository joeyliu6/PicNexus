import type {
  CustomS3Profile,
  HttpDomainConfirmable,
  EditorServerConfig,
  ImageCompressionConfig,
  LinkPrefixItem,
  UserConfig,
  WebDAVProfile,
  WebDAVStorageProfile,
} from '../../config/types';

/**
 * 设置页 formData 中会被子 composable 读取的最小字段集。
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
  github: import('../../config/types').GithubServiceConfig;
  imgur: { clientId: string; clientSecret?: string };
  editorServer: EditorServerConfig;
}

export interface SettingsFormData extends SettingsFormShape {
  webdav: { profiles: WebDAVProfile[]; activeId: string | null };
  linkPrefixEnabled: boolean;
  selectedPrefixIndex: number;
  linkPrefixList: LinkPrefixItem[];
  analyticsEnabled: boolean;
  appBehavior: NonNullable<UserConfig['appBehavior']>;
  linkOutput: NonNullable<UserConfig['linkOutput']>;
  globalShortcut: NonNullable<UserConfig['globalShortcut']>;
  autoUpdateEnabled: boolean;
  publicServiceRiskAccepted: boolean;
  imageCompression: ImageCompressionConfig;
}
