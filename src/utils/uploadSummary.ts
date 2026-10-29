import type { LinkFormat } from './linkFormatter';

export interface UploadFailedServiceSummary {
  serviceName: string;
  count: number;
}

/** 第一张整张失败的图：通知照它写「原因 + 处理办法」（交接说明第 9 节，与首页卡片、重试通知同一套说法） */
export interface UploadFailureNote {
  fileName: string;
  reason: string;
  advice: string;
}

export interface UploadSessionSummary {
  total: number;
  success: number;
  failed: number;
  partialServiceFailureCount?: number;
  partialFailedServices?: UploadFailedServiceSummary[];
  /** 因路径已在上传队列被静默丢弃的张数（同批次重复路径） */
  duplicatesSkipped?: number;
  firstFailure?: UploadFailureNote;
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

/** 几句话接成一段：没以句号收尾的补上「。」 */
function sentences(parts: string[]): string {
  return parts.filter(Boolean).map((part) => (/[。！？]$/u.test(part) ? part : `${part}。`)).join('');
}

function appendDuplicates(detail: string, summary: UploadSessionSummary): string {
  const skipped = summary.duplicatesSkipped ?? 0;
  if (skipped === 0) return detail;
  return sentences([detail, `已忽略 ${skipped} 张重复文件。`]);
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
        detail: `${skipped} 张文件正在上传，无需重复添加。`,
      };
    }
    return null;
  }

  // 全部失败：单张写文件名，多张写张数；说明是第一张失败的原因 + 处理办法
  if (summary.success === 0) {
    const failure = summary.firstFailure;
    const title = summary.total > 1
      ? `${summary.total} 张上传失败`
      : failure ? `${failure.fileName} 上传失败` : '上传失败';
    return {
      severity: 'error',
      summary: title,
      detail: appendDuplicates(failure ? `${failure.reason}，${failure.advice}` : '请检查网络或图床配置后重试', summary),
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

  // 场景二：有整张图失败（所有图床都挂了）：先说第一张为什么失败
  if (summary.failed > 0) {
    const summaryText = `${summary.success} 张成功，${summary.failed} 张失败`;
    return {
      severity: 'warn',
      summary: summaryText,
      detail: appendDuplicates(sentences([summary.firstFailure?.reason ?? '', copyDetail, '可在首页重试失败的图片。']), summary),
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

  const parts = [copyDetail, '可在首页重试失败的图片。'].filter(Boolean);
  return {
    severity: 'warn',
    summary: summaryText,
    detail: appendDuplicates(parts.join(''), summary),
  };
}
