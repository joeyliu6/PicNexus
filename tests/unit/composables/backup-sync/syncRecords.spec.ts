// 同步记录：写时读最新整份、只改这一份连接（同一个文件里还有京东 / 七鱼的检测状态）；很早的平铺格式读到时搬过来
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebDAVProfile } from '@/config/types';

const m = vi.hoisted(() => ({ status: null as unknown }));

vi.mock('@/store/instances', () => ({
  syncStatusStore: {
    get: vi.fn(async () => (m.status ? structuredClone(m.status) : null)),
    set: vi.fn(async (_key: string, value: unknown) => { m.status = structuredClone(value); }),
    save: vi.fn(),
  },
}));

import { __resetSyncRecordsForTests, loadSyncRecords, recordSync, useSyncRecords } from '@/composables/backup-sync/syncRecords';

const profile: WebDAVProfile = { id: 'p', name: '坚果云', url: 'https://dav.example.com', username: 'u', remotePath: '/' };

beforeEach(() => {
  __resetSyncRecordsForTests();
  m.status = null;
});

describe('syncRecords', () => {
  it('记一次成功：写上时间与结果，不碰同一文件里的图床检测状态', async () => {
    await loadSyncRecords();
    // 设置页读过之后，图床检测写进了同一个文件
    m.status = { syncByProfile: {}, jdCheckStatus: { available: true, lastCheckTime: 1 } };
    vi.setSystemTime(new Date('2026-10-17T10:00:00Z'));
    await recordSync(profile, 'history', 'success');
    vi.useRealTimers();
    const saved = m.status as { syncByProfile: Record<string, { historySyncResult: string; lastSyncAt: number }>; jdCheckStatus: unknown };
    expect(saved.jdCheckStatus).toEqual({ available: true, lastCheckTime: 1 });
    expect(saved.syncByProfile.p.historySyncResult).toBe('success');
    expect(useSyncRecords().lastSyncAt('p')).toBe(new Date('2026-10-17T10:00:00Z').getTime());
  });

  it('失败不更新「上次同步」时间', async () => {
    await recordSync(profile, 'config', 'failed', '连接超时');
    expect(useSyncRecords().lastSyncAt('p')).toBeNull();
    expect(useSyncRecords().records.value.p.configSyncError).toBe('连接超时');
  });

  it('很早的平铺格式读到时搬成 __legacy__ 并写回', async () => {
    m.status = { configLastSync: '2025-01-01 10:00:00', configSyncResult: 'success', lastJdCheck: 5 };
    await loadSyncRecords();
    expect(m.status).toMatchObject({ syncByProfile: { __legacy__: { providerName: '未知服务', configSyncResult: 'success' } }, lastJdCheck: 5 });
  });
});
