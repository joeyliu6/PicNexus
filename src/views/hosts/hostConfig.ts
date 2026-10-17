// 图床在配置里的读写（纯函数）：内置图床在 services.<id> 下，WebDAV / S3 多份在 webdav_profiles / custom_s3_profiles 里。
// 配置不迁移（README「已定的事」）：「已添加」= availableServices 里且免配置或已填凭证，「启用」= enabledServices。

import {
  DEFAULT_CONFIG, DEFAULT_WEBDAV_URL_TEMPLATE, getCustomS3ProfileId, getWebDAVProfileId, isCustomS3Id, isWebDAVId,
  makeCustomS3Id, makeWebDAVId,
  type CustomS3Profile, type UserConfig, type WebDAVStorageProfile,
} from '@/config/types';
import { nextProfileName } from '@/composables/settings/profileNaming';
import { describeHost } from './hostCatalog';

/** 一个图床在表单里的值（键 = HostField.key） */
export type HostValues = Record<string, string>;

type ServiceRecord = Record<string, unknown>;

function serviceOf(config: UserConfig, hostId: string): ServiceRecord {
  return ((config.services as Record<string, ServiceRecord | undefined> | undefined)?.[hostId]) ?? {};
}

export function findWebdav(config: UserConfig, hostId: string): WebDAVStorageProfile | undefined {
  const id = getWebDAVProfileId(hostId);
  return config.webdav_profiles?.find((p) => p.id === id);
}

export function findCustomS3(config: UserConfig, hostId: string): CustomS3Profile | undefined {
  const id = getCustomS3ProfileId(hostId);
  return config.custom_s3_profiles?.find((p) => p.id === id);
}

/** 这个图床的原始配置对象（测试连接要原样交给后端） */
export function hostRecord(config: UserConfig, hostId: string): ServiceRecord {
  if (isWebDAVId(hostId)) return (findWebdav(config, hostId) ?? {}) as unknown as ServiceRecord;
  if (isCustomS3Id(hostId)) return (findCustomS3(config, hostId) ?? {}) as unknown as ServiceRecord;
  return serviceOf(config, hostId);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 表单里每一格的当前值；GitHub 的「仓库」是 owner/repo 合写 */
export function readHostValues(config: UserConfig, hostId: string): HostValues {
  const descriptor = describeHost(hostId);
  const record = hostRecord(config, hostId);
  const values: HostValues = {};
  for (const field of descriptor?.fields ?? []) {
    if (hostId === 'github' && field.key === 'repo') {
      const owner = str(record.owner);
      const repo = str(record.repo);
      values.repo = owner || repo ? `${owner}/${repo}` : '';
    } else {
      values[field.key] = str(record[field.key]);
    }
  }
  return values;
}

/** 把一格的新值写回配置（返回新配置，不改入参） */
export function writeHostValue(config: UserConfig, hostId: string, key: string, value: string): UserConfig {
  return writeHostValues(config, hostId, { [key]: value });
}

/** 把几格新值写回配置；WebDAV 地址或公开地址一变，作废「明文 HTTP 已确认」（确认只对那个地址生效） */
export function writeHostValues(config: UserConfig, hostId: string, patch: HostValues): UserConfig {
  const fields: Record<string, string> = { ...patch };
  if (hostId === 'github' && 'repo' in fields) {
    const [owner = '', ...rest] = fields.repo.trim().split('/');
    fields.owner = owner.trim();
    fields.repo = rest.join('/').trim();
  }
  if (isWebDAVId(hostId)) {
    const id = getWebDAVProfileId(hostId);
    return {
      ...config,
      webdav_profiles: (config.webdav_profiles ?? []).map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...fields } as WebDAVStorageProfile;
        const addressChanged = next.url !== p.url || next.publicDomain !== p.publicDomain;
        return addressChanged ? { ...next, lanHttpConfirmed: false } : next;
      }),
    };
  }
  if (isCustomS3Id(hostId)) {
    const id = getCustomS3ProfileId(hostId);
    return {
      ...config,
      custom_s3_profiles: (config.custom_s3_profiles ?? []).map((p) => (p.id === id ? { ...p, ...fields } as CustomS3Profile : p)),
    };
  }
  const services = { ...(config.services ?? {}) } as Record<string, ServiceRecord>;
  services[hostId] = { ...serviceOf(config, hostId), ...fields, enabled: true };
  return { ...config, services: services as UserConfig['services'] };
}

/** 必填的格都填了吗（未填的第一格的 key；都填了返回 null） */
export function firstMissingField(hostId: string, values: HostValues): string | null {
  const descriptor = describeHost(hostId);
  if (!descriptor) return null;
  const required = descriptor.fields.filter((f) => !f.advanced && isRequiredField(hostId, f.key));
  return required.find((f) => !values[f.key]?.trim())?.key ?? null;
}

