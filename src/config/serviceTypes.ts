// 图床服务相关类型定义

/**
 * 支持的图床服务类型
 */
export type ServiceType = 'weibo' | 'r2' | 'jd' | 'nowcoder' | 'qiyu' | 'zhihu' | 'nami' | 'bilibili' | 'chaoxing' | 'smms' | 'github' | 'imgur' | 'tencent' | 'aliyun' | 'qiniu' | 'upyun';

/**
 * 私有存储服务列表（内置）
 * 用户需要提供自己的存储凭证，数据存储在用户自己的账户中
 */
export const PRIVATE_SERVICES: ServiceType[] = ['r2', 'tencent', 'aliyun', 'qiniu', 'upyun'];

// ==================== 自定义 S3 复合 ID 工具函数 ====================

export function isCustomS3Id(id: string): boolean {
  return id.startsWith('custom_s3:');
}

export function getCustomS3ProfileId(compositeId: string): string {
  return compositeId.slice('custom_s3:'.length);
}

export function makeCustomS3Id(profileId: string): string {
  return `custom_s3:${profileId}`;
}

// ==================== WebDAV 图床复合 ID 工具函数 ====================

export function isWebDAVId(id: string): boolean {
  return id.startsWith('webdav:');
}

export function getWebDAVProfileId(compositeId: string): string {
  return compositeId.slice('webdav:'.length);
}

export function makeWebDAVId(profileId: string): string {
  return `webdav:${profileId}`;
}

/**
 * 公共图床服务列表
 * 使用公共平台的存储服务
 */
export const PUBLIC_SERVICES: ServiceType[] = ['weibo', 'zhihu', 'nami', 'qiyu', 'jd', 'nowcoder', 'bilibili', 'chaoxing', 'smms', 'github', 'imgur'];

/**
 * 需要风险确认的非官方公共图床服务
 * GitHub / SM.MS / Imgur 使用平台提供的公开 API，不纳入强确认。
 */
export const PUBLIC_RISK_SERVICES: ServiceType[] = ['jd', 'qiyu', 'weibo', 'zhihu', 'nowcoder', 'nami', 'bilibili', 'chaoxing'];

export const PUBLIC_SERVICE_RISK_TOOLTIP = '公共图床为非官方适配，稳定性与可用性不作保证，可能因平台规则或接口变化而失效。请自行评估风险后启用。';

export function isPublicRiskService(serviceId: string): serviceId is ServiceType {
  return (PUBLIC_RISK_SERVICES as string[]).includes(serviceId);
}

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
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 占位接口，保留用于未来扩展
export interface JDServiceConfig extends BaseServiceConfig {}

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
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Token 已改为后端自动获取，此接口保留用于未来扩展
export interface QiyuServiceConfig extends BaseServiceConfig {}

/**
 * 知乎图床服务配置
 * 需要 Cookie 认证
 */
export interface ZhihuServiceConfig extends BaseServiceConfig {
  /** 知乎 Cookie */
  cookie: string;
  /**
   * 是否给 *.zhimg.com 链接追加 source 参数（绕过防盗链）
   * 影响复制链接和应用内图片显示
   */
  sourceParamEnabled?: boolean;
  /**
   * source 参数值（默认 172ae18b——社区验证过的知乎网页端渠道标识）
   * 若此值失效，用户可自行填入抓到的其他可用值
   */
  sourceParamValue?: string;
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
 * GitHub CDN 提供商
 */
export interface GithubCdnProvider {
  /** 显示名称 */
  name: string;
  /** CDN 域名，如 https://cdn.jsdmirror.com */
  url: string;
  /** URL 模板，支持变量：{domain} {owner} {repo} {branch} {path} {rawUrl} */
  template: string;
}

/**
 * GitHub CDN 加速配置
 * 通过 jsDelivr 或其镜像将 raw.githubusercontent.com 链接转换为 CDN 链接
 */
export interface GithubCdnConfig {
  /** 是否启用 CDN 加速 */
  enabled: boolean;
  /** 当前选中的 CDN 索引 */
  selectedIndex: number;
  /** CDN 提供商列表 */
  cdnList: GithubCdnProvider[];
}

/**
 * 默认 GitHub CDN 提供商列表
 */
export const DEFAULT_CDN_TEMPLATE = '{domain}/gh/{owner}/{repo}@{branch}/{path}';

export const DEFAULT_GITHUB_CDN_LIST: GithubCdnProvider[] = [
  { name: 'jsDelivr', url: 'https://cdn.jsdelivr.net', template: DEFAULT_CDN_TEMPLATE }
];

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
  /** CDN 加速配置 */
  cdnConfig?: GithubCdnConfig;
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
 * 私有存储，需要 SecretId 和 SecretKey
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
 * 私有存储，需要 AccessKey ID 和 Secret
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
 * 私有存储，需要 AK 和 SK
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
  /** 公开访问域名（如 https://cdn.example.com） */
  publicDomain: string;
  /** 存储路径前缀（默认 images/） */
  path: string;
}

/**
 * 又拍云图床服务配置
 * 私有存储，需要 Operator 和 Password
 */
export interface UpyunServiceConfig extends BaseServiceConfig {
  /** 又拍云 Operator */
  operator: string;
  /** 又提云 Password */
  password: string;
  /** 存储桶名称 */
  bucket: string;
  /** 公开访问域名（如 https://cdn.example.com） */
  publicDomain: string;
  /** 存储路径前缀（默认 images/） */
  path: string;
}

