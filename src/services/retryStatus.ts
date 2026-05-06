import type { QueueItem, ServiceProgress } from '../uploadQueue';
import type { UploadResult } from '../uploaders/base/types';

function isServiceSuccess(progress: ServiceProgress | undefined): boolean {
  const status = progress?.status || '';
  return status.includes('完成') || status.includes('✓');
}

function isServiceFailed(progress: ServiceProgress | undefined): boolean {
  const status = progress?.status || '';
  return status.includes('失败') || status.includes('✗');
}

export function getFailedServices(item: QueueItem): string[] {
  const failed: string[] = [];
  for (const [serviceId, progress] of Object.entries(item.serviceProgress ?? {})) {
    if (isServiceFailed(progress)) {
      failed.push(serviceId);
    }
  }
  return failed;
}

function isServiceSkipped(progress: ServiceProgress | undefined): boolean {
  const status = progress?.status || '';
  return status.includes('跳过');
}

function isServiceActive(progress: ServiceProgress | undefined): boolean {
  if (!progress) return false;
  if (isServiceSuccess(progress) || isServiceFailed(progress) || isServiceSkipped(progress)) return false;
  if (progress.isRetrying) return true;

  const status = progress.status || '';
  return progress.progress > 0 ||
    status.includes('%') ||
    status.includes('上传') ||
    status.includes('准备') ||
    /\(\d+\/\d+\)/.test(status);
}

export function resolveQueueStatus(
  enabledServices: string[],
  serviceProgress: Partial<Record<string, ServiceProgress>>
): QueueItem['status'] {
  const hasSuccess = enabledServices.some(serviceId => isServiceSuccess(serviceProgress[serviceId]));
  if (
    hasSuccess &&
    enabledServices.every(serviceId =>
      isServiceSuccess(serviceProgress[serviceId]) || isServiceSkipped(serviceProgress[serviceId])
    )
  ) {
    return 'success';
  }
  if (enabledServices.some(serviceId => isServiceActive(serviceProgress[serviceId]))) {
    return 'uploading';
  }
  if (enabledServices.some(serviceId => isServiceFailed(serviceProgress[serviceId]))) {
    return 'error';
  }
  return 'pending';
}

export function areAllEnabledServicesSuccessful(item: QueueItem): boolean {
  return item.enabledServices.some(serviceId => isServiceSuccess(item.serviceProgress[serviceId])) &&
    item.enabledServices.every(serviceId =>
      isServiceSuccess(item.serviceProgress[serviceId]) || isServiceSkipped(item.serviceProgress[serviceId])
    );
}

export function mergeSuccessMetadata(
  serviceId: string,
  current: ServiceProgress | undefined,
  result: UploadResult
): Record<string, unknown> | undefined {
  const metadata = {
    ...current?.metadata,
    ...result.metadata,
    ...(result.fileKey ? { fileKey: result.fileKey } : {}),
    ...(serviceId === 'weibo' && result.fileKey ? { pid: result.fileKey } : {}),
  };

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}
