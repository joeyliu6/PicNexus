import { describe, expect, it } from 'vitest';
import { getHostUsageQuery } from '@/services/database/HostUsageQuery';

// 图床页「使用情况」跑在真的 SQLite 上：图床要从 successful_service_ids 这个 JSON 列里认，失效要读 link_check_status。
// node:sqlite 要 Node 22.5+，没有就整组跳过（同 galleryFilters.spec）。
const sqlite = await import('node:sqlite').catch(() => null);

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 16, 15, 0).getTime();

function open(rows: Array<{ id: string; at: number; primary: string; hosts: string[]; status?: Record<string, unknown> }>) {
  const raw = new sqlite!.DatabaseSync(':memory:');
  raw.exec('CREATE TABLE history_items (id TEXT PRIMARY KEY, timestamp INTEGER, primary_service TEXT, successful_service_ids TEXT, link_check_status TEXT)');
  const insert = raw.prepare('INSERT INTO history_items VALUES (?, ?, ?, ?, ?)');
  for (const r of rows) insert.run(r.id, r.at, r.primary, JSON.stringify(r.hosts), r.status ? JSON.stringify(r.status) : null);
  const toSqlite = (sql: string) => sql.replace(/\$(\d+)/g, '?$1');
  return { select: async (sql: string, params: unknown[] = []) => raw.prepare(toSqlite(sql)).all(...(params as (string | number)[])) };
}

describe.skipIf(!sqlite)('getHostUsageQuery', () => {
  it('counts uploads, first-done and dead copies for one host, and the last 14 days by local day', async () => {
    const startToday = new Date(2026, 9, 16).getTime();
    const db = open([
      { id: 'a', at: NOW, primary: 'r2', hosts: ['r2', 'jd'] },
      { id: 'b', at: startToday + 1, primary: 'jd', hosts: ['jd', 'r2'] },
      { id: 'c', at: startToday - 1, primary: 'r2', hosts: ['r2'], status: { r2: { isValid: false, errorType: 'http_4xx' } } },
      { id: 'd', at: NOW - 13 * DAY, primary: 'r2', hosts: ['r2'], status: { r2: { isValid: false, browserMightWork: true } } },
      { id: 'e', at: NOW - 14 * DAY - DAY, primary: 'r2', hosts: ['r2'], status: { r2: { isValid: false, errorType: 'pending' } } },
      { id: 'f', at: NOW, primary: 'jd', hosts: ['jd'] },
    ]);
    const usage = await getHostUsageQuery(db as never, 'r2', NOW);
    expect(usage).toMatchObject({ uploaded: 5, firstDone: 4, dead: 1 });
    expect(usage.last14).toHaveLength(14);
    expect(usage.last14[13]).toBe(2);
    expect(usage.last14[12]).toBe(1);
    expect(usage.last14[0]).toBe(1);
    expect(usage.last14.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('composite ids with a colon work as a plain value', async () => {
    const db = open([{ id: 'a', at: NOW, primary: 'webdav:nas', hosts: ['webdav:nas'], status: { 'webdav:nas': { isValid: false, errorType: 'timeout' } } }]);
    expect(await getHostUsageQuery(db as never, 'webdav:nas', NOW)).toMatchObject({ uploaded: 1, firstDone: 1, dead: 1 });
  });
});