/** 与上传时的必填口径一致（SERVICE_REQUIRED_FIELDS / WEBDAV / CUSTOM_S3），GitHub「仓库」合写 owner/repo */
function isRequiredField(hostId: string, key: string): boolean {
  const descriptor = describeHost(hostId);
  if (!descriptor) return false;
  if (descriptor.kind === 'webdav') return ['url', 'username', 'passwordEncrypted', 'publicDomain'].includes(key);
  if (descriptor.kind === 's3') return ['endpoint', 'accessKeyId', 'secretAccessKey', 'region', 'bucket'].includes(key);
  if (hostId === 'github') return ['token', 'repo'].includes(key);
  const field = descriptor.fields.find((f) => f.key === key);
  if (field?.required) return true;
  // 对象存储：除「自定义路径」、可留空的公开访问域名外都必填
  if (descriptor.kind === 'object') return key !== 'path' && !(key === 'publicDomain' && hostId === 'tencent');
  return descriptor.kind === 'cookie' || descriptor.kind === 'token';
}

/** 多份图床新建时的空白一份（名字「WebDAV 1」「S3 兼容存储 1」，序号照 nextProfileName：现存最大序号 + 1） */
export function blankProfile(kind: 'webdav' | 's3', id: string, existingNames: readonly string[]): WebDAVStorageProfile | CustomS3Profile {
  const name = nextProfileName([...existingNames], kind === 'webdav' ? 'WebDAV' : 'S3 兼容存储');
  if (kind === 'webdav') {
    return {
      id, name, url: '', username: '', passwordEncrypted: '', remotePath: 'images/', publicDomain: '',
      publicUrlTemplate: DEFAULT_WEBDAV_URL_TEMPLATE, uniqueFileName: true,
    };
  }
  return { id, name, endpoint: '', accessKeyId: '', secretAccessKey: '', region: '', bucket: '', path: '', publicDomain: '' };
}

/** 把一份新建的多份图床放进配置（还没加进已添加） */
export function addProfile(config: UserConfig, profile: WebDAVStorageProfile | CustomS3Profile, kind: 'webdav' | 's3'): { config: UserConfig; hostId: string } {
  if (kind === 'webdav') {
    return { config: { ...config, webdav_profiles: [...(config.webdav_profiles ?? []), profile as WebDAVStorageProfile] }, hostId: makeWebDAVId(profile.id) };
  }
  return { config: { ...config, custom_s3_profiles: [...(config.custom_s3_profiles ?? []), profile as CustomS3Profile] }, hostId: makeCustomS3Id(profile.id) };
}

/** 多份图床的名字（重命名用） */
export function renameProfile(config: UserConfig, hostId: string, name: string): UserConfig {
  if (isWebDAVId(hostId)) {
    const id = getWebDAVProfileId(hostId);
    return { ...config, webdav_profiles: (config.webdav_profiles ?? []).map((p) => (p.id === id ? { ...p, name } : p)) };
  }
  if (isCustomS3Id(hostId)) {
    const id = getCustomS3ProfileId(hostId);
    return { ...config, custom_s3_profiles: (config.custom_s3_profiles ?? []).map((p) => (p.id === id ? { ...p, name } : p)) };
  }
  return config;
}

function addTo(list: readonly string[] | undefined, id: string): string[] {
  return [...new Set([...(list ?? []), id])];
}

/** 连接：加进已添加并启用 */
export function connectHost(config: UserConfig, hostId: string): UserConfig {
  return { ...config, availableServices: addTo(config.availableServices, hostId), enabledServices: addTo(config.enabledServices, hostId) };
}

/**
 * 断开连接：从已添加、启用里去掉；清掉凭证（多份图床整份删掉）；「复制」固定在它上面时退回最先完成；
 * 编辑器（Typora / Obsidian）绑着它时解绑。
 */
export function disconnectHost(config: UserConfig, hostId: string): UserConfig {
  const next: UserConfig = {
    ...config,
    availableServices: (config.availableServices ?? []).filter((id) => id !== hostId),
    enabledServices: (config.enabledServices ?? []).filter((id) => id !== hostId),
  };
  if (next.linkOutput?.copyFromService === hostId) next.linkOutput = { ...next.linkOutput, copyFromService: undefined };
  if (next.editorServer && (next.editorServer.typoraService === hostId || next.editorServer.obsidianService === hostId)) {
    next.editorServer = {
      ...next.editorServer,
      typoraService: next.editorServer.typoraService === hostId ? '' as never : next.editorServer.typoraService,
      obsidianService: next.editorServer.obsidianService === hostId ? '' as never : next.editorServer.obsidianService,
    };
  }
  if (isWebDAVId(hostId)) {
    const id = getWebDAVProfileId(hostId);
    return { ...next, webdav_profiles: (next.webdav_profiles ?? []).filter((p) => p.id !== id) };
  }
  if (isCustomS3Id(hostId)) {
    const id = getCustomS3ProfileId(hostId);
    return { ...next, custom_s3_profiles: (next.custom_s3_profiles ?? []).filter((p) => p.id !== id) };
  }
  const descriptor = describeHost(hostId);
  if (!descriptor || descriptor.fields.length === 0) return next;
  const services = { ...(next.services ?? {}) } as Record<string, ServiceRecord>;
  const defaults = ((DEFAULT_CONFIG.services as Record<string, ServiceRecord | undefined>)[hostId]) ?? {};
  const cleared: ServiceRecord = { ...serviceOf(next, hostId) };
  for (const field of descriptor.fields) {
    if (field.advanced) continue;
    if (hostId === 'github' && field.key === 'repo') {
      cleared.owner = '';
      cleared.repo = '';
    } else {
      cleared[field.key] = typeof defaults[field.key] === 'string' ? defaults[field.key] : '';
    }
  }
  services[hostId] = cleared;
  return { ...next, services: services as UserConfig['services'] };
}

