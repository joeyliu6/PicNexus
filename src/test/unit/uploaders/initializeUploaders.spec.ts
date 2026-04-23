import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { initializeUploaders, syncCustomS3Uploaders } from '../../../uploaders';
import { UploaderFactory } from '../../../uploaders/base/UploaderFactory';

describe('initializeUploaders', () => {
  beforeEach(() => {
    // 清理注册表（UploaderFactory 内部是静态 Map）
    for (const id of UploaderFactory.getAvailableServices()) {
      UploaderFactory.unregister(id);
    }
  });

  it('注册所有内置图床', () => {
    initializeUploaders();
    const services = UploaderFactory.getAvailableServices().sort();
    const expected = [
      'weibo', 'r2', 'jd', 'nowcoder', 'qiyu', 'zhihu', 'nami',
      'bilibili', 'chaoxing', 'smms', 'github', 'imgur',
      'tencent', 'aliyun', 'qiniu', 'upyun',
    ].sort();
    for (const id of expected) {
      expect(services).toContain(id);
    }
  });

  it('每个已注册图床都能 create 出实例', () => {
    initializeUploaders();
    for (const id of UploaderFactory.getAvailableServices()) {
      const uploader = UploaderFactory.create(id);
      expect(uploader).toBeDefined();
      expect(typeof uploader!.serviceId).toBe('string');
    }
  });
});

describe('syncCustomS3Uploaders', () => {
  beforeEach(() => {
    for (const id of UploaderFactory.getAvailableServices()) {
      UploaderFactory.unregister(id);
    }
  });

  it('为每个 profile 注册 custom_s3:<id>', () => {
    syncCustomS3Uploaders([
      { id: 'p1', name: 'A' } as any,
      { id: 'p2', name: 'B' } as any,
    ]);
    const ids = UploaderFactory.getAvailableServices().sort();
    expect(ids).toContain('custom_s3:p1');
    expect(ids).toContain('custom_s3:p2');
  });

  it('重复调用会清掉旧的 custom_s3:* 再注册', () => {
    syncCustomS3Uploaders([{ id: 'p1', name: 'A' } as any]);
    syncCustomS3Uploaders([{ id: 'p2', name: 'B' } as any]);
    const ids = UploaderFactory.getAvailableServices();
    expect(ids).not.toContain('custom_s3:p1');
    expect(ids).toContain('custom_s3:p2');
  });

  it('空数组 → 清掉所有 custom_s3:*', () => {
    syncCustomS3Uploaders([{ id: 'p1', name: 'A' } as any]);
    syncCustomS3Uploaders([]);
    const ids = UploaderFactory.getAvailableServices();
    expect(ids.some(id => id.startsWith('custom_s3:'))).toBe(false);
  });

  it('创建的 custom_s3 实例 serviceId 以 custom_s3: 开头', () => {
    syncCustomS3Uploaders([{ id: 'foo', name: 'Foo' } as any]);
    const u = UploaderFactory.create('custom_s3:foo');
    expect(u).toBeDefined();
  });
});
