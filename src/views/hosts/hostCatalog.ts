// 图床描述表（HostsScreen.dc.html）：每种图床怎么接入、目录里怎么写、详情头部说明、表单有哪些格、测试验到哪几步。
// 目录、连接表单、详情设置区、测试连接都从这一份数据出发；设计稿没画的图床照最接近的画法补（见 docs/design/redesign/decisions/hosts.md）。

import { isCustomS3Id, isWebDAVId } from '@/config/types';

/** 接入方式：免配置 / Cookie 登录 / Token / 对象存储 / 自建 WebDAV / 自建 S3 */
export type HostKind = 'builtin' | 'cookie' | 'token' | 'object' | 'webdav' | 's3';

/** 测试连接依次验的三步（交接说明 8.4） */
export type TestStep = 'credentials' | 'write' | 'public';

/** 目录的接入方式筛选（P13） */
export type CatalogFilter = 'all' | 'builtin' | 'cookie' | 'token' | 'object' | 'self';

export interface HostField {
  /** 配置键：内置图床是 services.<id> 下的键，多份图床是 profile 的键；`repo` 是 GitHub 的「用户名/仓库名」合写 */
  key: string;
  label: string;
  /** 标 *（Token 类，P03） */
  required?: boolean;
  /** 敏感字段：密文常驻、查看 30 秒、点进即清空 */
  secret?: boolean;
  /** 跨两列 */
  wide?: boolean;
  help?: string;
  placeholder?: string;
  /** 输入框里的链接（「在 GitHub 生成」） */
  link?: { label: string; url: string };
  /** 收进「高级选项」 */
  advanced?: boolean;
}

export interface HostDescriptor {
  /** 内置图床 id；多份的是模板 id：webdav / s3 */
  id: string;
  kind: HostKind;
  /** 目录卡片上的名字（与详情名不同的只有腾讯云 COS / 阿里云 OSS / S3 兼容存储） */
  catalogName: string;
  /** 目录卡片第二行：需要准备什么 */
  catalogSub: string;
  /** 详情头部说明 */
  intro: string;
  /** 左栏第二行（正常、启用时） */
  type: string;
  testLabel: '检测可用性' | '测试连接';
  /** 测试实际验到哪几步（不同图床的后端能验的不一样） */
  steps: TestStep[];
  fields: HostField[];
  /** 是不是需要风险确认的公共图床（非官方适配） */
  publicRisk: boolean;
  /** 「测试并连接」旁的一句说明 */
  connectNote?: string;
}

const PUBLIC_DOMAIN_HELP = '建议 HTTPS；填 HTTP 时会确认一次，只对这个地址生效';

const COOKIE_FIELDS: HostField[] = [{ key: 'cookie', label: 'Cookie', secret: true, wide: true, help: '登录后自动填入，也可点击输入框粘贴' }];

function cookieHost(id: string, name: string): HostDescriptor {
  return {
    id, kind: 'cookie', catalogName: name, catalogSub: '登录账号', intro: '公共图床 · Cookie 登录', type: '公共图床',
    testLabel: '检测可用性', steps: ['credentials'], fields: COOKIE_FIELDS, publicRisk: true,
  };
}

function builtinHost(id: string, name: string): HostDescriptor {
  return {
    id, kind: 'builtin', catalogName: name, catalogSub: '开箱即用', intro: '公共图床 · 免配置', type: '公共图床',
    testLabel: '检测可用性', steps: [], fields: [], publicRisk: true,
  };
}

const OBJECT_STEPS: TestStep[] = ['credentials', 'write', 'public'];
const PATH_FIELD: HostField = { key: 'path', label: '自定义路径', placeholder: 'blog/images/', wide: true, advanced: true };

