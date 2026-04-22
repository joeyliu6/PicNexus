/**
 * 批量迁移 · 错误展示文案派生
 *
 * 迁移失败/跳过项的展示文案派生：大类标签、类别摘要、原始错误 tooltip。MigrateItemRow 与导出逻辑共用。
 * - errorTypeLabel: 下载/上传 短标签
 * - primaryReason: 合并去重后的友好大类文案（"网络中断 / 权限不足"）
 * - errorTooltipText: 多目标分行的原始技术错误（给复制/反馈用）
 */
import { getServiceDisplayName } from '../../../../../constants/serviceNames';
import { categorizeMigrateError } from '../../../../../utils/uploadFailureMessage';
import type { MigrateFailureDetail } from '../../../../../types/batchMigrate';

export interface ErrorPresentable {
  error?: string;
  errorType?: 'download' | 'upload';
  details?: MigrateFailureDetail[];
}

export function errorTypeLabel(errorType?: 'download' | 'upload'): string {
  return errorType === 'download' ? '下载' : '上传';
}

function ensureDetails(item: ErrorPresentable): MigrateFailureDetail[] {
  if (item.details && item.details.length > 0) return item.details;
  return [{ message: item.error ?? '' }];
}

/**
 * 合并所有 detail 的友好大类（多目标同问题只显示一次），用 " / " 连接。
 * 无任何错误原文时返回空串。
 */
export function primaryReason(item: ErrorPresentable): string {
  const details = ensureDetails(item);
  const categories = new Set<string>();
  for (const d of details) {
    const { category } = categorizeMigrateError(item.errorType, d.message);
    categories.add(category);
  }
  return Array.from(categories).join(' / ');
}

/**
 * tooltip：每个目标图床一行原始错误文本
 * - 有 serviceId → `图床名 · 原始消息`
 * - 无 serviceId（下载/元数据失败）→ 仅消息
 */
export function errorTooltipText(item: ErrorPresentable): string {
  const details = ensureDetails(item);
  return details
    .map(d => d.serviceId ? `${getServiceDisplayName(d.serviceId)} · ${d.message}` : d.message)
    .join('\n');
}
