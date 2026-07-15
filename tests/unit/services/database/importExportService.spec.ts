import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryItem } from '@/config/types';
import { exportHistoryToJson, importHistoryFromJson } from '@/services/database/ImportExportService';
import { itemToRow } from '@/services/database/DataTransformer';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeHistoryItem(id: string, timestamp = 1000): HistoryItem {
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
    const onProgress = vi.fn();
    db.select
      .mockResolvedValueOnce([itemToRow(makeHistoryItem('item-0', 9999)), itemToRow(makeHistoryItem('item-1', 1))])
      .mockResolvedValueOnce([]);

    const importedCount = await importHistoryFromJson(db as never, JSON.stringify(items), 'merge', onProgress);

    expect(importedCount).toBe(599);
    expect(db.select).toHaveBeenCalledTimes(2);
    // merge 模式不触发事务和 DELETE，只做 INSERT OR REPLACE 批量
    const insertCalls = db.execute.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT OR REPLACE'));
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1]?.[0]).toBe('item-1');
    expect(onProgress).toHaveBeenNthCalledWith(1, 500, 599);
    expect(onProgress).toHaveBeenNthCalledWith(2, 599, 599);
    const sqlCalls = db.execute.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls.some((sql) => sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK'))).toBe(false);
  });

  it('replace mode inserts new rows first then deletes orphaned rows not in the imported set', async () => {
    // 模拟老库里有 3 条：keep / alpha / orphan，导入集只有 alpha
    db.select.mockResolvedValueOnce([
      { id: 'keep', timestamp: 1 },
      { id: 'alpha', timestamp: 1 },
      { id: 'orphan', timestamp: 1 },
    ]);

    const importedCount = await importHistoryFromJson(
      db as never,
      JSON.stringify([makeHistoryItem('alpha')]),
      'replace',
    );

    expect(importedCount).toBe(1);
    // 第一个 execute 必须是 INSERT OR REPLACE（不是 DELETE 优先，避免丢数据）
    const sqlCalls = db.execute.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls[0]).toMatch(/^INSERT OR REPLACE/);
    // 紧跟着的 DELETE 只删除 id NOT IN 导入集里的行
    const deleteCall = db.execute.mock.calls.find(([sql]) => String(sql).startsWith('DELETE'));
    expect(deleteCall).toBeDefined();
    const deleteParams = deleteCall?.[1] as string[];
    expect(deleteParams).toContain('keep');
    expect(deleteParams).toContain('orphan');
    expect(deleteParams).not.toContain('alpha');
    // 不再使用 BEGIN/COMMIT/ROLLBACK（连接池不支持）
    expect(sqlCalls.some((sql) => sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK'))).toBe(false);
  });

  it('imports same-timestamp records when only favorite metadata is newer', async () => {
    const existing = makeHistoryItem('fav-sync', 1000);
    existing.isFavorited = false;
    existing.favoriteUpdatedAt = 1000;
    existing.favoriteUpdatedBy = 'device-a';

    const incoming = makeHistoryItem('fav-sync', 1000);
    incoming.isFavorited = true;
    incoming.favoriteUpdatedAt = 2000;
    incoming.favoriteUpdatedBy = 'device-b';

    db.select.mockResolvedValueOnce([itemToRow(existing)]);

    const importedCount = await importHistoryFromJson(db as never, JSON.stringify([incoming]), 'merge');

    expect(importedCount).toBe(1);
    const insertParams = db.execute.mock.calls[0][1] as unknown[];
    expect(insertParams[18]).toBe(1);
    expect(insertParams[19]).toBe(2000);
    expect(insertParams[20]).toBe('device-b');
  });

  it('keeps local favorite metadata when cloud history content is newer but favorite is older', async () => {
    const existing = makeHistoryItem('mixed-sync', 1000);
    existing.isFavorited = true;
    existing.favoriteUpdatedAt = 3000;
    existing.favoriteUpdatedBy = 'device-local';

    const incoming = makeHistoryItem('mixed-sync', 2000);
    incoming.isFavorited = false;
    incoming.favoriteUpdatedAt = 1000;
    incoming.favoriteUpdatedBy = 'device-cloud';
    incoming.generatedLink = 'https://img.example.com/newer.png';

    db.select.mockResolvedValueOnce([itemToRow(existing)]);

    const importedCount = await importHistoryFromJson(db as never, JSON.stringify([incoming]), 'merge');

    expect(importedCount).toBe(1);
    const insertParams = db.execute.mock.calls[0][1] as unknown[];
    expect(insertParams[1]).toBe(2000);
    expect(insertParams[7]).toBe('https://img.example.com/newer.png');
    expect(insertParams[18]).toBe(1);
    expect(insertParams[19]).toBe(3000);
    expect(insertParams[20]).toBe('device-local');
  });

  it('does not let legacy cloud records without favorite metadata clear local favorites', async () => {
    const existing = makeHistoryItem('legacy-cloud', 2000);
    existing.isFavorited = true;
    existing.favoriteUpdatedAt = 2500;
    existing.favoriteUpdatedBy = 'device-local';

    const incoming = makeHistoryItem('legacy-cloud', 2000);
    incoming.isFavorited = false;
    delete incoming.favoriteUpdatedAt;
    delete incoming.favoriteUpdatedBy;

    db.select.mockResolvedValueOnce([itemToRow(existing)]);

    const importedCount = await importHistoryFromJson(db as never, JSON.stringify([incoming]), 'merge');

    expect(importedCount).toBe(0);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('replace mode preserves existing rows when insert fails mid-way', async () => {
    // 关键安全性质：INSERT 中途挂掉时，DELETE 不应执行，老数据不能丢
    db.execute.mockImplementation(async (sql: string) => {
      if (String(sql).startsWith('INSERT OR REPLACE')) {
        throw new Error('insert failed');
      }
    });

    await expect(importHistoryFromJson(
      db as never,
      JSON.stringify([makeHistoryItem('alpha')]),
      'replace',
    )).rejects.toThrow('insert failed');

    const sqlCalls = db.execute.mock.calls.map(([sql]) => String(sql));
    // 没有 DELETE 发生 = 老数据保留
    expect(sqlCalls.some((sql) => sql.startsWith('DELETE'))).toBe(false);
  });
});
