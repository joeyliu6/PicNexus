import { describe, expect, it } from 'vitest';
import {
  assertAllowedExternalUrl,
  assertAllowedWebDAVUrl,
  assertAllowedWebDAVStorageUrl,
  getConfirmedHttpHosts,
  getConfirmedS3HttpHosts,
  getConfirmedWebdavHttpHosts,
  isHttpDomainConfirmed,
  isFakeIpPoolHost,
  isLoopbackHost,
  normalizeHost,
  safeImageUrl,
} from '@/security/networkPolicy';
import type { WebDAVStorageProfile } from '@/config/types';

function makeWebdavProfile(overrides: Partial<WebDAVStorageProfile> = {}): WebDAVStorageProfile {
  return {
    id: 'profile-1',
    name: '我的 NAS',
    url: 'http://nas.local:5005/dav',
    username: 'user',
    passwordEncrypted: 'enc',
    remotePath: '/images',
    publicDomain: 'http://nas.local:5005',
    publicUrlTemplate: '{domain}/{path}/{filename}',
    ...overrides,
  };
}

describe('networkPolicy', () => {
  it('allows https public URLs and loopback http URLs', () => {
    expect(assertAllowedExternalUrl('https://cdn.example.com/a').hostname).toBe('cdn.example.com');
    expect(assertAllowedExternalUrl('http://127.0.0.1:8080/a').hostname).toBe('127.0.0.1');
    expect(assertAllowedExternalUrl('http://localhost:8080/a').hostname).toBe('localhost');
  });

  it('rejects non-loopback http, credential URLs, non-http schemes, and private hosts', () => {
    expect(() => assertAllowedExternalUrl('http://example.com/a')).toThrow('外部 HTTP');
    expect(() => assertAllowedExternalUrl('https://user:pass@example.com/a')).toThrow('用户名或密码');
    expect(() => assertAllowedExternalUrl('file:///tmp/a')).toThrow('HTTPS');
    expect(() => assertAllowedExternalUrl('https://192.168.1.10/a')).toThrow('内网');
    expect(() => assertAllowedExternalUrl('https://[fe80::1]/a')).toThrow('内网');
    expect(() => assertAllowedExternalUrl('https://[::ffff:192.168.1.10]/a')).toThrow('内网');
    expect(() => assertAllowedExternalUrl('https://240.0.0.1/a')).toThrow('内网');
    expect(() => assertAllowedExternalUrl('https://255.255.255.255/a')).toThrow('内网');
    expect(() => assertAllowedExternalUrl('https://[::ffff:240.0.0.1]/a')).toThrow('内网');
  });

  it('allows LAN addresses for WebDAV but still blocks public http and link-local', () => {
    expect(() => assertAllowedWebDAVUrl('https://dav.example.com/sync')).not.toThrow();

    // 群晖 / 自建 NAS：局域网 HTTP 与 HTTPS 都必须放行
    expect(assertAllowedWebDAVUrl('http://192.168.1.10:5005/dav').hostname).toBe('192.168.1.10');
    expect(assertAllowedWebDAVUrl('http://10.0.0.5/dav').hostname).toBe('10.0.0.5');
    expect(assertAllowedWebDAVUrl('http://172.16.3.4/dav').hostname).toBe('172.16.3.4');
    expect(assertAllowedWebDAVUrl('https://192.168.1.10/dav').hostname).toBe('192.168.1.10');
    expect(assertAllowedWebDAVUrl('http://localhost:5244/dav').hostname).toBe('localhost');

    // 公网 HTTP 依旧禁止（明文凭证会在公网裸奔）
    expect(() => assertAllowedWebDAVUrl('http://dav.example.com/sync')).toThrow('公网 HTTP');
    expect(() => assertAllowedWebDAVUrl('http://8.8.8.8/sync')).toThrow('公网 HTTP');

    // 图床上传链路：主机名 HTTP 前端无法解析，先放行给 Rust 做 DNS 级最终裁决
    expect(assertAllowedWebDAVStorageUrl('http://dav.example.com/sync').hostname).toBe('dav.example.com');
    expect(assertAllowedWebDAVStorageUrl('http://nas.local:5005/dav').hostname).toBe('nas.local');
    expect(() => assertAllowedWebDAVStorageUrl('http://8.8.8.8/sync')).toThrow('公网 HTTP');

    // 链路本地 / 云元数据地址：放行策略下也必须拒绝
    expect(() => assertAllowedWebDAVUrl('http://169.254.169.254/latest')).toThrow('链路本地');
    expect(() => assertAllowedWebDAVUrl('https://169.254.169.254/latest')).toThrow('链路本地');
    expect(() => assertAllowedWebDAVUrl('http://[fe80::1]/dav')).toThrow('链路本地');

    // 凭证内嵌仍然拒绝
    expect(() => assertAllowedWebDAVUrl('http://u:p@192.168.1.10/dav')).toThrow('用户名或密码');
  });

  it('identifies the proxy fake-ip pool', () => {
    // 判据必须与 src-tauri/src/url_policy.rs 的 is_fake_ip_pool_ip 对齐
    expect(isFakeIpPoolHost('198.18.0.0')).toBe(true);
    expect(isFakeIpPoolHost('198.18.1.172')).toBe(true);
    expect(isFakeIpPoolHost('198.19.255.255')).toBe(true);
    // v4-mapped 形式不能绕过识别
    expect(isFakeIpPoolHost('[::ffff:198.18.1.1]')).toBe(true);

    // 边界外侧是普通公网，不能被判据"顺手"多吃一格
    expect(isFakeIpPoolHost('198.17.255.255')).toBe(false);
    expect(isFakeIpPoolHost('198.20.0.0')).toBe(false);
    expect(isFakeIpPoolHost('192.168.1.10')).toBe(false);
    expect(isFakeIpPoolHost('dav.example.com')).toBe(false);

    // v6 池：mihomo 的 fake-ip-range6 默认 fdfe:dcba:9876::1/64
    // 压缩写法与完整写法必须判成同一个地址
    expect(isFakeIpPoolHost('[fdfe:dcba:9876::126]')).toBe(true);
    expect(isFakeIpPoolHost('[fdfe:dcba:9876:0:0:0:0:126]')).toBe(true);
    expect(isFakeIpPoolHost('[FDFE:DCBA:9876::1]')).toBe(true);

    // 相邻但不同的 ULA 前缀是别人家的真实内网
    expect(isFakeIpPoolHost('[fdfe:dcba:9876:1::1]')).toBe(false);
    expect(isFakeIpPoolHost('[fdfe:dcba:9875::1]')).toBe(false);
    expect(isFakeIpPoolHost('[fd00::1]')).toBe(false);
    expect(isFakeIpPoolHost('[fc00::1]')).toBe(false);
    expect(isFakeIpPoolHost('[2001:4860:4860::8888]')).toBe(false);
  });

  it('refuses to treat fake-ip literals as LAN for WebDAV', () => {
    // 开了 TUN + fake-ip 的机器上任意域名都会被编进 198.18.0.0/15。
    // 旧实现把它当局域网放行，公网 WebDAV 的明文凭证防线随之失效。
    // 前端只拦得住字面量，主机名交给 Rust 侧按 DNS 结果裁决。
    expect(() => assertAllowedWebDAVUrl('http://198.18.1.1/dav')).toThrow('fake-ip');
    expect(() => assertAllowedWebDAVUrl('https://198.18.1.1/dav')).toThrow('fake-ip');
    expect(() => assertAllowedWebDAVStorageUrl('http://198.18.1.172/dav')).toThrow('fake-ip');
    expect(() => assertAllowedWebDAVStorageUrl('http://[::ffff:198.18.1.1]/dav')).toThrow('fake-ip');
    // v6 fake-ip 落在 ULA 里，isPrivateOrReservedHost 本会把它当内网放行
    expect(() => assertAllowedWebDAVUrl('http://[fdfe:dcba:9876::126]/dav')).toThrow('fake-ip');

    // 防过修：真实局域网段一个都不能误伤
    expect(() => assertAllowedWebDAVUrl('http://192.168.1.10:5005/dav')).not.toThrow();
    expect(() => assertAllowedWebDAVStorageUrl('http://10.0.0.5/dav')).not.toThrow();
  });

  it('keeps other callers on the strict policy', () => {
    // WebDAV 的放行不能外溢到 GitHub CDN / S3 publicDomain
    expect(() => assertAllowedExternalUrl('http://192.168.1.10/a')).toThrow('外部 HTTP');
    expect(() => assertAllowedExternalUrl('https://192.168.1.10/a')).toThrow('内网');
  });

  it('detects loopback hosts', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('localhost.')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('[::ffff:127.0.0.1]')).toBe(true);
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
  });

  it('sanitizes image URLs for thumbnails and previews', () => {
    expect(safeImageUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(safeImageUrl('http://127.0.0.1:3000/a.png')).toBe('http://127.0.0.1:3000/a.png');
    expect(safeImageUrl('data:image/png;base64,aaaa')).toBe('data:image/png;base64,aaaa');
    expect(safeImageUrl('blob:https://app.local/id')).toBe('blob:https://app.local/id');
    expect(safeImageUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeImageUrl('file:///tmp/a.png')).toBeUndefined();
    expect(safeImageUrl('https://user:pass@example.com/a.png')).toBeUndefined();
    expect(safeImageUrl('https://10.0.0.2/a.png')).toBe('https://10.0.0.2/a.png');
    expect(safeImageUrl('http://example.com/a.png')).toBeUndefined();

    // WebDAV 图床（NAS）的公开域名就是这个形态，不放行则历史记录缩略图全裂
    expect(safeImageUrl('http://192.168.1.10:5244/d/img/a.png')).toBe('http://192.168.1.10:5244/d/img/a.png');
    expect(safeImageUrl('http://10.0.0.2/a.png')).toBe('http://10.0.0.2/a.png');

    // 链路本地 / 云元数据依旧拒绝
    expect(safeImageUrl('http://169.254.169.254/latest')).toBeUndefined();
    expect(safeImageUrl('https://169.254.169.254/latest')).toBeUndefined();
  });

  it('allows HTTP hostnames the user already confirmed via the lan-http escape hatch', () => {
    // fake-ip 逃生舱确认的是主机名（如 nas.local），不是字面量私网 IP，
    // 默认策略认不出来——必须显式传入已确认主机名集合才放行
    const confirmed = new Set([normalizeHost('nas.local')]);

    expect(safeImageUrl('http://nas.local/img/a.png', confirmed))
      .toBe('http://nas.local/img/a.png');
    // 大小写不敏感，与 normalizeHost 的归一化口径一致
    expect(safeImageUrl('http://NAS.LOCAL/img/a.png', confirmed))
      .toBe('http://nas.local/img/a.png');
    // 没传集合、或主机名不在集合里，仍然按默认策略拒绝
    expect(safeImageUrl('http://nas.local/img/a.png')).toBeUndefined();
    expect(safeImageUrl('http://other.example.com/img/a.png', confirmed)).toBeUndefined();
    // 确认名单不能给链路本地 / 云元数据地址开后门
    const blocked = new Set([normalizeHost('169.254.169.254')]);
    expect(safeImageUrl('http://169.254.169.254/latest', blocked)).toBeUndefined();
  });

  it('collects confirmed HTTP hostnames only from confirmed WebDAV profiles', () => {
    const hosts = getConfirmedWebdavHttpHosts([
      makeWebdavProfile({ lanHttpConfirmed: true, publicDomain: 'http://NAS.local:5005' }),
      // 未确认：不该被收进去
      makeWebdavProfile({ id: 'p2', lanHttpConfirmed: false, publicDomain: 'http://other.local' }),
      // 已确认但是 HTTPS：不需要这份名单，也不该被收进去
      makeWebdavProfile({ id: 'p3', lanHttpConfirmed: true, publicDomain: 'https://cdn.example.com' }),
      // 已确认但域名格式不合法：跳过而不是抛错
      makeWebdavProfile({ id: 'p4', lanHttpConfirmed: true, publicDomain: 'not a url' }),
    ]);

    // 大小写已归一化
    expect(hosts.has(normalizeHost('nas.local'))).toBe(true);
    expect(hosts.size).toBe(1);

    expect(getConfirmedWebdavHttpHosts(undefined).size).toBe(0);
    expect(getConfirmedWebdavHttpHosts([]).size).toBe(0);
  });
});

