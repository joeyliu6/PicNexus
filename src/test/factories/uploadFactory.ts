import { vi } from 'vitest';
import type { QueueItem, ServiceProgress } from '../../uploadQueue';
import type { IUploader } from '../../uploaders/base/IUploader';
import type {
  ConnectionTestResult,
  ProgressCallback,
  UploadResult,
  ValidationResult,
} from '../../uploaders/base/types';

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
