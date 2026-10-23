// 图床在配置里的读写：GitHub 仓库合写、WebDAV 改地址作废 HTTP 确认、移除清凭证且能原样撤销、必填判定
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';
import {
  blankProfile, addProfile, connectHost, migrateLegacyCustomS3, disconnectHost, firstMissingField, readHostValues, renameProfile, restoreHost,
  snapshotHost, writeHostValue, writeHostValues,
} from '@/views/hosts/hostConfig';

function base(): UserConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.availableServices = ['jd', 'r2', 'github'];
  config.enabledServices = ['jd', 'r2'];
  config.services = {
    ...config.services,
    r2: { enabled: true, accountId: 'a'.repeat(32), accessKeyId: 'ak', secretAccessKey: 'sk', bucketName: 'b', path: 'img/', publicDomain: 'https://img.example.com' },
    github: { enabled: true, token: 't', owner: 'lumen', repo: 'pics', branch: 'main', path: 'images/' },
  } as UserConfig['services'];
  return config;
}

describe('hostConfig', () => {
  it('GitHub 的「仓库」读成 owner/repo，写回时拆开', () => {
    const config = base();
    expect(readHostValues(config, 'github').repo).toBe('lumen/pics');
    const next = writeHostValue(config, 'github', 'repo', ' other / repo-2 ');
    expect(next.services?.github).toMatchObject({ owner: 'other', repo: 'repo-2' });
    expect(config.services?.github).toMatchObject({ owner: 'lumen' });
  });

  it('WebDAV 改了地址或公开地址就作废「明文 HTTP 已确认」，改别的格不作废', () => {
    const profile = { ...blankProfile('webdav', 'nas', []), url: 'http://192.168.1.2/dav', lanHttpConfirmed: true };
    const { config, hostId } = addProfile(base(), profile, 'webdav');
    expect(hostId).toBe('webdav:nas');
    expect(writeHostValue(config, hostId, 'username', 'u').webdav_profiles?.[0].lanHttpConfirmed).toBe(true);
    expect(writeHostValue(config, hostId, 'url', 'http://192.168.1.3/dav').webdav_profiles?.[0].lanHttpConfirmed).toBe(false);
    expect(renameProfile(config, hostId, '家里 NAS').webdav_profiles?.[0].name).toBe('家里 NAS');
  });

  it('新建多份图床的名字不重名（现存最大序号 + 1）', () => {
    expect(blankProfile('webdav', 'x', ['WebDAV 1', 'WebDAV 3']).name).toBe('WebDAV 4');
    expect(blankProfile('s3', 'x', []).name).toBe('S3 兼容存储 1');
  });

  it('移除：去掉已添加 / 启用、清凭证、复制固定退回；撤销原样放回', () => {
    const config = base();
    config.linkOutput = { ...DEFAULT_CONFIG.linkOutput!, copyFromService: 'r2' };
    config.editorServer = { ...DEFAULT_CONFIG.editorServer!, typoraService: 'r2', obsidianService: 'jd' };
    const snap = snapshotHost(config, 'r2');
    const off = disconnectHost(config, 'r2');
    expect(off.availableServices).toEqual(['jd', 'github']);
    expect(off.enabledServices).toEqual(['jd']);
    expect(off.services?.r2).toMatchObject({ secretAccessKey: '', accessKeyId: '', accountId: '', path: 'img/' });
    expect(off.linkOutput?.copyFromService).toBeUndefined();
    // Typora 绑着它：解绑；Obsidian 绑的是别的图床，不动
    expect(off.editorServer).toMatchObject({ typoraService: null, obsidianService: 'jd' });
    const back = restoreHost(off, snap);
    expect(back.availableServices).toEqual(['jd', 'r2', 'github']);
    expect(back.enabledServices).toContain('r2');
    expect(back.services?.r2).toEqual(config.services?.r2);
    expect(back.linkOutput?.copyFromService).toBe('r2');
    expect(back.editorServer).toMatchObject({ typoraService: 'r2', obsidianService: 'jd' });
  });

  it('删除多份图床整份删掉，撤销放回', () => {
    const { config, hostId } = addProfile(base(), blankProfile('s3', 'minio', []), 's3');
    const on = connectHost(config, hostId);
    const snap = snapshotHost(on, hostId);
    const off = disconnectHost(on, hostId);
    expect(off.custom_s3_profiles).toEqual([]);
    expect(off.availableServices).not.toContain(hostId);
    expect(restoreHost(off, snap).custom_s3_profiles?.[0].id).toBe('minio');
  });

  it('必填判定与上传口径一致：腾讯云公开域名、自定义路径可留空', () => {
    expect(firstMissingField('r2', readHostValues(base(), 'r2'))).toBeNull();
    expect(firstMissingField('r2', { ...readHostValues(base(), 'r2'), publicDomain: '' })).toBe('publicDomain');
    expect(firstMissingField('tencent', { secretId: 'a', secretKey: 'b', region: 'r', bucket: 'b', publicDomain: '', path: '' })).toBeNull();
    expect(firstMissingField('github', { token: 't', repo: '', branch: '', path: '' })).toBe('repo');
    expect(firstMissingField('weibo', { cookie: '' })).toBe('cookie');
    expect(firstMissingField('jd', {})).toBeNull();
  });

  it('写几格时只改这个图床', () => {
    const next = writeHostValues(base(), 'r2', { bucketName: 'new', publicDomain: 'https://x.example' });
    expect(next.services?.r2).toMatchObject({ bucketName: 'new', publicDomain: 'https://x.example', accessKeyId: 'ak' });
    expect(next.services?.github).toEqual(base().services?.github);
  });

  it('很早的单份「自定义 S3」搬成一份 profile，已添加 / 启用里的旧 id 换成新 id；没有要搬的不动', () => {
    const config = base();
    (config.services as Record<string, unknown>).custom_s3 = { endpoint: 'https://s3.example.com', accessKeyId: 'a', secretAccessKey: 's', region: 'r', bucket: 'b' };
    config.availableServices = ['jd', 'custom_s3'];
    config.enabledServices = ['custom_s3'];
    const next = migrateLegacyCustomS3(config, 'p1')!;
    expect(next.custom_s3_profiles).toEqual([expect.objectContaining({ id: 'p1', name: '自定义 S3', endpoint: 'https://s3.example.com', bucket: 'b' })]);
    expect(next.availableServices).toEqual(['jd', 'custom_s3:p1']);
    expect(next.enabledServices).toEqual(['custom_s3:p1']);
    expect((next.services as Record<string, unknown>).custom_s3).toBeUndefined();
    expect(migrateLegacyCustomS3(base(), 'p2')).toBeNull();
  });
});
