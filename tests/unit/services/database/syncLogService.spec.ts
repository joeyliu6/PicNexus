import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addSyncLogQuery,
  getSyncLogsQuery,
  clearSyncLogsQuery,
} from '@/services/database/SyncLogService';
import type { SyncLogEntry } from '@/services/database/types';

function makeDb(): any {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue([]),
  };
}

function makeEntry(overrides: Partial<SyncLogEntry> = {}): SyncLogEntry {
  return {
    id: 'log-1',
    timestamp: 1700000000,
    operation: 'upload_settings_cloud' as any,
    result: 'success',
    details: 'ok',
    profileId: 'p1',
    profileName: 'Profile A',
    ...overrides,
  };
}

describe('SyncLogService', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
  });

  describe('addSyncLogQuery', () => {
    it('INSERT 日志 + 删除 20 条以外的旧日志', async () => {
      await addSyncLogQuery(db, makeEntry());
      expect(db.execute).toHaveBeenCalledTimes(2);
      expect(db.execute.mock.calls[0][0]).toContain('INSERT INTO sync_log');
      expect(db.execute.mock.calls[1][0]).toContain('DELETE FROM sync_log');
    });

    it('缺省字段用 null', async () => {
      await addSyncLogQuery(db, makeEntry({ details: undefined, profileId: undefined, profileName: undefined }));
      const args = db.execute.mock.calls[0][1];
      expect(args[4]).toBeNull();
      expect(args[5]).toBeNull();
      expect(args[6]).toBeNull();
    });
  });

  describe('getSyncLogsQuery', () => {
    it('默认 limit=20', async () => {
      await getSyncLogsQuery(db);
      expect(db.select.mock.calls[0][1]).toEqual([20]);
    });

    it('自定义 limit', async () => {
      await getSyncLogsQuery(db, 5);
      expect(db.select.mock.calls[0][1]).toEqual([5]);
    });

    it('将 profile_id / details 空值转成 undefined', async () => {
      db.select.mockResolvedValue([
        {
          id: 'a', timestamp: 1, operation: 'upload', result: 'success',
          details: null, profile_id: null, profile_name: null,
        },
      ]);
      const logs = await getSyncLogsQuery(db);
      expect(logs[0].details).toBeUndefined();
      expect(logs[0].profileId).toBeUndefined();
      expect(logs[0].profileName).toBeUndefined();
    });
  });

  describe('clearSyncLogsQuery', () => {
    it('执行 DELETE 语句', async () => {
      await clearSyncLogsQuery(db);
      expect(db.execute.mock.calls[0][0]).toContain('DELETE FROM sync_log');
    });
  });
});
