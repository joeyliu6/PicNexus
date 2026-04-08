// 共享测试工厂函数
// 消除各测试文件中重复的 mock 数据构建逻辑

import { vi } from 'vitest';
import type { IUploader } from '../../uploaders/base/IUploader';
import type {
  UploadResult,
  ValidationResult,
  ProgressCallback,
  ConnectionTestResult,
} from '../../uploaders/base/types';
import type { UserConfig, HistoryItem, ServiceType } from '../../config/types';

// ─── 上传器 Mock ────────────────────────────────────────────

export interface MockUploaderOverrides {
  serviceId?: string;
  serviceName?: string;
  url?: string;
  fileKey?: string;
  uploadError?: Error;
  validationResult?: ValidationResult;
  connectionTestResult?: ConnectionTestResult;
}

/**
 * 创建 mock 上传器实例
 * 默认行为：validateConfig 通过、upload 成功返回标准结果
 */
export function createMockUploader(overrides?: MockUploaderOverrides): IUploader {
  const serviceId = overrides?.serviceId ?? 'mock';
  const url = overrides?.url ?? 'https://example.com/img.png';
  const fileKey = overrides?.fileKey ?? 'mock-key';

  const validResult: ValidationResult =
    overrides?.validationResult ?? { valid: true };

  const uploadResult: UploadResult = {
    serviceId,
    fileKey,
    url,
    size: 1024,
  };

  return {
    serviceId,
    serviceName: overrides?.serviceName ?? 'Mock',
    upload: overrides?.uploadError
      ? vi.fn().mockRejectedValue(overrides.uploadError)
      : vi.fn().mockResolvedValue(uploadResult),
    validateConfig: vi.fn().mockResolvedValue(validResult),
    getPublicUrl: vi.fn().mockReturnValue(url),
    testConnection: vi.fn().mockResolvedValue(
      overrides?.connectionTestResult ?? { success: true, latency: 50 }
    ),
  };
}

// ─── 配置 Mock ──────────────────────────────────────────────

/**
 * 创建最小化的 UserConfig mock
 * 可通过 services 参数覆盖特定图床配置
 */
export function createMockConfig(
  services: Record<string, Record<string, unknown>> = {},
  overrides: Partial<UserConfig> = {},
): UserConfig {
  return {
    enabledServices: ['jd'],
    services: {
      weibo: { enabled: true, cookie: 'test-cookie' },
      jd: { enabled: true },
      smms: { enabled: true, token: 'test-token' },
      github: {
        enabled: true,
        token: 'ghp_xxx',
        owner: 'user',
        repo: 'repo',
        branch: 'main',
        path: 'images/',
      },
      r2: {
        enabled: true,
        accountId: 'test-account',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        bucketName: 'test-bucket',
        publicDomain: 'https://cdn.example.com',
        path: '',
      },
      ...services,
    },
    weiboProxyMode: 'none',
    ...overrides,
  } as unknown as UserConfig;
}

// ─── 历史记录 Mock ──────────────────────────────────────────

/**
 * 创建 mock 历史记录项
 */
export function createMockHistoryItem(
  overrides: Partial<HistoryItem> = {},
): HistoryItem {
  const id = overrides.id ?? `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    timestamp: Date.now(),
    localFileName: 'test-image.jpg',
    primaryService: 'jd' as ServiceType,
    results: [
      {
        serviceId: 'jd',
        status: 'success',
        result: {
          serviceId: 'jd',
          fileKey: 'jd-key-001',
          url: 'https://img.jd.com/test.jpg',
          size: 2048,
        },
      },
    ],
    generatedLink: 'https://img.jd.com/test.jpg',
    ...overrides,
  };
}

// ─── 进度回调 Mock ──────────────────────────────────────────

/**
 * 创建 mock 进度回调
 * 返回值同时是 vi.fn()，可用 expect().toHaveBeenCalledWith() 断言
 */
export function createMockProgressCallback(): ProgressCallback & ReturnType<typeof vi.fn> {
  return vi.fn();
}

// ─── 上传结果 Mock ──────────────────────────────────────────

/**
 * 创建标准上传结果
 */
export function createMockUploadResult(
  overrides: Partial<UploadResult> = {},
): UploadResult {
  return {
    serviceId: 'mock',
    fileKey: 'mock-key',
    url: 'https://example.com/img.png',
    size: 1024,
    ...overrides,
  };
}