/** 断开前的那一份（撤销时原样放回） */
export interface HostSnapshot {
  hostId: string;
  available: boolean;
  enabled: boolean;
  availableIndex: number;
  service?: ServiceRecord;
  webdav?: WebDAVStorageProfile;
  customS3?: CustomS3Profile;
  copyFrom: boolean;
  typora: boolean;
  obsidian: boolean;
}

export function snapshotHost(config: UserConfig, hostId: string): HostSnapshot {
  return {
    hostId,
    available: (config.availableServices ?? []).includes(hostId),
    enabled: (config.enabledServices ?? []).includes(hostId),
    availableIndex: (config.availableServices ?? []).indexOf(hostId),
    service: isWebDAVId(hostId) || isCustomS3Id(hostId) ? undefined : { ...serviceOf(config, hostId) },
    webdav: isWebDAVId(hostId) ? findWebdav(config, hostId) : undefined,
    customS3: isCustomS3Id(hostId) ? findCustomS3(config, hostId) : undefined,
    copyFrom: config.linkOutput?.copyFromService === hostId,
    typora: config.editorServer?.typoraService === hostId,
    obsidian: config.editorServer?.obsidianService === hostId,
  };
}

export function restoreHost(config: UserConfig, snap: HostSnapshot): UserConfig {
  const next: UserConfig = { ...config };
  if (snap.available && !(next.availableServices ?? []).includes(snap.hostId)) {
    const list = [...(next.availableServices ?? [])];
    list.splice(Math.min(Math.max(snap.availableIndex, 0), list.length), 0, snap.hostId);
    next.availableServices = list;
  }
  if (snap.enabled) next.enabledServices = addTo(next.enabledServices, snap.hostId);
  if (snap.service) next.services = { ...(next.services ?? {}), [snap.hostId]: snap.service } as UserConfig['services'];
  if (snap.webdav && !findWebdav(next, snap.hostId)) next.webdav_profiles = [...(next.webdav_profiles ?? []), snap.webdav];
  if (snap.customS3 && !findCustomS3(next, snap.hostId)) next.custom_s3_profiles = [...(next.custom_s3_profiles ?? []), snap.customS3];
  if (snap.copyFrom) next.linkOutput = { ...DEFAULT_CONFIG.linkOutput!, ...(next.linkOutput ?? {}), copyFromService: snap.hostId };
  if ((snap.typora || snap.obsidian) && next.editorServer) {
    next.editorServer = {
      ...next.editorServer,
      ...(snap.typora ? { typoraService: snap.hostId as never } : {}),
      ...(snap.obsidian ? { obsidianService: snap.hostId as never } : {}),
    };
  }
  return next;
}

/**
 * 很早的版本只有一份「自定义 S3」（services.custom_s3）。还留着它、又没有多份配置时，搬成一份 profile，
 * 已添加 / 启用里的旧 id 换成新的复合 id。没有要搬的返回 null。
 */
export function migrateLegacyCustomS3(config: UserConfig, newId: string): UserConfig | null {
  const legacy = (config.services as Record<string, ServiceRecord | undefined> | undefined)?.custom_s3;
  if (!legacy || (config.custom_s3_profiles?.length ?? 0) > 0) return null;
  const services = { ...(config.services ?? {}) } as Record<string, ServiceRecord>;
  delete services.custom_s3;
  const next: UserConfig = { ...config, services: services as UserConfig['services'] };
  if (!str(legacy.endpoint) && !str(legacy.accessKeyId)) return next;
  const hostId = makeCustomS3Id(newId);
  const swap = (list: string[] | undefined) => (list ?? []).map((id) => (id === 'custom_s3' ? hostId : id));
  return {
    ...next,
    custom_s3_profiles: [{
      id: newId, name: '自定义 S3', endpoint: str(legacy.endpoint), accessKeyId: str(legacy.accessKeyId),
      secretAccessKey: str(legacy.secretAccessKey), region: str(legacy.region), bucket: str(legacy.bucket),
      path: str(legacy.path), publicDomain: str(legacy.publicDomain),
    }],
    availableServices: swap(next.availableServices),
    enabledServices: swap(next.enabledServices),
  };
}
