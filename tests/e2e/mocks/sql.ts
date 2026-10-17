// @tauri-apps/plugin-sql 的替身：浏览器里跑一份真的 SQLite（sql.js，WebAssembly），
// 表结构用应用自己的 SchemaManager 建，再放进 seed 的 historyRows。
// 图库按天分组、筛选、列表排序都靠真 SQL（json_extract / json_each / strftime localtime），
// 用正则模拟只会越补越偏；sql.js 在浏览器里跑，不依赖 Node 版本（CI 是 Node 20）。
import initSqlJs, { type Database as SqlJsDatabase, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { createTablesAndIndexes, runMigrations } from '@/services/database/SchemaManager';
import { getState } from './state';

type Bind = unknown[];

/** 应用里的占位写作 $1 $2；SQLite 的编号占位是 ?1 ?2，按位置绑定数组 */
const toSqlite = (sql: string) => sql.replace(/\$(\d+)/g, '?$1');

const bindable = (values: Bind): SqlValue[] => values.map((value) => {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as SqlValue;
});

let shared: Promise<SqlJsDatabase> | null = null;

async function open(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const raw = new SQL.Database();
  const adapter = new Database(raw);
  await createTablesAndIndexes(adapter as never);
  await runMigrations(adapter as never);
  for (const row of getState().historyRows) {
    const columns = Object.keys(row);
    raw.run(
      `INSERT INTO history_items (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      bindable(columns.map((column) => row[column])),
    );
  }
  return raw;
}

export default class Database {
  constructor(private readonly raw: SqlJsDatabase) {}

  static async load(_path: string): Promise<Database> {
    shared ??= open();
    return new Database(await shared);
  }

  async close(): Promise<void> {}

  async execute(query: string, bindValues: Bind = []): Promise<{ rowsAffected: number; lastInsertId?: number }> {
    this.raw.run(toSqlite(query), bindable(bindValues));
    return { rowsAffected: this.raw.getRowsModified() };
  }

  async select<T = unknown[]>(query: string, bindValues: Bind = []): Promise<T> {
    const seed = globalThis.__PICNEXUS_E2E_SEED__;
    if (seed?.sqlHangDayStats && /GROUP BY year/.test(query)) return new Promise<T>(() => {});
    if (seed?.sqlHangFor && bindValues.includes(seed.sqlHangFor)) return new Promise<T>(() => {});
    const statement = this.raw.prepare(toSqlite(query));
    try {
      statement.bind(bindable(bindValues));
      const rows: Record<string, SqlValue>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows as T;
    } finally {
      statement.free();
    }
  }
}
