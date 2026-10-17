// 补充备份：后台逐张传到目标图床，暂停时没开始的不再取、正在下载的放回队首，停止后不再做；结束有失败报第一条原因
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryItem } from '@/config/types';
import type { MigrateItemStatus } from '@/types/batchMigrate';

const m = vi.hoisted(() => ({
  migrateOneItem: vi.fn(),
  getById: vi.fn(),
  notify: vi.fn().mockResolvedValue(undefined),
  toastError: vi.fn(),
}));

vi.mock('@/composables/batch-migrate/migrateCore', () => ({ migrateOneItem: m.migrateOneItem }));
vi.mock('@/composables/batch-migrate/historyRefresh', () => ({ notifyMigrationPersisted: m.notify }));
vi.mock('@/services/database', () => ({ historyDB: { getById: m.getById } }));
vi.mock('@/core/MultiServiceUploader', () => ({ MultiServiceUploader: class {} }));
vi.mock('@/composables/useConfig', () => ({ useConfigManager: () => ({ loadConfig: async () => ({}) }) }));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ error: m.toastError }) }));
vi.mock('@/constants/serviceNames', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/constants/serviceNames')>()),
  getServiceDisplayName: (id: string) => ({ r2: 'Cloudflare R2' } as Record<string, string>)[id] ?? id,
}));

import { __resetSupplementBackupForTests, useSupplementBackup } from '@/views/health/useSupplementBackup';

const item = (id: string): HistoryItem => ({
  id, timestamp: 0, localFileName: `${id}.png`, primaryService: 'jd', generatedLink: '',
  results: [{ serviceId: 'jd', status: 'success', result: { serviceId: 'jd', fileKey: id, url: `https://jd.example/${id}.png` } }],
});

describe('useSupplementBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSupplementBackupForTests();
    m.getById.mockImplementation(async (id: string) => item(id));
    m.migrateOneItem.mockImplementation(async (_item: HistoryItem, status: MigrateItemStatus) => { status.status = 'success'; });
  });

  it('逐张传到目标图床，完成后卡片「已完成」，成功的广播一次让视图重查', async () => {
    const backup = useSupplementBackup();
    await backup.start('r2', ['a', 'b', 'c', 'd']);
    expect(m.migrateOneItem).toHaveBeenCalledTimes(4);
    expect(m.migrateOneItem.mock.calls[0][2]).toEqual(['r2']);
    expect(backup.state).toMatchObject({ phase: 'done', processed: 4, total: 4 });
    expect(m.notify.mock.calls.flatMap((c) => c[0]).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(m.toastError).not.toHaveBeenCalled();
  });

  it('有失败：结束时一条红色通知，写第一条原因 + 处理办法；「重试」只重传失败的', async () => {
    m.migrateOneItem.mockImplementation(async (it: HistoryItem, status: MigrateItemStatus) => {
      if (it.id === 'b') { status.status = 'failed'; status.error = 'timeout'; } else status.status = 'success';
    });
    const backup = useSupplementBackup();
    await backup.start('r2', ['a', 'b']);
    expect(backup.state.failed).toEqual([{ id: 'b', reason: 'timeout' }]);
    expect(m.toastError).toHaveBeenCalledWith('1 张未能备份到 Cloudflare R2', expect.stringContaining('，'));

    m.migrateOneItem.mockClear();
    await backup.retryFailed();
    expect(m.migrateOneItem.mock.calls.map((c) => (c[0] as HistoryItem).id)).toEqual(['b']);
  });

  it('暂停：没开始的不再取；正在下载、被退回 pending 的放回队首，继续后重来', async () => {
    const backup = useSupplementBackup();
    const seen: string[] = [];
    m.migrateOneItem.mockImplementation(async (it: HistoryItem, status: MigrateItemStatus) => {
      seen.push(it.id);
      if (it.id === 'a' && seen.filter((x) => x === 'a').length === 1) {
        backup.pause();
        return; // 暂停时正在下载：保持 pending
      }
      status.status = 'success';
    });
    const run = backup.start('r2', ['a']);
    await vi.waitFor(() => expect(backup.state.phase).toBe('paused'));
    expect(backup.state.processed).toBe(0);

    backup.resume();
    await run;
    expect(seen).toEqual(['a', 'a']);
    expect(backup.state).toMatchObject({ phase: 'done', processed: 1 });
  });

  it('停止：剩下的不再做，回到空闲', async () => {
    const backup = useSupplementBackup();
    m.migrateOneItem.mockImplementation(async (it: HistoryItem, status: MigrateItemStatus) => {
      status.status = 'success';
      if (it.id === 'a') backup.stop();
    });
    await backup.start('r2', ['a', 'b', 'c', 'd', 'e', 'f']);
    expect(m.migrateOneItem.mock.calls.length).toBeLessThan(6);
    expect(backup.state.phase).toBe('idle');
  });

  it('进行中再点开始不另起一轮', async () => {
    const backup = useSupplementBackup();
    let release!: () => void;
    m.migrateOneItem.mockImplementationOnce((_it: HistoryItem, status: MigrateItemStatus) => new Promise<void>((resolve) => { release = () => { status.status = 'success'; resolve(); }; }));
    const run = backup.start('r2', ['a']);
    await vi.waitFor(() => expect(m.migrateOneItem).toHaveBeenCalled());
    await backup.start('r2', ['x']);
    release();
    await run;
    expect(m.migrateOneItem).toHaveBeenCalledTimes(1);
  });
});
