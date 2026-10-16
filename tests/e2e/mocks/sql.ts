import { getState } from './state';

const HISTORY_COLUMNS = [
  'id',
  'timestamp',
  'local_file_name',
  'local_file_name_lower',
  'file_path',
  'primary_service',
  'results',
  'generated_link',
  'link_check_status',
  'link_check_summary',
  'width',
  'height',
  'aspect_ratio',
  'file_size',
  'format',
  'color_type',
  'has_alpha',
  'is_favorited',
  'favorite_updated_at',
  'favorite_updated_by',
  'success_count',
  'successful_service_ids',
  'migration_skip',
  'link_check_skip',
];

export default class Database {
  static async load(_path: string): Promise<Database> {
    return new Database();
  }

  async close(): Promise<void> {}

  async execute(): Promise<{ rowsAffected: number; lastInsertId?: number }> {
    return { rowsAffected: 1 };
  }

  async select<T = unknown[]>(query: string, bindValues: unknown[] = []): Promise<T> {
    const rows = getState().historyRows;
    if (/SELECT 1 as v/i.test(query)) {
      return [{ v: 1 }] as T;
    }
    if (/PRAGMA table_info\(history_items\)/i.test(query)) {
      return HISTORY_COLUMNS.map((name) => ({ name })) as T;
    }
    // 分页 / 文件名搜索（HistoryDatabase.queryWithTotal）：末尾两个参数是 LIMIT、OFFSET
    if (/COUNT\(\*\) OVER\(\) as _total FROM history_items/i.test(query)) {
      let matched = [...rows].sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
      if (/local_file_name_lower LIKE \$1/i.test(query)) {
        const keyword = String(bindValues[0] ?? '').replace(/^%|%$/g, '');
        matched = matched.filter((row) => String(row.local_file_name_lower).includes(keyword));
      }
      const limit = Number(bindValues[bindValues.length - 2] ?? matched.length);
      const offset = Number(bindValues[bindValues.length - 1] ?? 0);
      return matched.slice(offset, offset + limit).map((row) => ({ ...row, _total: matched.length })) as T;
    }
    if (/COUNT\(DISTINCT primary_service\)/i.test(query)) {
      return [{ total: rows.length, services: new Set(rows.map((row) => row.primary_service)).size, lastAt: null }] as T;
    }
    if (/strftime\('%Y'|GROUP BY year|SUM\(COALESCE\(aspect_ratio/i.test(query)) {
      return [] as T;
    }
    if (/COUNT\(\*\) as count/i.test(query) || /COUNT\(\*\) AS count/i.test(query)) {
      return [{ count: rows.length }] as T;
    }
    if (/getFavoriteCount/i.test(query)) {
      return [{ count: 0 }] as T;
    }
    return [] as T;
  }
}
