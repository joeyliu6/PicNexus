/**
 * 向后兼容的重新导出文件
 *
 * 原 HistoryDatabase.ts 已拆分到 src/services/database/ 目录
 * 本文件保持原有导入路径不变，避免修改所有消费者
 */

export {
  historyDB,
  HistoryDatabase,
  type LinkCheckLiteRow,
  type PageOptions,
  type PageResult,
  type SearchOptions,
  type SearchResult,
  type TimePeriodStats,
  type FavoritesMetaPageOptions,
  type FavoritesMetaPageResult,
  type SyncLogOperation,
  type SyncLogEntry,
} from './database/HistoryDatabase';