export const HOST_CATALOG: readonly HostDescriptor[] = [
  builtinHost('jd', '京东'),
  builtinHost('qiyu', '七鱼'),
  cookieHost('weibo', '微博'),
  cookieHost('zhihu', '知乎'),
  cookieHost('bilibili', 'B站'),
  cookieHost('nowcoder', '牛客'),
  cookieHost('nami', '纳米'),
  cookieHost('chaoxing', '超星'),
  {
    id: 'github', kind: 'token', catalogName: 'GitHub', catalogSub: '用自己的仓库存图', intro: '使用自有仓库 · Token', type: '自有仓库',
    testLabel: '测试连接', steps: ['credentials', 'write'], publicRisk: false, connectNote: '将在仓库中写入并删除一个测试文件',
    fields: [
      { key: 'token', label: 'Token', required: true, secret: true, wide: true, help: '需要 repo 权限', link: { label: '在 GitHub 生成', url: 'https://github.com/settings/tokens/new?scopes=repo&description=PicNexus' } },
      { key: 'repo', label: '仓库', required: true, help: '格式：用户名/仓库名', placeholder: 'lumen/picnexus-images' },
      { key: 'branch', label: '分支', help: '默认 main', placeholder: 'main' },
      { key: 'path', label: '存储路径', wide: true, help: '图片在仓库中的目录', placeholder: 'images/' },
    ],
  },
  {
    id: 'smms', kind: 'token', catalogName: 'SM.MS', catalogSub: '需要 API Token', intro: '公共图床 · Token', type: '公共图床',
    testLabel: '测试连接', steps: ['credentials'], publicRisk: false,
    fields: [{ key: 'token', label: 'API Token', required: true, secret: true, wide: true, link: { label: '在 SM.MS 获取', url: 'https://sm.ms/home/apitoken' } }],
  },
  {
    id: 'imgur', kind: 'token', catalogName: 'Imgur', catalogSub: '需要 Client ID', intro: '公共图床 · Token', type: '公共图床',
    testLabel: '测试连接', steps: ['credentials'], publicRisk: false,
    fields: [{ key: 'clientId', label: 'Client ID', required: true, secret: true, wide: true, link: { label: '注册应用', url: 'https://api.imgur.com/oauth2/addclient' } }],
  },
  {
    id: 'r2', kind: 'object', catalogName: 'Cloudflare R2', catalogSub: 'Account ID 与密钥', intro: '对象存储 · S3 兼容', type: '对象存储',
    testLabel: '测试连接', steps: OBJECT_STEPS, publicRisk: false,
    fields: [
      { key: 'accountId', label: 'Account ID' },
      { key: 'accessKeyId', label: 'Access Key ID' },
      { key: 'secretAccessKey', label: 'Secret Access Key', secret: true, wide: true },
      { key: 'bucketName', label: '存储桶' },
      { key: 'publicDomain', label: '公开访问域名', placeholder: 'https://img.example.com' },
      PATH_FIELD,
    ],
  },
  {
    id: 'tencent', kind: 'object', catalogName: '腾讯云 COS', catalogSub: 'SecretId 与 SecretKey', intro: '对象存储 · 腾讯云 COS', type: '对象存储',
    testLabel: '测试连接', steps: OBJECT_STEPS, publicRisk: false,
    fields: [
      { key: 'secretId', label: 'SecretId' },
      { key: 'secretKey', label: 'SecretKey', secret: true },
      { key: 'region', label: '地域', placeholder: 'ap-guangzhou' },
      { key: 'bucket', label: '存储桶' },
      { key: 'publicDomain', label: '公开访问域名', wide: true, help: '留空使用 COS 默认域名', placeholder: 'https://img.example.com', advanced: true },
      PATH_FIELD,
    ],
  },
  {
    id: 'aliyun', kind: 'object', catalogName: '阿里云 OSS', catalogSub: 'AccessKey', intro: '对象存储 · 阿里云 OSS', type: '对象存储',
    testLabel: '测试连接', steps: OBJECT_STEPS, publicRisk: false,
    fields: [
      { key: 'accessKeyId', label: 'AccessKey ID' },
      { key: 'accessKeySecret', label: 'AccessKey Secret', secret: true },
      { key: 'region', label: '地域', placeholder: 'oss-cn-hangzhou' },
      { key: 'bucket', label: '存储桶' },
      { key: 'publicDomain', label: '公开访问域名', wide: true, placeholder: 'https://img.example.com', help: PUBLIC_DOMAIN_HELP },
      PATH_FIELD,
    ],
  },
  {
    id: 'qiniu', kind: 'object', catalogName: '七牛云', catalogSub: 'AccessKey 与空间名', intro: '对象存储 · 七牛云 Kodo', type: '对象存储',
    testLabel: '测试连接', steps: OBJECT_STEPS, publicRisk: false,
    fields: [
      { key: 'accessKey', label: 'AccessKey' },
      { key: 'secretKey', label: 'SecretKey', secret: true },
      { key: 'region', label: '地域', placeholder: 'cn-east-1' },
      { key: 'bucket', label: '空间名' },
      { key: 'publicDomain', label: '公开访问域名', wide: true, placeholder: 'https://img.example.com', help: PUBLIC_DOMAIN_HELP },
      PATH_FIELD,
    ],
  },
  {
    id: 'upyun', kind: 'object', catalogName: '又拍云', catalogSub: '操作员账号', intro: '对象存储 · 又拍云 USS', type: '对象存储',
    testLabel: '测试连接', steps: ['credentials'], publicRisk: false,
    fields: [
      { key: 'operator', label: '操作员' },
      { key: 'password', label: '操作员密码', secret: true },
      { key: 's3AccessKey', label: 'S3 AccessKey', help: '在「操作员授权 › S3 访问凭证」生成' },
      { key: 's3SecretKey', label: 'S3 SecretKey', secret: true },
      { key: 'bucket', label: '服务名' },
      { key: 'publicDomain', label: '公开访问域名', placeholder: 'https://img.example.com' },
      PATH_FIELD,
    ],
  },
  {
    id: 's3', kind: 's3', catalogName: 'S3 兼容存储', catalogSub: 'MinIO、B2、Wasabi 等', intro: 'S3 兼容存储 · 自定义名称', type: 'S3 兼容存储',
    testLabel: '测试连接', steps: OBJECT_STEPS, publicRisk: false,
    fields: [
      { key: 'endpoint', label: 'Endpoint', wide: true, placeholder: 'https://s3.example.com', help: '公网地址仅支持 HTTPS' },
      { key: 'accessKeyId', label: 'Access Key ID' },
      { key: 'secretAccessKey', label: 'Secret Access Key', secret: true },
      { key: 'region', label: '地域', placeholder: 'us-east-1' },
      { key: 'bucket', label: '存储桶' },
      { key: 'publicDomain', label: '公开访问域名', wide: true, placeholder: 'https://cdn.example.com', help: '留空使用 Endpoint 拼出的地址', advanced: true },
      PATH_FIELD,
    ],
  },
  {
    id: 'webdav', kind: 'webdav', catalogName: 'WebDAV', catalogSub: 'NAS、坚果云等', intro: 'WebDAV · 自定义名称', type: 'WebDAV',
    testLabel: '测试连接', steps: OBJECT_STEPS, publicRisk: false,
    fields: [
      { key: 'url', label: '服务器 URL', wide: true, placeholder: 'https://dav.example.com/dav' },
      { key: 'username', label: '用户名' },
      { key: 'passwordEncrypted', label: '密码', secret: true },
      { key: 'remotePath', label: '远程路径', placeholder: '/picnexus' },
      { key: 'publicDomain', label: '公开访问地址', placeholder: 'https://img.example.com' },
      { key: 'publicUrlTemplate', label: '链接模板', wide: true, placeholder: '{domain}/{path}', help: '可用变量 {domain} {path} {filename}', advanced: true },
    ],
  },
];

