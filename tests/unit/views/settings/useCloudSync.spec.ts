// 云同步卡状态机（S11–S15）：先配置后记录、一步失败就停；结果写成状态行的一句话；下载过配置要刷新；取消回到空闲
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebDAVProfile } from '@/config/types';

const m = vi.hoisted(() => ({
  syncConfig: vi.fn(),
  syncHistory: vi.fn(),
  pushConfig: vi.fn(),
  pushHistory: vi.fn(),
  pullConfig: vi.fn(),
  keychainDecrypt: vi.fn(),
}));

vi.mock('@/composables/backup-sync/ConfigSync', () => ({ syncConfig: m.syncConfig, pushConfig: m.pushConfig, pullConfig: m.pullConfig }));
vi.mock('@/composables/backup-sync/HistorySync', () => ({ syncHistory: m.syncHistory, pushHistory: m.pushHistory }));
vi.mock('@/security/crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/security/crypto')>()),
  secureStorage: { decrypt: m.keychainDecrypt },
}));

import { SyncFailure } from '@/composables/backup-sync/backupSyncUtils';
import { __resetCloudSyncForTests, describeSync, useCloudSync } from '@/views/settings/useCloudSync';

const profile: WebDAVProfile = { id: 'p', name: '坚果云', url: 'https://dav.example.com', username: 'u', passwordEncrypted: 'x', remotePath: '/PicNexus/' };
const BOTH = { config: true, history: true };

beforeEach(() => {
  __resetCloudSyncForTests();
  for (const fn of Object.values(m)) fn.mockReset();
  m.syncConfig.mockResolvedValue({ changed: false });
  m.syncHistory.mockResolvedValue({ uploaded: 0, downloaded: 0, total: 0 });
  m.keychainDecrypt.mockRejectedValue(new Error('需要备份密码'));
});

describe('describeSync', () => {
  it('写上传、下载各几条，为 0 的不写；都没变化写「已是最新」', () => {
    expect(describeSync({ uploaded: 3, downloaded: 5, configChanged: false })).toBe('已同步 · 上传 3 条 · 下载 5 条');
    expect(describeSync({ uploaded: 0, downloaded: 1234, configChanged: true })).toBe('已同步 · 下载 1,234 条');
    expect(describeSync({ uploaded: 0, downloaded: 0, configChanged: true })).toBe('已同步 · 配置已更新');
    expect(describeSync({ uploaded: 0, downloaded: 0, configChanged: false })).toBe('已是最新');
  });
});

describe('useCloudSync', () => {
  it('先同步配置再同步记录；成功后状态行写结果；配置被云端改了要刷新', async () => {
    const order: string[] = [];
    m.syncConfig.mockImplementation(async () => { order.push('config'); return { changed: true }; });
    m.syncHistory.mockImplementation(async () => { order.push('history'); return { uploaded: 3, downloaded: 5, total: 8 }; });
    const cloud = useCloudSync();
    await cloud.sync(profile, BOTH);
    expect(order).toEqual(['config', 'history']);
    expect(cloud.phase.value).toBe('done');
    expect(cloud.message.value).toBe('已同步 · 上传 3 条 · 下载 5 条');
    expect(cloud.needsReload.value).toBe('cloud');
  });

  it('只同步勾选的内容', async () => {
    await useCloudSync().sync(profile, { config: false, history: true });
    expect(m.syncConfig).not.toHaveBeenCalled();
    expect(m.syncHistory).toHaveBeenCalled();
  });

  it('配置一步失败就停，状态行写原因 + 处理办法', async () => {
    m.syncConfig.mockRejectedValue(new SyncFailure('坚果云拒绝访问，应用密码可能已失效', 'config'));
    const cloud = useCloudSync();
    await cloud.sync(profile, BOTH);
    expect(m.syncHistory).not.toHaveBeenCalled();
    expect(cloud.phase.value).toBe('failed');
    expect(cloud.message.value).toBe('同步失败：坚果云拒绝访问，应用密码可能已失效');
    expect(cloud.needsReload.value).toBeNull();
  });

  it('云端配置已合并进本机、回传失败：说清本机已经变了，并提示刷新', async () => {
    m.syncConfig.mockRejectedValue(new SyncFailure('连接超时，请检查网络或服务器状态', 'config', true));
    const cloud = useCloudSync();
    await cloud.sync(profile, BOTH);
    expect(cloud.message.value).toBe('同步未完成：云端改动已合并到本机，回传失败（连接超时，请检查网络或服务器状态）');
    expect(cloud.needsReload.value).toBe('cloud');
  });

  it('输入备份密码时取消：回到空闲，不算失败', async () => {
    m.syncConfig.mockRejectedValue(new Error('user_cancelled'));
    const cloud = useCloudSync();
    await cloud.sync(profile, BOTH);
    expect(cloud.phase.value).toBe('idle');
  });

  it('同步中再点不会再跑一次', async () => {
    let finish!: () => void;
    m.syncConfig.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ changed: false }); }));
    const cloud = useCloudSync();
    const first = cloud.sync(profile, BOTH);
    expect(cloud.busy.value).toBe(true);
    await cloud.sync(profile, BOTH);
    finish();
    await first;
    expect(m.syncConfig).toHaveBeenCalledTimes(1);
  });

  it('用云端覆盖本机只动配置，之后要刷新', async () => {
    const cloud = useCloudSync();
    await cloud.overwriteLocal(profile);
    expect(m.pullConfig).toHaveBeenCalled();
    expect(m.pushHistory).not.toHaveBeenCalled();
    expect(cloud.needsReload.value).toBe('cloud');
  });

  it('加密内容：输错密码不放行，输对才继续', async () => {
    const cloud = useCloudSync();
    const pending = cloud.decrypt('PNXPWD:bad');
    await vi.waitFor(() => expect(cloud.unlockRequest.value).not.toBeNull());
    await expect(cloud.unlockRequest.value!.verify('wrong')).resolves.toBe(false);
    expect(cloud.unlockRequest.value).not.toBeNull();
    cloud.unlockRequest.value!.cancel();
    await expect(pending).rejects.toThrow('user_cancelled');
    expect(cloud.unlockRequest.value).toBeNull();
  });

  it('本机设过同一个备份密码：直接用本机的密钥解开，不再问密码', async () => {
    m.keychainDecrypt.mockResolvedValue('{"plain":true}');
    const cloud = useCloudSync();
    await expect(cloud.decrypt('PNXPWD:mine')).resolves.toBe('{"plain":true}');
    expect(cloud.unlockRequest.value).toBeNull();
  });
});