// 明文 HTTP 公开域名的确认机制（2026-08-19）
//
// 与 WebDAV 的 lanHttpConfirmed 有个关键差别：这里存的是**主机名**而不是布尔值，
// 所以"改了域名确认就失效"是判据本身保证的，不靠额外的作废逻辑。
describe('networkPolicy · 明文 HTTP 公开域名确认', () => {
  it('确认只对同一个主机名生效，换域名即失效', () => {
    const cfg = { httpDomainConfirmedFor: 'cdn.example.com' };

    expect(isHttpDomainConfirmed(cfg, 'http://cdn.example.com')).toBe(true);
    // 大小写、端口、路径都不影响判据
    expect(isHttpDomainConfirmed(cfg, 'http://CDN.Example.com:8080/img/')).toBe(true);

    // 反向判据：确认了 A 不等于放行 B。存布尔值的实现会在这里放行
    expect(isHttpDomainConfirmed(cfg, 'http://other.example.com')).toBe(false);
    // 没确认过
    expect(isHttpDomainConfirmed({}, 'http://cdn.example.com')).toBe(false);
    // HTTPS 不需要确认，这里一律回 false（判的是"要不要放行明文"）
    expect(isHttpDomainConfirmed(cfg, 'https://cdn.example.com')).toBe(false);
    // 垃圾输入不抛错
    expect(isHttpDomainConfirmed(cfg, 'not a url')).toBe(false);
    expect(isHttpDomainConfirmed(cfg, '')).toBe(false);
  });

  it('未确认的明文 HTTP 公开域名仍然被拒，确认后才放行', () => {
    expect(() => assertAllowedExternalUrl('http://cdn.example.com', { label: '公开访问域名' }))
      .toThrow();

    expect(() => assertAllowedExternalUrl('http://cdn.example.com', {
      label: '公开访问域名',
      allowConfirmedHttp: true,
    })).not.toThrow();
  });

  it('确认过的域名不能给链路本地 / 云元数据地址开后门', () => {
    // 校验层：点过确认也不能让这类地址通过。上面那两道 always-blocked 检查挂在
    // allowPrivate 下，allowConfirmedHttp 走不到，必须单独拦——漏了的话整个校验层
    // 对已确认域名等于不设防（2026-08-19 代码审查发现，当时确实漏着）
    for (const host of ['169.254.169.254', '169.254.1.1']) {
      expect(() => assertAllowedExternalUrl(`http://${host}/latest`, {
        label: '公开访问域名',
        allowConfirmedHttp: true,
      }), `${host} 不该被放行`).toThrow();
    }

    // 反向判据：普通私网地址仍要放行——自建 MinIO 挂在 192.168.x 是正当场景
    expect(() => assertAllowedExternalUrl('http://192.168.1.10:9000', {
      label: '公开访问域名',
      allowConfirmedHttp: true,
    })).not.toThrow();

    // 渲染层：同一件事在 safeImageUrl 这边也拦着（两道闸各自独立）
    const hosts = getConfirmedS3HttpHosts([
      { publicDomain: 'http://169.254.169.254', httpDomainConfirmedFor: '169.254.169.254' },
    ]);
    expect(safeImageUrl('http://169.254.169.254/latest', hosts)).toBeUndefined();
  });

  it('S3 系与 WebDAV 的已确认主机名会合并到同一份名单', () => {
    const hosts = getConfirmedHttpHosts({
      services: {
        upyun: { publicDomain: 'http://IMG.upcdn.net', httpDomainConfirmedFor: 'img.upcdn.net' },
        // 确认过但域名已改：失配，不该收进来
        r2: { publicDomain: 'http://new.example.com', httpDomainConfirmedFor: 'old.example.com' },
        // 没确认过
        qiniu: { publicDomain: 'http://plain.example.com' },
      },
      custom_s3_profiles: [
        { id: 'p1', publicDomain: 'http://minio.example.com', httpDomainConfirmedFor: 'minio.example.com' },
      ],
      webdav_profiles: [
        makeWebdavProfile({ lanHttpConfirmed: true, publicDomain: 'http://nas.local:5005' }),
      ],
    } as never);

    expect(hosts.has('img.upcdn.net')).toBe(true);
    expect(hosts.has('minio.example.com')).toBe(true);
    expect(hosts.has('nas.local')).toBe(true);
    expect(hosts.has('new.example.com')).toBe(false);
    expect(hosts.has('plain.example.com')).toBe(false);
    expect(hosts.size).toBe(3);

    expect(getConfirmedHttpHosts(null).size).toBe(0);
  });
});
