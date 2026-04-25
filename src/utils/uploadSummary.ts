import type { LinkFormat } from './linkFormatter';

export interface UploadFailedServiceSummary {
  serviceName: string;
  count: number;
}

export interface UploadSessionSummary {
  total: number;
  success: number;
  failed: number;
  partialServiceFailureCount?: number;
  partialFailedServices?: UploadFailedServiceSummary[];
  /** 因路径已在上传队列被静默丢弃的张数（同批次重复路径） */
  duplicatesSkipped?: number;
}

export interface UploadCopySummary {
  autoCopyEnabled: boolean;
  copiedCount: number;
  format: LinkFormat;
  copyFailed?: boolean;
}

export interface UploadSummaryToastPayload {
  severity: 'success' | 'warn' | 'error';
  summary: string;
  detail: string;
}

function hasPartialServiceFailures(summary: UploadSessionSummary): boolean {
  return (summary.partialServiceFailureCount ?? 0) > 0;
}

function formatFailedServices(summary: UploadSessionSummary): string {
  const failedServices = summary.partialFailedServices ?? [];
  if (failedServices.length === 0) return '';

  return failedServices
    .map(({ serviceName, count }) => count > 1 ? `${serviceName}（${count} 张）` : serviceName)
    .join('、');
}

function appendDuplicates(detail: string, summary: UploadSessionSummary): string {
  const skipped = summary.duplicatesSkipped ?? 0;
  if (skipped === 0) return detail;
  const suffix = `已忽略 ${skipped} 张重复文件。`;
  return detail ? `${detail}${suffix}` : suffix;
}

export function buildUploadSummaryToast(
  summary: UploadSessionSummary,
  copy: UploadCopySummary
): UploadSummaryToastPayload | null {
  // 没有真正入队的文件，但有重复被丢弃 → 单独提示，避免静默
  if (summary.total === 0) {
    const skipped = summary.duplicatesSkipped ?? 0;
    if (skipped > 0) {
      return {
        severity: 'warn',
        summary: '已忽略重复文件',
        detail: `${skipped} 张文件已在上传队列中，无需重复添加。`,
      };
    }
    return null;
  }

  // 全部失败：显示 error toast
  if (summary.success === 0) {
    return {
      severity: 'error',
      summary: '上传失败',
      detail: appendDuplicates('所有图片上传失败，请检查网络或图床配置。', summary),
    };
  }

  const partialServiceFailures = hasPartialServiceFailures(summary);
  // 有整张图失败 or 有图床部分失败 → warn
  const isWarn = summary.failed > 0 || partialServiceFailures;

  // 复制状态文案
  let copyDetail = '';
  if (copy.autoCopyEnabled) {
    if (copy.copyFailed) {
      copyDetail = '链接复制失败，请手动复制。';
    } else if (copy.copiedCount > 0) {
      if (!isWarn) {
        copyDetail = summary.success === 1 ? '链接已复制到剪贴板。' : '全部链接已复制。';
      } else {
        copyDetail = '成功的链接已复制。';
      }
    }
  }

  // 有重复被丢弃 → 即使全成功也升级为 warn，确保用户看到"少了几张"
  const hasDuplicates = (summary.duplicatesSkipped ?? 0) > 0;

  // 场景一：全部成功
  if (!isWarn) {
    const summaryText = summary.success === 1 ? '上传成功' : `${summary.success} 张图片上传完成`;
    return {
      severity: hasDuplicates ? 'warn' : 'success',
      summary: summaryText,
      detail: appendDuplicates(copyDetail, summary),
    };
  }

  // 场景二：有整张图失败（所有图床都挂了）
  if (summary.failed > 0) {
    const summaryText = `${summary.success} 张成功，${summary.failed} 张失败`;
    const parts = [copyDetail, '失败项可在队列中重试。'].filter(Boolean);
    return {
      severity: 'warn',
      summary: summaryText,
      detail: appendDuplicates(parts.join(''), summary),
    };
  }

  // 场景三：只有图床部分失败（图片都有主力链接，某些图床挂了）
  const failedServicesText = formatFailedServices(summary);
  const failedLabel = failedServicesText
    ? `${failedServicesText}上传失败`
    : `${summary.partialServiceFailureCount} 个图床任务失败`;

  const summaryText = summary.success === 1
    ? `上传完成，${failedLabel}`
    : `${summary.success} 张图片上传完成，${failedLabel}`;

  const parts = [copyDetail, '可在队列中对失败项重试。'].filter(Boolean);
  return {
    severity: 'warn',
    summary: summaryText,
    detail: appendDuplicates(parts.join(''), summary),
  };
}
