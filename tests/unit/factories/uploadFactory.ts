import { vi } from 'vitest';
import type { QueueItem, ServiceProgress } from '@/core/UploadQueue';
import type { IUploader } from '@/uploaders/base/IUploader';
import type {
  ConnectionTestResult,
  ProgressCallback,
  UploadResult,
  ValidationResult,
} from '@/uploaders/base/types';

let uploadSequence = 0;

export interface MockUploaderOverrides {
  serviceId?: string;
  serviceName?: string;
  url?: string;
  fileKey?: string;
  uploadError?: Error;
  validationResult?: ValidationResult;
  connectionTestResult?: ConnectionTestResult;
}

export function resetUploadFactorySequence(): void {
  uploadSequence = 0;
}

export function createUploadResult(
  overrides: Partial<UploadResult> = {},
): UploadResult {
  const serviceId = overrides.serviceId ?? 'jd';

  return {
    serviceId,
    fileKey: overrides.fileKey ?? `${serviceId}-key-001`,
    url: overrides.url ?? `https://img.example.com/${serviceId}-key-001.jpg`,
    size: overrides.size ?? 1024,
    ...overrides,
  };
}

export function createServiceProgress(
  overrides: Partial<ServiceProgress> = {},
): ServiceProgress {
  const serviceId = overrides.serviceId ?? 'jd';

  return {
    serviceId,
    progress: overrides.progress ?? 0,
    status: overrides.status ?? 'waiting',
    link: overrides.link,
    error: overrides.error,
    metadata: overrides.metadata,
    isRetrying: overrides.isRetrying,
  };
}

/**
 * 队列服务状态文案。
 *
 * UploadQueueManager 是按状态**文本**做判定的（例如 `status === '等待中...'` 判定
 * 服务从未启动、`status.includes('失败')` 判定不要收口成完成），所以构造前置状态时
 * 必须用与生产代码逐字一致的文案，不能用 createServiceProgress 默认的英文 'waiting'。
 */
export const QUEUE_SERVICE_STATUS = {
  waiting: '等待中...',
  /** 进度已到 100 但尚未被 markItemComplete 收口时的百分比文案 */
  uploaded: '100%',
  done: '✓ 完成',
  failed: '✗ 失败',
  skipped: '已跳过',
  skippedUnconfigured: '已跳过（未配置）',
} as const;

/** 已传完但未收口的服务进度：progress=100，状态文案仍是百分比 */
export function createUploadedServiceProgress(
  serviceId: string,
  overrides: Partial<ServiceProgress> = {},
): ServiceProgress {
  return createServiceProgress({
    serviceId,
    progress: 100,
    status: QUEUE_SERVICE_STATUS.uploaded,
    ...overrides,
  });
}

/** 失败的服务进度：progress=0，状态文案为 '✗ 失败' */
export function createFailedServiceProgress(
  serviceId: string,
  overrides: Partial<ServiceProgress> = {},
): ServiceProgress {
  return createServiceProgress({
    serviceId,
    progress: 0,
    status: QUEUE_SERVICE_STATUS.failed,
    error: 'upload failed',
    ...overrides,
  });
}

export function createQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  uploadSequence += 1;

  const enabledServices = overrides.enabledServices ?? ['jd'];
  const serviceProgress = overrides.serviceProgress ?? Object.fromEntries(
    enabledServices.map(serviceId => [serviceId, createServiceProgress({ serviceId })]),
  );

  return {
    id: overrides.id ?? `queue-${uploadSequence}`,
    fileName: overrides.fileName ?? `upload-${uploadSequence}.jpg`,
    filePath: overrides.filePath ?? `/mock/uploads/upload-${uploadSequence}.jpg`,
    enabledServices,
    serviceProgress,
    status: overrides.status ?? 'pending',
    errorMessage: overrides.errorMessage,
    primaryUrl: overrides.primaryUrl,
    thumbUrl: overrides.thumbUrl,
    retryCount: overrides.retryCount ?? 0,
    maxRetries: overrides.maxRetries ?? 3,
    lastRetryTime: overrides.lastRetryTime,
    isRetrying: overrides.isRetrying ?? false,
    uploadToR2: overrides.uploadToR2 ?? enabledServices.includes('r2'),
    weiboProgress: overrides.weiboProgress ?? 0,
    r2Progress: overrides.r2Progress ?? 0,
    weiboStatus: overrides.weiboStatus ?? 'waiting',
    r2Status: overrides.r2Status ?? (enabledServices.includes('r2') ? 'waiting' : 'skipped'),
    weiboPid: overrides.weiboPid,
    weiboLink: overrides.weiboLink,
    baiduLink: overrides.baiduLink,
    r2Link: overrides.r2Link,
  };
}

/**
 * 老版本持久化数据里可能缺 `enabledServices` 字段。
 * `UploadQueueManager.resetItemForRetry` 为此保留了兜底分支，这里显式构造这种残缺项，
 * 避免把类型断言散落到各个 spec 里。
 */
export function createLegacyQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  const { enabledServices: _dropped, ...rest } = createQueueItem(overrides);
  return rest as QueueItem;
}

export function createQueueItems(
  count: number,
  overrides:
    | Partial<QueueItem>
    | ((index: number) => Partial<QueueItem>) = {},
): QueueItem[] {
  return Array.from({ length: count }, (_, index) => {
    const itemOverrides = typeof overrides === 'function' ? overrides(index) : overrides;
    return createQueueItem(itemOverrides);
  });
}

export function createMockUploader(overrides?: MockUploaderOverrides): IUploader {
  const serviceId = overrides?.serviceId ?? 'mock';
  const uploadResult = createUploadResult({
    serviceId,
    fileKey: overrides?.fileKey ?? 'mock-key',
    url: overrides?.url ?? 'https://example.com/img.png',
  });

  return {
    serviceId,
    serviceName: overrides?.serviceName ?? 'Mock',
    upload: overrides?.uploadError
      ? vi.fn().mockRejectedValue(overrides.uploadError)
      : vi.fn().mockResolvedValue(uploadResult),
    validateConfig: vi.fn().mockResolvedValue(overrides?.validationResult ?? { valid: true }),
    getPublicUrl: vi.fn().mockReturnValue(uploadResult.url),
    testConnection: vi.fn().mockResolvedValue(
      overrides?.connectionTestResult ?? { success: true, latency: 50 },
    ),
  };
}

export function createMockProgressCallback(): ProgressCallback & ReturnType<typeof vi.fn> {
  return vi.fn();
}

export const createMockUploadResult = createUploadResult;
