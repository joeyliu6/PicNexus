import type { CustomS3Profile, HttpDomainConfirmable, WebDAVStorageProfile } from '../config/types';

/** 内置的 S3 系图床（都有 publicDomain，都适用明文 HTTP 确认） */
const S3_BUILTIN_SERVICE_IDS = ['r2', 'tencent', 'aliyun', 'qiniu', 'upyun'] as const;

const EXTERNAL_HTTP_DISABLED_MESSAGE =
  '外部 HTTP 地址已禁用，请改用 HTTPS。本机服务仅支持 http://localhost 或 http://127.0.0.1。';
const HTTPS_ONLY_MESSAGE = '地址仅支持 HTTPS，或本机回环 HTTP。';
const CREDENTIAL_URL_MESSAGE = '地址不能包含用户名或密码。';
const INVALID_URL_MESSAGE = '地址格式不正确，请输入完整的 https:// 地址。';
const PRIVATE_HOST_MESSAGE = '地址不能指向内网、链路本地或保留地址。';

const PUBLIC_HTTP_DISABLED_MESSAGE =
  '公网 HTTP 地址已禁用，请改用 HTTPS。局域网地址可使用 HTTP。';
const BLOCKED_HOST_MESSAGE = '地址不能指向链路本地或保留地址。';

/**
 * fake-ip 地址被当成局域网时的统一文案
 *
 * 与 Rust 侧 `src-tauri/src/url_policy.rs` 的 `FAKE_IP_HOST_MESSAGE` 保持逐字一致：
 * 同一件事在设置页和上传时说两种话，用户会以为是两个不同的问题。
 *
 * 这条一致性由 `scripts/check-cross-language-constants.mjs` 在 `npm run lint` 阶段守着，
 * 不再只是口头约定；改名或挪窝时同步更新那里的 `PAIRS`。
 */
const FAKE_IP_HOST_MESSAGE =
  '该地址属于代理软件的 fake-ip 地址池（198.18.x.x），无法确认它是局域网。请改填 NAS 的实际内网 IP（如 http://192.168.1.10:5005），或改用 HTTPS。';

export interface NetworkPolicyOptions {
  label?: string;
  allowPrivateHttps?: boolean;
  /**
   * 允许局域网地址 + 局域网 HTTP（如 http://192.168.1.10:5005）
   *
   * 仅供 WebDAV 使用：群晖 / 自建 NAS 正是这个形态，默认策略会把它们拦死，
   * 而这是 WebDAV 图床最主要的用户群。即便放行，链路本地段（含云元数据
   * 169.254.169.254）仍然拒绝——没有人的 NAS 挂在那个地址上。
   */
  allowPrivateHttp?: boolean;
  /**
   * 允许 HTTP 主机名先通过前端校验，由 Rust 侧解析 DNS 后做最终裁决。
   *
   * 仅供 WebDAV 图床使用；备份 WebDAV 继续在前端拒绝主机名 HTTP。
   */
  allowHostnameHttp?: boolean;
  /**
   * 用户已显式确认这个公开域名可以走明文 HTTP（见 {@link HttpDomainConfirmable}）
   *
   * 与 `allowPrivateHttp` 是两回事：那个放开的是"局域网地址"，本项放开的是
   * **公网明文 HTTP**——正是 WebDAV 逃生舱当初明确拒绝的那一档
   * （见 `docs/audits/webdav-digest-and-lan-http-escape-hatch-acceptance.md` 第 5 条）。
   *
   * 之所以现在开这一档：又拍云一类图床根本给不出 HTTPS（免费测试域名只有 HTTP，
   * 要 HTTPS 得绑备案域名），一刀切拒绝等于这些图床整个不可用。
   * 调用方必须先核对确认的主机名与当前域名一致，别无条件传 true。
   */
  allowConfirmedHttp?: boolean;
}

export function parseHttpUrl(rawUrl: string, label = '地址'): URL {
  try {
    return new URL(rawUrl.trim());
  } catch {
    throw new Error(label === '地址' ? INVALID_URL_MESSAGE : `${label}格式不正确，请输入完整的 https:// 地址。`);
  }
}

