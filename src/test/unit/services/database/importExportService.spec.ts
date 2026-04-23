import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportHistoryToJson, importHistoryFromJson } from '../../../../services/database/ImportExportService';

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeHistoryItem(id: string, timestamp = 1000) {
  return {
    id,
    timestamp,
    localFileName: `${id}.png`,
    filePath: `/tmp/${id}.png`,
    primaryService: 'weibo',
    results: [
      {
        serviceId: 'weibo',
        status: 'success' as const,
        result: {
          serviceId: 'weibo',
          fileKey: `${id}-key`,
          url: `https://img.example.com/${id}.png`,
          width: 100,
          height: 80,
          size: 12,
        },
      },
    ],
    generatedLink: `https://img.example.com/${id}.png`,
    width: 100,
    height: 80,
    aspectRatio: 1.25,
    fileSize: 12,
    format: 'png',
  };
}

function makeDb() {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue([]),
  };
}

describe('ImportExportService', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
  });

  it('exports all streamed history batches into a formatted JSON array', async () => {
    async function* streamSource() {
      yield [makeHistoryItem('alpha')];
      yield [makeHistoryItem('beta')];
    }

    const json = await exportHistoryToJson(streamSource);
    const parsed = JSON.parse(json) as Array<{ id: string }>;

    expect(parsed.map(item => item.id)).toEqual(['alpha', 'beta']);
  });

  it('throws when the imported payload is not a JSON array', async () => {
    await expect(importHistoryFromJson(db as never, JSON.stringify({ nope: true }), 'replace'))
      .rejects.toThrow('无效的 JSON 格式');
  });

  it('throws when every parsed record is invalid for PicNexus history import', async () => {
    await expect(importHistoryFromJson(db as never, JSON.stringify([{ foo: 'bar' }]), 'merge'))
      .rejects.toThrow('导入数据格式不匹配');
  });

  it('imports only newer records during merge and reports progress by batch', async () => {
    const items = Array.from({ length: 600 }, (_, index) => makeHistoryItem(`item-${index}`, index + 1));
    db.select.mockResolvedValueOnce([
      { id: 'item-0', timestamp: 9999 },
      { id: 'item-1', timestamp: 1 },
    ]);
    const onProgress = vi.fn();

    const importedCount = await importHistoryFromJson(
      db as never,
      JSON.stringify(items),
      'merge',
      onProgress,
    );

    expect(importedCount).toBe(599);
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(db.execute).toHaveBeenNthCalledWith(1, 'BEGIN TRANSACTION');
    const insertCalls = db.execute.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT OR REPLACE'));
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1]?.[0]).toBe('item-1');
    expect(onProgress).toHaveBeenNthCalledWith(1, 500, 599);
    expect(onProgress).toHaveBeenNthCalledWith(2, 599, 599);
    expect(db.execute).toHaveBeenLastCalledWith('COMMIT');
  });

  it('deletes existing rows first when replace mode is used', async () => {
    const importedCount = await importHistoryFromJson(
      db as never,
      JSON.stringify([makeHistoryItem('alpha')]),
      'replace',
    );

    expect(importedCount).toBe(1);
    expect(db.execute).toHaveBeenNthCalledWith(1, 'BEGIN TRANSACTION');
    expect(db.execute).toHaveBeenNthCalledWith(2, 'DELETE FROM history_items');
    expect(db.execute).toHaveBeenLastCalledWith('COMMIT');
  });

  it('rolls back the transaction when batch upsert fails', async () => {
    db.execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT OR REPLACE')) {
        throw new Error('insert failed');
      }
    });

    await expect(importHistoryFromJson(
      db as never,
      JSON.stringify([makeHistoryItem('alpha')]),
      'replace',
    )).rejects.toThrow('insert failed');

    expect(db.execute).toHaveBeenNthCalledWith(1, 'BEGIN TRANSACTION');
    expect(db.execute).toHaveBeenCalledWith('ROLLBACK');
  });
});