const BY_ID = new Map(HOST_CATALOG.map((h) => [h.id, h]));

/** 图床 id（含 webdav:xxx / custom_s3:xxx 复合 id）→ 描述 */
export function describeHost(hostId: string): HostDescriptor | undefined {
  if (isWebDAVId(hostId)) return BY_ID.get('webdav');
  if (isCustomS3Id(hostId)) return BY_ID.get('s3');
  return BY_ID.get(hostId);
}

/** 目录分组（P13 的顺序与标题） */
export const CATALOG_GROUPS: ReadonlyArray<{ filter: Exclude<CatalogFilter, 'all'>; title: string; note: string; kinds: HostKind[] }> = [
  { filter: 'builtin', title: '免配置', note: '公共图床，无需账号', kinds: ['builtin'] },
  { filter: 'cookie', title: '登录后使用', note: '在应用内登录，自动获取凭证', kinds: ['cookie'] },
  { filter: 'token', title: '填写 Token', note: '在对应网站生成后粘贴', kinds: ['token'] },
  { filter: 'object', title: '对象存储', note: '自己的存储空间，最稳', kinds: ['object'] },
  { filter: 'self', title: '自建', note: '可以添加多个', kinds: ['s3', 'webdav'] },
];

export const CATALOG_FILTERS: ReadonlyArray<{ value: CatalogFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'builtin', label: '免配置' },
  { value: 'cookie', label: '登录' },
  { value: 'token', label: 'Token' },
  { value: 'object', label: '对象存储' },
  { value: 'self', label: '自建' },
];

/** 「高级选项」按钮旁的摘要（R2：「自定义路径」） */
export function advancedSummary(descriptor: HostDescriptor): string {
  return descriptor.fields.filter((f) => f.advanced).map((f) => f.label).join('、');
}
