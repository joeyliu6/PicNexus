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

  async select<T = unknown[]>(query: string): Promise<T> {
    if (/SELECT 1 as v/i.test(query)) {
      return [{ v: 1 }] as T;
    }
    if (/PRAGMA table_info\(history_items\)/i.test(query)) {
      return HISTORY_COLUMNS.map((name) => ({ name })) as T;
    }
    if (/COUNT\(DISTINCT primary_service\)/i.test(query)) {
      return [{ total: 0, services: 0, lastAt: null }] as T;
    }
    if (/strftime\('%Y'|GROUP BY year|SUM\(COALESCE\(aspect_ratio/i.test(query)) {
      return [] as T;
    }
    if (/COUNT\(\*\) as count/i.test(query) || /COUNT\(\*\) AS count/i.test(query)) {
      return [{ count: 0 }] as T;
    }
    if (/getFavoriteCount/i.test(query)) {
      return [{ count: 0 }] as T;
    }
    return [] as T;
  }
}