/**
 * 自定义 S3 兼容存储 Profile
 * 支持多实例，每个 profile 代表一个独立的 S3 兼容存储
 */
export interface CustomS3Profile {
  /** 唯一标识符，用于构建复合 ID（custom_s3:xxx） */
  id: string;
  /** 用户自定义显示名称（如"我的 MinIO"） */
  name: string;
  /** S3 兼容端点地址（如 https://s3.amazonaws.com） */
  endpoint: string;
  /** Access Key ID */
  accessKeyId: string;
  /** Secret Access Key */
  secretAccessKey: string;
  /** 地域（如 us-east-1） */
  region: string;
  /** 存储桶名称 */
  bucket: string;
  /** 存储路径前缀 */
  path: string;
  /** 公开访问域名（可选，留空则使用 endpoint 构建链接） */
  publicDomain: string;
}

/**
 * WebDAV 图床公开链接默认模板
 * 覆盖 nginx / NextCloud 这类「公开域名根路径 = WebDAV 根路径」的场景。
 * OpenList / Alist 用户需改成 `{domain}/d/挂载点/{path}`。
 */
export const DEFAULT_WEBDAV_URL_TEMPLATE = '{domain}/{path}';

/**
 * WebDAV 图床 Profile（多实例）
 *
 * ⚠️ 与下方备份用的 `WebDAVProfile` 是两套独立配置，不要混用：
 * - 本接口挂在 `UserConfig.webdav_profiles`，用于把图片传到 WebDAV 并生成公开链接
 * - `WebDAVProfile` 挂在 `UserConfig.webdav`，用于同步 settings.json / history.json
 *
 * Why 独立：图床需要 publicDomain / publicUrlTemplate，备份用不上；
 *          且用户的备份服务（如坚果云）和图床服务（如 OpenList）往往不是同一个。
 */
export interface WebDAVStorageProfile {
  /** 唯一标识符，用于构建复合 ID（webdav:xxx） */
  id: string;

  /** 用户自定义显示名称（如"我的 OpenList"） */
  name: string;

  /** WebDAV 端点地址（如 https://dav.example.com/dav） */
  url: string;

  /** WebDAV 用户名 */
  username: string;

  /** WebDAV 密码（加密存储，禁止明文落盘） */
  passwordEncrypted: string;

  /** 图片上传目录（如 /images/），须与备份目录隔离 */
  remotePath: string;

  /**
   * 公开访问域名（如 https://cdn.example.com）
   * 必填：WebDAV 端点本身通常需要认证，不能作为图片直链
   */
  publicDomain: string;

  /** 公开链接模板，支持变量：{domain} {path} {filename} */
  publicUrlTemplate: string;

  /**
   * 用户已确认「这是我的内网 NAS，接受明文 HTTP 传账号密码」
   *
   * 只在一种情况下需要：开着 TUN + fake-ip 的机器上，任何主机名都会解析进
   * `198.18.0.0/15`，Rust 侧因此判不出目标是不是局域网（详见
   * `docs/reference/troubleshooting/fake-ip-dns-policy-distortion.md`）。
   * 用户在设置页测试连接时会收到确认框，确认后这个标记才为 true。
   *
   * ⚠️ 三条约束：
   * - **缺省即未确认**：`undefined` / `false` 一律当没确认，不存在第三态。
   * - **只放开 fake-ip 一档**：确证公网、链路本地在确认后依然硬拒绝（Rust 侧 `LanHttpConsent`）。
   * - **改地址即作废**：确认是针对某个具体地址给的，`url` 一变就重置回 false，
   *   见 `useStorageProfiles.updateWebdavProfile`。
   */
  lanHttpConfirmed?: boolean;

  /**
   * 给上传的文件名加唯一段（`{原名}_{yyyyMMdd}_{4位随机}.{扩展名}`）防止覆盖
   *
   * **缺省即开启**（判据一律写 `!== false`，不能写 `=== true`）：升级前的 profile 里没有
   * 这个字段，若按 falsy 处理就等于给老用户默认关掉防护，而沉默覆盖是会丢图的——
   * 编辑器粘贴出来的图永远叫 `image.png`，笔记 A 的图会被笔记 B 的图顶掉且不可恢复。
   *
   * Why 原名在**前**（与 S3 系的 `{yyyyMMdd}_{随机}_{原名}` 相反）：按「最重要的参数放
   * 最前面」这条命名规范推出来的。S3 桶基本没人用文件管理器翻，日期在前便于按时间扫读；
   * WebDAV 通常指向用户自己的 NAS，那个目录**是人会去翻的**，此时最重要的是「这是哪张图」。
   * 两套顺序不同是刻意的，见 `docs/flows/upload-flow.md`，**不要为了"统一"合并掉**。
   *
   * 关掉意味着用户自己接受覆盖风险（例如就想按固定文件名更新同一张图）。
   */
  uniqueFileName?: boolean;
}

/**
 * WebDAV 配置项（单个配置）
 *
 * ⚠️ 备份/同步专用。图床请用上方的 `WebDAVStorageProfile`。
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

  /** 连接状态 */
  connectionStatus?: 'pending' | 'success' | 'failed';

  /** 最后测试时间戳 */
  lastTestedAt?: number;

  /** 最后错误信息 */
  lastError?: string;
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