export function assertAllowedExternalUrl(rawUrl: string, options: NetworkPolicyOptions = {}): URL {
  const label = options.label ?? '地址';
  const parsed = parseHttpUrl(rawUrl, label);

  if (parsed.username || parsed.password) throw new Error(CREDENTIAL_URL_MESSAGE);

  const allowPrivate = options.allowPrivateHttp === true;

  if (allowPrivate && isAlwaysBlockedHost(parsed.hostname)) {
    throw new Error(BLOCKED_HOST_MESSAGE);
  }

  // fake-ip 字面量：allowPrivate 下 198.18/15 本会被 isPrivateOrReservedHost 当局域网
  // 放行，但没有人的 NAS 挂在 RFC 2544 基准测试段上。默认策略不需要这条——
  // 那边保留段本来就全拒。
  if (allowPrivate && isFakeIpPoolHost(parsed.hostname)) {
    throw new Error(FAKE_IP_HOST_MESSAGE);
  }

  if (parsed.protocol === 'http:') {
    if (isLoopbackHost(parsed.hostname)) return parsed;
    // 用户已对这个域名显式担责过。放在私网判断之前：确认的是具体域名，
    // 跟它解析到公网还是内网无关——正因为解析结果不可信（TUN fake-ip 会把
    // 任意域名塞进 198.18/15），才需要人来拍板。
    //
    // 但链路本地 / 云元数据（169.254.169.254 那一类）不在可确认之列：
    // 那不是"图床域名"，用户点确认也不该让它变成一个能被应用请求的地址。
    // 上面那两道 always-blocked 检查挂在 allowPrivate 下，这条路径走不到，
    // 所以必须在这里单独拦一次——否则整个校验层对已确认域名等于不设防。
    if (options.allowConfirmedHttp) {
      if (isAlwaysBlockedHost(parsed.hostname)) throw new Error(BLOCKED_HOST_MESSAGE);
      return parsed;
    }
    if (allowPrivate) {
      // 前端无法解析 DNS，主机名 HTTP 先放行，由 Rust 侧解析后做最终裁决。
      const host = normalizeHost(parsed.hostname);
      const isLiteralIp = isIpv4Address(host) || host.includes(':');
      if ((!isLiteralIp && options.allowHostnameHttp) || isPrivateOrReservedHost(parsed.hostname)) return parsed;
    }
    throw new Error(allowPrivate ? PUBLIC_HTTP_DISABLED_MESSAGE : EXTERNAL_HTTP_DISABLED_MESSAGE);
  }

  if (parsed.protocol !== 'https:') throw new Error(HTTPS_ONLY_MESSAGE);

  if (!options.allowPrivateHttps && !allowPrivate && isPrivateOrReservedHost(parsed.hostname)) {
    throw new Error(PRIVATE_HOST_MESSAGE);
  }

  return parsed;
}

export function assertAllowedWebDAVUrl(rawUrl: string): URL {
  return assertAllowedExternalUrl(rawUrl, { label: 'WebDAV 地址', allowPrivateHttp: true });
}

export function assertAllowedWebDAVStorageUrl(rawUrl: string): URL {
  return assertAllowedExternalUrl(rawUrl, {
    label: 'WebDAV 地址',
    allowPrivateHttp: true,
    allowHostnameHttp: true,
  });
}

/**
 * 收集已通过 fake-ip 逃生舱确认的 WebDAV 公开域名主机名
 *
 * 供 {@link safeImageUrl} 的 `confirmedHttpHosts` 参数使用：把"用户已经在设置页
 * 显式确认过这个地址"（`profile.lanHttpConfirmed`）转换成主机名集合，让缩略图
 * 之类的通用图片校验也能认得这个确认状态。只认 `publicDomain`——缩略图渲染的
 * 就是这个域名，WebDAV 端点本身（`url`）不会被拿去当图片链接。
 */
export function getConfirmedWebdavHttpHosts(
  profiles: readonly WebDAVStorageProfile[] | undefined,
): Set<string> {
  const hosts = new Set<string>();
  for (const profile of profiles ?? []) {
    if (!profile.lanHttpConfirmed || !profile.publicDomain) continue;
    try {
      const url = new URL(profile.publicDomain);
      if (url.protocol === 'http:') hosts.add(normalizeHost(url.hostname));
    } catch {
      // 域名格式不合法：交给设置页的校验去报错，这里跳过即可
    }
  }
  return hosts;
}

