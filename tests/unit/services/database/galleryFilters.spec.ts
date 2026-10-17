import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  getDayAspectRatiosByRangeQuery, getDayStatsQuery, getIdsQuery, getItemsByDayRangeQuery, getListPageQuery,
} from '@/services/database/TimelineQueryService';
import type { DayStatsFilter } from '@/services/database/types';
import { layoutRatio } from '@/utils/imageDisplay';

// 图库的筛选（交接说明 8.2：图床 / 收藏 / 状态 / 时间）直接跑在真的 SQLite 上：
// 状态要从 link_check_status 这个 JSON 列里取「复制时使用」那个图床的检测结果，只比 SQL 文本验证不了。
// node:sqlite 要 Node 22.5+：本机与 pre-push 门禁都会跑；Node 20 的 CI 上没有这个模块，整组跳过。
const sqlite = await import('node:sqlite').catch(() => null);

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 16, 2, 0);

interface Row {
  id: string;
  daysAgo: number;
  primary: string;
  hosts: string[];
  status?: Record<string, { isValid: boolean; browserMightWork?: boolean; errorType?: string }>;
}

const ROWS: Row[] = [
  { id: 'ok', daysAgo: 0, primary: 'jd', hosts: ['jd', 'r2'], status: { jd: { isValid: true }, r2: { isValid: true } } },
  { id: 'dead', daysAgo: 1, primary: 'weibo', hosts: ['weibo', 'jd'], status: { weibo: { isValid: false, errorType: 'http_4xx' }, jd: { isValid: true } } },
  { id: 'limited', daysAgo: 2, primary: 'weibo', hosts: ['weibo'], status: { weibo: { isValid: false, browserMightWork: true, errorType: 'http_4xx' } } },
  { id: 'unchecked', daysAgo: 3, primary: 'jd', hosts: ['jd'] },
  { id: 'pending', daysAgo: 4, primary: 'jd', hosts: ['jd', 'weibo'], status: { jd: { isValid: false, errorType: 'pending' } } },
  { id: 'nas-dead', daysAgo: 40, primary: 'webdav:nas', hosts: ['webdav:nas'], status: { 'webdav:nas': { isValid: false, errorType: 'timeout' } } },
];

function sqliteAdapter(db: DatabaseSync) {
  // 应用里的 tauri-plugin-sql 用 $1 $2 占位；SQLite 的编号占位写作 ?1 ?2
  const toSqlite = (sql: string) => sql.replace(/\$(\d+)/g, '?$1');
  return {
    select: async (sql: string, params: unknown[] = []) => db.prepare(toSqlite(sql)).all(...(params as (string | number)[])),
    execute: async () => ({ rowsAffected: 0 }),
  };
}

let db: ReturnType<typeof sqliteAdapter>;
let raw: DatabaseSync;

beforeEach(() => {
  raw = new sqlite!.DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE history_items (
    id TEXT PRIMARY KEY, timestamp INTEGER, local_file_name TEXT, local_file_name_lower TEXT,
    aspect_ratio REAL, primary_service TEXT, generated_link TEXT, results TEXT, is_favorited INTEGER,
    link_check_status TEXT, success_count INTEGER, successful_service_ids TEXT,
    width INTEGER, height INTEGER, file_size INTEGER, format TEXT
  )`);
  const insert = raw.prepare("INSERT INTO history_items VALUES (?, ?, ?, ?, 1.5, ?, ?, ?, 0, ?, ?, ?, 1200, 800, ?, 'png')");
  for (const [index, row] of ROWS.entries()) {
    const results = row.hosts.map((serviceId) => ({ serviceId, status: 'success', result: { serviceId, fileKey: row.id, url: `https://${serviceId}.example/${row.id}.png` } }));
    insert.run(
      row.id, NOW - row.daysAgo * DAY, `${row.id}.png`, `${row.id}.png`, row.primary, `https://${row.primary}.example/${row.id}.png`,
      JSON.stringify(results), row.status ? JSON.stringify(row.status) : null, row.hosts.length, JSON.stringify(row.hosts),
      (index + 1) * 1000,
    );
  }
  db = sqliteAdapter(raw);
});

async function ids(filter: DayStatsFilter): Promise<string[]> {
  const metas = await getItemsByDayRangeQuery(db as never, 0, NOW + DAY, filter);
  return metas.map((meta) => meta.id);
}

describe.skipIf(!sqlite)('gallery filters on the real SQLite', () => {
  it('tells each image how its copy link is doing', async () => {
    const metas = await getItemsByDayRangeQuery(db as never, 0, NOW + DAY, {});
    expect(Object.fromEntries(metas.map((meta) => [meta.id, meta.copyLinkHealth]))).toEqual({
      ok: 'ok', dead: 'dead', limited: 'limited', unchecked: 'unchecked', pending: 'unchecked', 'nas-dead': 'dead',
    });
  });

  it('filters by the copy link status, any of the picked ones', async () => {
    expect(await ids({ statusFilter: ['dead'] })).toEqual(['dead', 'nas-dead']);
    expect(await ids({ statusFilter: ['dead', 'limited'] })).toEqual(['dead', 'limited', 'nas-dead']);
    expect(await ids({ statusFilter: ['unchecked'] })).toEqual(['unchecked', 'pending']);
  });

  it('treats 仅 1 份 as one working copy', async () => {
    expect(await ids({ statusFilter: ['single'] })).toEqual(['limited', 'unchecked', 'nas-dead']);
  });

  it('filters by a host that holds a copy, not only the copy source', async () => {
    expect(await ids({ hostFilter: 'jd' })).toEqual(['ok', 'dead', 'unchecked', 'pending']);
    expect(await ids({ hostFilter: 'webdav:nas' })).toEqual(['nas-dead']);
  });

  it('keeps only images uploaded since the given time', async () => {
    expect(await ids({ since: NOW - 7 * DAY })).toEqual(['ok', 'dead', 'limited', 'unchecked', 'pending']);
  });

  it('applies the same filters to the per-day counts', async () => {
    const days = await getDayStatsQuery(db as never, { statusFilter: ['dead'], since: NOW - 7 * DAY });
    expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(1);
  });
});

