/**
 * 回归测试：落库前重读只防「删除复活」，新增方向同目标不再重复追加
 *
 * 缺陷（/scan-bugs 2026-08-24 发现 3）：预加载快照（分钟级前取的 item）在某目标缺失，而
 * 处理窗口内 DB 已被别处（灯箱手动 / 同步合并）补上该目标 → needUploadTargets 按快照仍含它，
 * 会对该目标再传一次，并在 results 里出现同 serviceId 两条、success_count 虚增。
 *
 * 3.2 的「落库前重读」只按删除方向合并；本修法在合并时按「base 已含该目标成功镜像」去重，
 * 丢弃本次重复追加（base 中只有失败记录的目标仍允许本次补上成功结果）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { migrateOneItem } from '@/composables/batchMigrate/migrateCore';
import { historyDB } from '@/services/database';
import type { MigrateItemStatus } from '@/types/batchMigrate';
import type { HistoryItem, UserConfig } from '@/config/types';
import { getInvokeMock } from '../../helpers/tauriMock';

vi.mock('@/services/database', () => ({
  historyDB: { update: vi.fn(), getById: vi.fn() },
}));

function uploadResult(serviceId: string) {
  return { serviceId, fileKey: `${serviceId}-key`, url: `https://${serviceId}/x.png` };
}
function createItem(id = 'h1', results: HistoryItem['results']): HistoryItem {
  return { id, timestamp: 123, localFileName: 'a.png', primaryService: results[0]?.serviceId ?? 'x', results } as HistoryItem;
}
function createStatus(): MigrateItemStatus {
  return {
    historyId: 'h1', fileName: 'a.png', status: 'pending', serviceResults: { r2: 'pending' }, existingServiceIds: ['source'],
  };
}
const uploader = () => ({ retryUpload: vi.fn(async () => ({ url: 'https://cdn.r2/b.png' })) });

describe('base 重读的新增同目标竞态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInvokeMock().mockReset();
    getInvokeMock().mockResolvedValue({ file_path: '/tmp/a.png', content_type: 'image/png', file_size: 512 });
  });

  it('stale 快照缺 r2、base 已补上 r2 时，不再把 r2 重复追加进 results', async () => {
    // 预加载时拍的陈旧快照：只有 source
    const stale = createItem('h1', [
      { serviceId: 'source', status: 'success', result: uploadResult('source') },
    ]);
    // 处理窗口内用户在灯箱 / 同步里已把 r2 补上
    vi.mocked(historyDB.getById).mockResolvedValue(createItem('h1', [
      { serviceId: 'source', status: 'success', result: uploadResult('source') },
      { serviceId: 'r2', status: 'success', result: uploadResult('r2') },
    ]));
    const status = createStatus();
    const up = uploader();

    await migrateOneItem(
      stale, status, ['r2'], {} as UserConfig, up as any,
      ref(false), ref(false), ref({ startTime: 0, elapsedMs: 0, processedCount: 0, totalCount: 0, totalBytes: 0 }),
    );

    const written = vi.mocked(historyDB.update).mock.calls[0]?.[1]?.results as HistoryItem['results'];
    const r2Count = written?.filter(r => r.serviceId === 'r2').length ?? 0;
    expect(r2Count).toBe(1); // 修复前为 2（base 一条 + 本次一条）
    expect(written?.map(r => r.serviceId)).toEqual(['source', 'r2']);
  });

  it('base 中某目标只有失败记录时，本次成功结果仍允许写入', async () => {
    // base 里 r2 是历史失败（无成功镜像）→ 不触发去重，本次重新上传成功应写入
    vi.mocked(historyDB.getById).mockResolvedValue(createItem('h1', [
      { serviceId: 'source', status: 'success', result: uploadResult('source') },
      { serviceId: 'r2', status: 'failed' },
    ]));
    const status = createStatus();
    const up = uploader();

    await migrateOneItem(
      createItem('h1', [
        { serviceId: 'source', status: 'success', result: uploadResult('source') },
      ]),
      status, ['r2'], {} as UserConfig, up as any,
      ref(false), ref(false), ref({ startTime: 0, elapsedMs: 0, processedCount: 0, totalCount: 0, totalBytes: 0 }),
    );

    const written = vi.mocked(historyDB.update).mock.calls[0]?.[1]?.results as HistoryItem['results'];
    expect(written?.filter(r => r.serviceId === 'r2' && r.status === 'success').length).toBe(1);
  });
});