import { describe, expect, it } from 'vitest';
import {
  assertAllowedExternalUrl,
  assertAllowedWebDAVUrl,
  assertAllowedWebDAVStorageUrl,
  isFakeIpPoolHost,
  isLoopbackHost,
  safeImageUrl,
} from '@/security/networkPolicy';

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
});
