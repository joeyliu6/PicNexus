// profileServiceSync 测试
// 覆盖：多实例图床 ID 的孤儿过滤（删掉 profile 后不能在可用列表里留下幽灵图床）

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeCustomS3Id, makeWebDAVId } from '@/config/types';

const mocks = vi.hoisted(() => ({
  syncCustomS3Uploaders: vi.fn(),
  syncWebDAVUploaders: vi.fn(),
}));

vi.mock('@/uploaders', () => ({
  syncCustomS3Uploaders: mocks.syncCustomS3Uploaders,
  syncWebDAVUploaders: mocks.syncWebDAVUploaders,
}));

const { filterOrphanProfileServices, syncProfileUploaders } = await import(
  '@/composables/settings/profileServiceSync'
);

function makeProfiles(customS3Ids: string[] = [], webdavIds: string[] = []) {
  return {
    custom_s3_profiles: customS3Ids.map(id => ({ id })),
    webdav_profiles: webdavIds.map(id => ({ id })),
  } as Parameters<typeof filterOrphanProfileServices>[1];
}

describe('filterOrphanProfileServices', () => {
  it('内建图床原样保留', () => {
    const result = filterOrphanProfileServices(['jd', 'weibo', 'r2'], makeProfiles());
    expect(result).toEqual(['jd', 'weibo', 'r2']);
  });

  it('保留有对应 profile 的多实例图床', () => {
    const result = filterOrphanProfileServices(
      ['jd', makeCustomS3Id('minio'), makeWebDAVId('nas')],
      makeProfiles(['minio'], ['nas']),
    );
    expect(result).toEqual(['jd', 'custom_s3:minio', 'webdav:nas']);
  });

  it('profile 已删除的多实例图床要被摘掉', () => {
    const result = filterOrphanProfileServices(
      [makeCustomS3Id('gone'), makeWebDAVId('gone'), 'jd'],
      makeProfiles(['still-here'], ['still-here']),
    );
    expect(result).toEqual(['jd']);
  });

  it('两类 ID 互不干扰：同名 profileId 各查各的列表', () => {
    const result = filterOrphanProfileServices(
      [makeCustomS3Id('shared'), makeWebDAVId('shared')],
      makeProfiles(['shared'], []),
    );
    expect(result).toEqual(['custom_s3:shared']);
  });

  it('profiles 字段缺失时按空列表处理，不抛错', () => {
    const result = filterOrphanProfileServices(
      ['jd', makeWebDAVId('nas')],
      {} as Parameters<typeof filterOrphanProfileServices>[1],
    );
    expect(result).toEqual(['jd']);
  });
});

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