/**
 * 汇总全部已确认可走明文 HTTP 的公开域名主机名（WebDAV + S3 系）
 *
 * 供 {@link safeImageUrl} 的调用方一次拿全，省得每个视图各收集一遍、漏一类就少放行一批图。
 *
 * **调用方清单**（新增渲染图片的视图时请一并接上，否则那个视图等于不设防）：
 * - `HistoryTableView` / `QueueCard` → `ThumbnailImage` 的 `confirmedHttpHosts` prop
 * - `FavoritesView` / `TimelineView` → `useThumbnailFallbackChain` 的 `confirmedHttpHosts` 选项
 *
 * 后两个是 2026-08-19 补上的：给 CSP 的 `img-src` 放开 `http:` 之前，CSP 是收藏页 /
 * 时间轴仅有的图片闸门，放开之后它们一度处于无校验状态。详见
 * `docs/audits/http-image-host-2026-08-19.md`。
 */
export function getConfirmedHttpHosts(config: {
  services?: Record<string, unknown> | undefined;
  custom_s3_profiles?: readonly CustomS3Profile[] | undefined;
  webdav_profiles?: readonly WebDAVStorageProfile[] | undefined;
} | null | undefined): Set<string> {
  const s3Entries = [
    ...S3_BUILTIN_SERVICE_IDS.map((id) => config?.services?.[id]),
    ...(config?.custom_s3_profiles ?? []),
  ].filter(Boolean) as ({ publicDomain?: string } & HttpDomainConfirmable)[];

  const hosts = getConfirmedS3HttpHosts(s3Entries);
  for (const host of getConfirmedWebdavHttpHosts(config?.webdav_profiles)) hosts.add(host);
  return hosts;
}

/**
 * 把已确认主机名集合压成一个可直接比对的指纹字符串
 *
 * Why 需要它：{@link getConfirmedHttpHosts} 每调一次都产出**新 Set**，而配置保存广播
 * 极其频繁（实测填一个 S3 profile 会存 26 次，见 `docs/flows/window-system-integration.md`）。
 * 视图若按 Set 的引用去 watch「名单变了没」，每存一次都会误判成变了，
 * 把那一屏判失败的死图全部重试一轮——白发几十个必然失败的请求。
 *
 * 指纹只在**名单内容真的变了**时才变，也就是用户确认 / 撤销了某个域名的那一刻。
 */
export function confirmedHttpHostsKey(hosts: ReadonlySet<string>): string {
  return [...hosts].sort().join('|');
}

/**
 * 判断某个配置对当前公开域名的明文 HTTP 确认是否仍然有效
 *
 * 确认存的是**主机名**而不是布尔值，所以域名一改就自然失配、确认自动失效，
 * 不需要在每个能改域名的地方补作废逻辑。
 */
export function isHttpDomainConfirmed(
  config: HttpDomainConfirmable | null | undefined,
  publicDomain: string | null | undefined,
): boolean {
  const confirmed = config?.httpDomainConfirmedFor;
  if (!confirmed || !publicDomain) return false;
  try {
    const url = new URL(publicDomain.trim());
    if (url.protocol !== 'http:') return false;
    return normalizeHost(url.hostname) === normalizeHost(confirmed);
  } catch {
    return false;
  }
}

/**
 * 收集 S3 系图床里已确认可走明文 HTTP 的公开域名主机名
 *
 * 与 {@link getConfirmedWebdavHttpHosts} 同一用途、同一去处（{@link safeImageUrl}），
 * 只是数据来源不同：这边是内置的 5 个私有存储 + 自定义 S3 profile。
 */
export function getConfirmedS3HttpHosts(
  entries: readonly ({ publicDomain?: string } & HttpDomainConfirmable)[] | undefined,
): Set<string> {
  const hosts = new Set<string>();
  for (const entry of entries ?? []) {
    if (!isHttpDomainConfirmed(entry, entry?.publicDomain)) continue;
    try {
      hosts.add(normalizeHost(new URL(entry.publicDomain!.trim()).hostname));
    } catch {
      // isHttpDomainConfirmed 已经解析过一次，走到这里说明并发改了值，跳过即可
    }
  }
  return hosts;
}

