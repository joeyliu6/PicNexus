import { describe, expect, it } from 'vitest';
import {
  assertAllowedExternalUrl,
  assertAllowedWebDAVUrl,
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

  it('uses the shared policy for WebDAV URLs', () => {
    expect(() => assertAllowedWebDAVUrl('https://dav.example.com/sync')).not.toThrow();
    expect(() => assertAllowedWebDAVUrl('http://dav.example.com/sync')).toThrow('外部 HTTP');
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
  });
});
