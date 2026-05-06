const EXTERNAL_HTTP_DISABLED_MESSAGE =
  '外部 HTTP 地址已禁用，请改用 HTTPS。本机服务仅支持 http://localhost 或 http://127.0.0.1。';
const HTTPS_ONLY_MESSAGE = '地址仅支持 HTTPS，或本机回环 HTTP。';
const CREDENTIAL_URL_MESSAGE = '地址不能包含用户名或密码。';
const INVALID_URL_MESSAGE = '地址格式不正确，请输入完整的 https:// 地址。';
const PRIVATE_HOST_MESSAGE = '地址不能指向内网、链路本地或保留地址。';

export interface NetworkPolicyOptions {
  label?: string;
  allowPrivateHttps?: boolean;
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

  if (parsed.protocol === 'http:') {
    if (isLoopbackHost(parsed.hostname)) return parsed;
    throw new Error(EXTERNAL_HTTP_DISABLED_MESSAGE);
  }

  if (parsed.protocol !== 'https:') throw new Error(HTTPS_ONLY_MESSAGE);

  if (!options.allowPrivateHttps && isPrivateOrReservedHost(parsed.hostname)) {
    throw new Error(PRIVATE_HOST_MESSAGE);
  }

  return parsed;
}

export function assertAllowedWebDAVUrl(rawUrl: string): URL {
  return assertAllowedExternalUrl(rawUrl, { label: 'WebDAV 地址' });
}

export function safeImageUrl(rawUrl: string | null | undefined): string | undefined {
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
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) return undefined;

  return parsed.toString();
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

function normalizeHost(hostname: string): string {
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
    || isIpv4InCidr(host, '224.0.0.0', 4);
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