/**
 * @param confirmedHttpHosts 已被用户显式确认过的明文 HTTP 主机名集合，见 {@link getConfirmedWebdavHttpHosts}
 *
 * Why 需要这个参数：fake-ip 逃生舱确认的是"这个 WebDAV 地址我信得过"，但那个
 * 确认状态存在具体的 profile 上，这个函数本身是无状态的通用校验，看不到 profile。
 * 调用方（缩略图组件）负责从已确认的 profile 里收集主机名传进来，这里只做匹配。
 */
export function safeImageUrl(
  rawUrl: string | null | undefined,
  confirmedHttpHosts?: ReadonlySet<string>,
): string | undefined {
  if (!rawUrl) return undefined;
  const value = rawUrl.trim();
  if (!value) return undefined;

  if (value.startsWith('blob:')) return value;
  if (isSafeImageDataUrl(value)) return value;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }

  if (parsed.username || parsed.password) return undefined;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  if (isAlwaysBlockedHost(parsed.hostname)) return undefined;

  // Why 放行局域网 HTTP：WebDAV 图床（群晖 / 自建 NAS）的公开域名就是
  // http://192.168.1.10:5244 这种形态。不放行的话图片能上传成功、链接也对，
  // 但历史记录里的缩略图全是裂的，体感等同于功能坏掉。
  //
  // Why 再加 confirmedHttpHosts 兜底：fake-ip 逃生舱确认的地址是主机名（如
  // nas.local），不是字面量私网 IP，isPrivateOrReservedHost 认不出来。用户已经
  // 在设置页显式担责过一次，这里不该再把它当危险链接挡掉。
  if (
    parsed.protocol === 'http:'
    && !isLoopbackHost(parsed.hostname)
    && !isPrivateOrReservedHost(parsed.hostname)
    && !confirmedHttpHosts?.has(normalizeHost(parsed.hostname))
  ) {
    return undefined;
  }

  return parsed.toString();
}

/**
 * 链路本地 / 组播 / 未指定地址：任何放行策略下都拒绝
 * 含云元数据地址 169.254.169.254 —— 放行它只会平白扩大 SSRF 面
 */
export function isAlwaysBlockedHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host) return true;

  const target = isIpv4Address(host) ? host : ipv4MappedFromIpv6(host);
  if (target !== null) {
    return isIpv4InCidr(target, '169.254.0.0', 16)
      || isIpv4InCidr(target, '224.0.0.0', 4)
      || isIpv4InCidr(target, '240.0.0.0', 4)
      || isIpv4InCidr(target, '0.0.0.0', 8);
  }

  if (host.includes(':')) {
    return host === '::' || host.startsWith('fe80:');
  }

  return false;
}

/**
 * 代理软件的 fake-ip 默认池（198.18.0.0/15）
 *
 * 严格说这是 RFC 2544 的基准测试段：公网 BGP 不路由、企业内网也不用。现实里
 * 198.18.x.x 只有一个来源——本机代理（Clash / sing-box / Surge）把域名映射进来的
 * 虚拟地址。它对目标的真实网络位置**零信息量**，所以不能当「这是局域网」的证据。
 *
 * v4 取 /15 是为了同时覆盖 mihomo 的默认 `198.18.0.1/16` 与 sing-box 的
 * `198.18.0.0/15`；v6 覆盖 mihomo 的 `fake-ip-range6` 默认 `fdfe:dcba:9876::1/64`
 * （前 64 位是固定魔数，真实 ULA 内网撞上的概率可忽略）。
 * 判据与 `src-tauri/src/url_policy.rs` 的 `is_fake_ip_pool_ip` 必须一致。
 *
 * 注意 `isPrivateOrReservedIpv4` 里的 198.18/15 **不能删**——三份实现
 * （本文件 / url_policy.rs / link_checker.rs）的保留段一致性靠它，
 * 而 fake-ip 的额外处置发生在策略层。
 */
