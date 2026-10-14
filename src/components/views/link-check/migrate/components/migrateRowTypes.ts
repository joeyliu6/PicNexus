import type { MigrateFailureDetail, MigrateItemStatus } from '@/types/batchMigrate';

/** DoneRow 旧签名的兼容型——让导出/终态快照仍然可以传入不是完整 MigrateItemStatus 的对象 */
export interface MigrateRowItem {
  historyId?: string;
  fileName: string;
  sourceUrl?: string;
  /** sourceUrl 来自哪个图床：缩略图要按图床取小尺寸，不传就会拉原图 */
  sourceServiceId?: string;
  status: MigrateItemStatus['status'];
  errorType?: 'download' | 'upload';
  convertedFormat?: string;
  error?: string;
  details?: MigrateFailureDetail[];
  existingServiceIds?: string[];
  serviceResults?: Record<string, 'pending' | 'success' | 'failed'>;
}
