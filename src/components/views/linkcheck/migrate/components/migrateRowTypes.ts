import type { MigrateFailureDetail, MigrateItemStatus } from '../../../../../types/batchMigrate';

/** DoneRow 旧签名的兼容型——让导出/终态快照仍然可以传入不是完整 MigrateItemStatus 的对象 */
export interface MigrateRowItem {
  historyId?: string;
  fileName: string;
  sourceUrl?: string;
  status: MigrateItemStatus['status'];
  errorType?: 'download' | 'upload';
  convertedFormat?: string;
  error?: string;
  details?: MigrateFailureDetail[];
  existingServiceIds?: string[];
  serviceResults?: Record<string, 'pending' | 'success' | 'failed'>;
}