// 列表视图（交接说明 8.2：点表头排序、行高 54、虚拟滚动）：同一套筛选，一次取一页
describe.skipIf(!sqlite)('gallery list pages on the real SQLite', () => {
  const page = async (sort: { key: 'time' | 'name' | 'size'; descending: boolean }, offset = 0, limit = 10, filter: DayStatsFilter = {}) =>
    (await getListPageQuery(db as never, filter, sort, offset, limit)).map((row) => row.id);

  it('sorts by upload time, file name or size', async () => {
    expect(await page({ key: 'time', descending: true })).toEqual(['ok', 'dead', 'limited', 'unchecked', 'pending', 'nas-dead']);
    expect(await page({ key: 'time', descending: false })).toEqual(['nas-dead', 'pending', 'unchecked', 'limited', 'dead', 'ok']);
    expect(await page({ key: 'name', descending: false })).toEqual(['dead', 'limited', 'nas-dead', 'ok', 'pending', 'unchecked']);
    expect(await page({ key: 'size', descending: true }, 0, 2)).toEqual(['nas-dead', 'pending']);
  });

  it('pages through the filtered result', async () => {
    expect(await page({ key: 'time', descending: true }, 2, 2, { hostFilter: 'jd' })).toEqual(['unchecked', 'pending']);
  });

  it('carries the size and dimensions the list shows', async () => {
    const [row] = await getListPageQuery(db as never, {}, { key: 'time', descending: true }, 0, 1);
    expect(row).toMatchObject({ id: 'ok', width: 1200, height: 800, fileSize: 1000, copyLinkHealth: 'ok' });
  });
});

// G04「Ctrl/⌘ A 全选当前结果」：结果里所有的图，不只是已经加载出来的那几天
describe.skipIf(!sqlite)('selecting every result on the real SQLite', () => {
  it('lists the ids of every image the filters keep, newest first', async () => {
    expect(await getIdsQuery(db as never, {})).toEqual(['ok', 'dead', 'limited', 'unchecked', 'pending', 'nas-dead']);
    expect(await getIdsQuery(db as never, { statusFilter: ['dead'] })).toEqual(['dead', 'nas-dead']);
  });
});

// G13：长图、全景、小图按格子的比例排。骨架天（还没加载的那几天）的估算高度要与真图排出来的一致，
// 否则图片一加载格子就跳：按天汇总的 SQL 与 layoutRatio 在这里对照
describe.skipIf(!sqlite)('picture shapes on the real SQLite', () => {
  const SHAPES = [
    { id: 'shot', w: 1080, h: 6048, format: 'png' },
    { id: 'pano', w: 6000, h: 1000, format: 'jpg' },
    { id: 'icon', w: 48, h: 48, format: 'gif' },
    { id: 'badge', w: 90, h: 20, format: 'svg' },
    { id: 'photo', w: 4032, h: 3024, format: 'jpg' },
    { id: 'legacy', w: 0, h: 0, format: null },
  ];
  const AT = NOW - 100 * DAY;
  const range = [AT - DAY, AT] as const;

  beforeEach(() => {
    const insert = raw.prepare(`INSERT INTO history_items
      (id, timestamp, local_file_name, local_file_name_lower, aspect_ratio, primary_service, generated_link, results,
       is_favorited, success_count, successful_service_ids, width, height, file_size, format)
      VALUES (?, ?, ?, ?, ?, 'jd', '', '[]', 0, 1, '["jd"]', ?, ?, 1, ?)`);
    SHAPES.forEach((shape, i) => {
      const name = `${shape.id}.${shape.format ?? 'png'}`;
      insert.run(shape.id, AT - i, name, name, shape.h ? shape.w / shape.h : 0, shape.w, shape.h, shape.format);
    });
  });

  it('carries the size and format a cell is drawn with', async () => {
    const metas = await getItemsByDayRangeQuery(db as never, ...range, {});
    expect(metas.find((meta) => meta.id === 'icon')).toMatchObject({ width: 48, height: 48, format: 'gif' });
  });

  it('lays a day out with the same cell ratios before and after its pictures load', async () => {
    const metas = await getItemsByDayRangeQuery(db as never, ...range, {});
    const cells = metas.map(layoutRatio);
    expect(cells).toEqual([0.4, 4, 1, 1, 4032 / 3024, 1]);
    expect((await getDayAspectRatiosByRangeQuery(db as never, ...range, {})).map((row) => row.aspectRatio)).toEqual(cells);
    const day = (await getDayStatsQuery(db as never, {})).find((stats) => stats.count === SHAPES.length);
    expect(day?.aspectRatioSum).toBeCloseTo(cells.reduce((sum, ratio) => sum + ratio, 0), 9);
  });
});
