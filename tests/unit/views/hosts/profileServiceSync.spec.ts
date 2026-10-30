// profileServiceSync 测试
// 覆盖：按 profile 列表重建两类多实例上传器的注册

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncCustomS3Uploaders: vi.fn(),
  syncWebDAVUploaders: vi.fn(),
}));

vi.mock('@/uploaders', () => ({
  syncCustomS3Uploaders: mocks.syncCustomS3Uploaders,
  syncWebDAVUploaders: mocks.syncWebDAVUploaders,
}));

const { syncProfileUploaders } = await import(
  '@/views/hosts/profileServiceSync'
);

function makeProfiles(customS3Ids: string[] = [], webdavIds: string[] = []) {
  return {
    custom_s3_profiles: customS3Ids.map(id => ({ id })),
    webdav_profiles: webdavIds.map(id => ({ id })),
  } as Parameters<typeof syncProfileUploaders>[0];
}

describe('syncProfileUploaders', () => {
  beforeEach(() => {
    mocks.syncCustomS3Uploaders.mockReset();
    mocks.syncWebDAVUploaders.mockReset();
  });

  it('两类上传器都要重建注册', () => {
    const profiles = makeProfiles(['minio'], ['nas']);
    syncProfileUploaders(profiles);

    expect(mocks.syncCustomS3Uploaders).toHaveBeenCalledWith(profiles.custom_s3_profiles);
    expect(mocks.syncWebDAVUploaders).toHaveBeenCalledWith(profiles.webdav_profiles);
  });

  it('字段缺失时传空数组而非 undefined', () => {
    syncProfileUploaders({} as Parameters<typeof syncProfileUploaders>[0]);

    expect(mocks.syncCustomS3Uploaders).toHaveBeenCalledWith([]);
    expect(mocks.syncWebDAVUploaders).toHaveBeenCalledWith([]);
  });
});
