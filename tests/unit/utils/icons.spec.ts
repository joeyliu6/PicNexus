import { describe, expect, it } from 'vitest';
import { getServiceIcon } from '@/utils/icons';

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
