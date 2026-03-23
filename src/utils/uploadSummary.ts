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

export function buildUploadSummaryToast(
  summary: UploadSessionSummary,
  copy: UploadCopySummary
): UploadSummaryToastPayload | null {
  if (summary.total === 0) return null;

  // 全部失败：显示 error toast
  if (summary.success === 0) {
    return {
      severity: 'error',
      summary: '上传失败',
      detail: '所有图片上传失败，请检查网络或图床配置',
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

  // 场景一：全部成功
  if (!isWarn) {
    const summaryText = summary.success === 1 ? '上传成功' : `${summary.success} 张图片上传完成`;
    return {
      severity: 'success',
      summary: summaryText,
      detail: copyDetail,
    };
  }

  // 场景二：有整张图失败（所有图床都挂了）
  if (summary.failed > 0) {
    const summaryText = `${summary.success} 张成功，${summary.failed} 张失败`;
    const parts = [copyDetail, '失败项可在队列中重试。'].filter(Boolean);
    return {
      severity: 'warn',
      summary: summaryText,
      detail: parts.join(''),
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
    detail: parts.join(''),
  };
}
