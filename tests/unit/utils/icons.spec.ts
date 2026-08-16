import { describe, expect, it } from 'vitest';
import { getServiceIcon, resolveServiceLogo } from '@/utils/icons';

describe('getServiceIcon', () => {
  it('内置服务按文件名精确命中 SVG', () => {
    expect(getServiceIcon('smms')).toContain('<svg');
  });

  it('复合 ID 与未知服务都拿不到 SVG', () => {
    expect(getServiceIcon('custom_s3:abc123')).toBeUndefined();
    expect(getServiceIcon('webdav:xyz789')).toBeUndefined();
    expect(getServiceIcon('telegraph')).toBeUndefined();
  });
});

describe('resolveServiceLogo', () => {
  it('内置服务返回 SVG 源', () => {
    const logo = resolveServiceLogo('weibo');
    expect(logo.kind).toBe('svg');
    expect(logo.kind === 'svg' && logo.svg).toContain('<svg');
  });

  it('自定义 S3 复合 ID 退到对象存储图标', () => {
    expect(resolveServiceLogo('custom_s3:abc123')).toEqual({
      kind: 'icon',
      className: 'pi pi-database',
    });
  });

  it('WebDAV 复合 ID 退到服务器图标', () => {
    expect(resolveServiceLogo('webdav:xyz789')).toEqual({
      kind: 'icon',
      className: 'pi pi-server',
    });
  });

  it('未知服务 ID 退到通用云图标', () => {
    expect(resolveServiceLogo('telegraph')).toEqual({
      kind: 'icon',
      className: 'pi pi-cloud',
    });
  });

  it('profile 被删除后残留的复合 ID 仍按类型解析', () => {
    // 历史记录里的 serviceId 不会因为 profile 删除而改写，前缀仍在
    expect(resolveServiceLogo('webdav:').kind).toBe('icon');
    expect(resolveServiceLogo('webdav:')).toEqual({ kind: 'icon', className: 'pi pi-server' });
  });
});