export function isFakeIpPoolHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  const target = isIpv4Address(host) ? host : ipv4MappedFromIpv6(host);
  if (target !== null) return isIpv4InCidr(target, '198.18.0.0', 15);

  const segments = ipv6Segments(host);
  if (segments === null) return false;
  return segments[0] === 0xfdfe
    && segments[1] === 0xdcba
    && segments[2] === 0x9876
    && segments[3] === 0x0000;
}

/**
 * 把 IPv6 字面量展开成完整的 8 段，非法输入返回 null
 *
 * Why 不直接比对字符串前缀：`::` 压缩的位置不固定、前导零可省
 * （`fdfe:dcba:9876::126` 与 `fdfe:dcba:9876:0:0:0:0:126` 是同一个地址），
 * 按字符串比会漏判。内嵌 IPv4 的形式由 `ipv4MappedFromIpv6` 单独处理，
 * 这里返回 null 即可。
 */
function ipv6Segments(host: string): number[] | null {
  if (!host.includes(':')) return null;

  const [head, tail, ...rest] = host.split('::');
  if (rest.length > 0) return null; // '::' 只允许出现一次

  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    const parsed: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      parsed.push(Number.parseInt(group, 16));
    }
    return parsed;
  };

  const left = parseGroups(head);
  if (left === null) return null;
  if (tail === undefined) return left.length === 8 ? left : null;

  const right = parseGroups(tail);
  if (right === null) return null;

  const zeros = 8 - left.length - right.length;
  if (zeros < 1) return null;

  return [...left, ...Array<number>(zeros).fill(0), ...right];
}

export function isLoopbackHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  const mappedIpv4 = ipv4MappedFromIpv6(host);
  return host === 'localhost'
    || host === '::1'
    || host === '0:0:0:0:0:0:0:1'
    || isIpv4InCidr(host, '127.0.0.0', 8)
    || (mappedIpv4 !== null && isIpv4InCidr(mappedIpv4, '127.0.0.0', 8));
}

export function isPrivateOrReservedHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host) return true;
  if (isLoopbackHost(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;

  if (isIpv4Address(host)) {
    return isPrivateOrReservedIpv4(host);
  }

  const mappedIpv4 = ipv4MappedFromIpv6(host);
  if (mappedIpv4 !== null) {
    return isPrivateOrReservedIpv4(mappedIpv4);
  }

  if (host.includes(':')) {
    return host === '::'
      || host.startsWith('fe80:')
      || host.startsWith('fc')
      || host.startsWith('fd');
  }

  return false;
}

function isSafeImageDataUrl(value: string): boolean {
  return /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(value);
}

export function normalizeHost(hostname: string): string {
  return hostname.trim().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase();
}

function isIpv4Address(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

function ipv4ToInt(value: string): number {
  return value.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isIpv4InCidr(value: string, range: string, bits: number): boolean {
  if (!isIpv4Address(value)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(value) & mask) === (ipv4ToInt(range) & mask);
}

function isPrivateOrReservedIpv4(host: string): boolean {
  return isIpv4InCidr(host, '10.0.0.0', 8)
    || isIpv4InCidr(host, '172.16.0.0', 12)
    || isIpv4InCidr(host, '192.168.0.0', 16)
    || isIpv4InCidr(host, '169.254.0.0', 16)
    || isIpv4InCidr(host, '0.0.0.0', 8)
    || isIpv4InCidr(host, '100.64.0.0', 10)
    || isIpv4InCidr(host, '192.0.0.0', 24)
    || isIpv4InCidr(host, '192.0.2.0', 24)
    || isIpv4InCidr(host, '198.18.0.0', 15)
    || isIpv4InCidr(host, '198.51.100.0', 24)
    || isIpv4InCidr(host, '203.0.113.0', 24)
    || isIpv4InCidr(host, '224.0.0.0', 4)
    || isIpv4InCidr(host, '240.0.0.0', 4);
}

function ipv4MappedFromIpv6(host: string): string | null {
  const dotted = host.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted?.[1] && isIpv4Address(dotted[1])) return dotted[1];

  const hex = host.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return null;

  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;

  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join('.');
}
