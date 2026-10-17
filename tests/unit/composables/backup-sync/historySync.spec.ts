// 云端上传记录同步：按 id 与时间合并后回传；两边都没变化不写云端；
// 云端文件 0 字节 / 不是数组 / 非 404 拉取错误都中止、不覆盖云端（历史记录比配置更不可逆）；
// 拉进本机后回传失败算「部分完成」；用本机覆盖云端是云端文件损坏时的出路
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebDAVProfile } from '@/config/types';

const m = vi.hoisted(() => ({
  getFile: vi.fn(),
  putFile: vi.fn(),
  getAllItems: vi.fn(),
  importFromJSON: vi.fn(),
  getCount: vi.fn(),
  exportToJSON: vi.fn(),
  invalidateCache: vi.fn(),
  emitHistoryUpdated: vi.fn(),
  record: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@/services/database', () => ({
  historyDB: { getAllItems: m.getAllItems, importFromJSON: m.importFromJSON, getCount: m.getCount, exportToJSON: m.exportToJSON },
}));
vi.mock('@/composables/history/useHistory', () => ({ invalidateCache: m.invalidateCache }));
vi.mock('@/events/cacheEvents', () => ({ emitHistoryUpdated: m.emitHistoryUpdated }));
vi.mock('@/composables/backup-sync/syncRecords', () => ({ recordSync: m.record }));
// isWebDAVNotFoundError 与 parseCloudHistoryForUpload 用真实实现：「要不要中止」正是本文件断言的东西
vi.mock('@/composables/backup-sync/backupSyncUtils', async () => {
  const actual = await vi.importActual<typeof import('@/composables/backup-sync/backupSyncUtils')>('@/composables/backup-sync/backupSyncUtils');
  return {
    ...actual,
    writeSyncLog: m.log,
    getWebDAVClientAndPath: vi.fn(async (p: WebDAVProfile | null) => (p ? { client: { getFile: m.getFile, putFile: m.putFile }, remotePath: '/PicNexus/history.json' } : null)),
  };
});

import { pushHistory, syncHistory } from '@/composables/backup-sync/HistorySync';
import { CLOUD_HISTORY_EMPTY_REASON, SyncFailure } from '@/composables/backup-sync/backupSyncUtils';

const profile: WebDAVProfile = { id: 'p1', name: '坚果云', url: 'https://dav.example.com', username: 'u', passwordEncrypted: 'x', remotePath: '/PicNexus/' };

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.putFile.mockResolvedValue(undefined);
  m.importFromJSON.mockResolvedValue({ imported: 0, added: 0, updated: 0, skipped: 0 });
  m.getAllItems.mockResolvedValue([]);
});

describe('syncHistory', () => {
  it('合并云端与本机（按 id 与时间），把合并结果传回云端并报告上传、下载条数', async () => {
    m.getFile.mockResolvedValue(JSON.stringify([{ id: 'cloud-only', timestamp: 100 }]));
    m.importFromJSON.mockResolvedValue({ imported: 1, added: 1, updated: 0, skipped: 0 });
    m.getAllItems.mockResolvedValue([{ id: 'cloud-only', timestamp: 100 }, { id: 'local-only', timestamp: 200 }]);

    const result = await syncHistory(profile);

    expect(result).toEqual({ uploaded: 1, downloaded: 1, total: 2 });
    const uploaded = JSON.parse(m.putFile.mock.calls[0][1] as string) as Array<{ id: string }>;
    expect(uploaded.map((i) => i.id).sort()).toEqual(['cloud-only', 'local-only']);
    expect(m.invalidateCache).toHaveBeenCalled();
    expect(m.record).toHaveBeenCalledWith(profile, 'history', 'success');
  });

  it('两边都没变化：不写云端，报告 0 / 0', async () => {
    m.getFile.mockResolvedValue(JSON.stringify([{ id: 'a', timestamp: 100 }]));
    m.getAllItems.mockResolvedValue([{ id: 'a', timestamp: 100 }]);
    await expect(syncHistory(profile)).resolves.toEqual({ uploaded: 0, downloaded: 0, total: 1 });
    expect(m.putFile).not.toHaveBeenCalled();
  });

  it('只有收藏状态较新的那条也会传上去', async () => {
    m.getFile.mockResolvedValue(JSON.stringify([{ id: 'a', timestamp: 200, isFavorited: false, favoriteUpdatedAt: 100, favoriteUpdatedBy: 'cloud' }]));
    m.getAllItems.mockResolvedValue([{ id: 'a', timestamp: 200, isFavorited: true, favoriteUpdatedAt: 500, favoriteUpdatedBy: 'local' }]);
    await syncHistory(profile);
    expect(JSON.parse(m.putFile.mock.calls[0][1] as string)).toEqual([
      { id: 'a', timestamp: 200, isFavorited: true, favoriteUpdatedAt: 500, favoriteUpdatedBy: 'local' },
    ]);
  });

  it('首次同步（云端没有文件）把本机全部传上去', async () => {
    m.getFile.mockResolvedValue(null);
    m.getAllItems.mockResolvedValue([{ id: 'a', timestamp: 100 }]);
    await expect(syncHistory(profile)).resolves.toMatchObject({ uploaded: 1, downloaded: 0 });
  });

  it.each([
    ['云端文件 0 字节', () => m.getFile.mockResolvedValue('')],
    ['云端内容不是数组', () => m.getFile.mockResolvedValue(JSON.stringify({ items: [] }))],
    ['非 404 的拉取错误', () => m.getFile.mockRejectedValue(new Error('HTTP 401 Unauthorized'))],
  ])('%s：中止，不写云端也不导入本机', async (_name, arrange) => {
    arrange();
    m.getAllItems.mockResolvedValue([{ id: 'local-only', timestamp: 200 }]);
    const error = await syncHistory(profile).catch((e: unknown) => e) as SyncFailure;
    expect(error).toBeInstanceOf(SyncFailure);
    expect(error.partial).toBe(false);
    expect(m.putFile).not.toHaveBeenCalled();
    expect(m.importFromJSON).not.toHaveBeenCalled();
  });

  it('空文件的中止原因写明出路（「⋯ › 用本机覆盖云端」）', async () => {
    m.getFile.mockResolvedValue('');
    await expect(syncHistory(profile)).rejects.toThrow(CLOUD_HISTORY_EMPTY_REASON);
  });

  it('拉进本机后回传失败：标「部分完成」', async () => {
    m.getFile.mockResolvedValue(JSON.stringify([{ id: 'cloud', timestamp: 100 }]));
    m.importFromJSON.mockResolvedValue({ imported: 1, added: 1, updated: 0, skipped: 0 });
    m.getAllItems.mockResolvedValue([{ id: 'cloud', timestamp: 100 }, { id: 'local', timestamp: 200 }]);
    m.putFile.mockRejectedValue(new Error('timeout'));
    const error = await syncHistory(profile).catch((e: unknown) => e) as SyncFailure;
    expect(error.partial).toBe(true);
    expect(m.record).toHaveBeenCalledWith(profile, 'history', 'partial', expect.any(String));
  });
});

describe('pushHistory', () => {
  it('用本机覆盖云端：整份写上去，不先拉取', async () => {
    m.getCount.mockResolvedValue(3);
    m.exportToJSON.mockResolvedValue('[1,2,3]');
    await expect(pushHistory(profile)).resolves.toBe(3);
    expect(m.getFile).not.toHaveBeenCalled();
    expect(m.putFile).toHaveBeenCalledWith('/PicNexus/history.json', '[1,2,3]');
  });
});
