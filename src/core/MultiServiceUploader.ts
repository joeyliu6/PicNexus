// 多图床并行上传编排器

import { UploaderFactory } from '../uploaders/base/UploaderFactory';
import { UploadResult } from '../uploaders/base/types';
import { UserConfig, ServiceType, isCustomS3Id, getCustomS3ProfileId } from '../config/types';
import { StructuredError, UploadErrorCode, createStructuredError } from '../uploaders/base/ErrorTypes';
import { convertToStructuredWeiboError } from '../uploaders/weibo/WeiboError';
import { convertToStructuredR2Error } from '../uploaders/r2/R2Error';

import { convertToJDError } from '../uploaders/jd/JDError';
import { convertToNamiError } from '../uploaders/nami/NamiError';
import { getServiceSemaphore } from '../utils/semaphore';
import {
  SERVICE_REQUIRED_FIELDS,
  COOKIE_BASED_SERVICES,
  NO_CONFIG_SERVICES,
  CUSTOM_S3_REQUIRED_FIELDS,
} from '../constants/serviceRequiredFields';
import { createLogger } from '../utils/logger';

const log = createLogger('MultiUploader');

/** 每个图床的最大并发数 */
const SERVICE_MAX_CONCURRENT = 2;

/** 根据 serviceId 查找对应的配置对象（支持内置服务和 custom_s3:xxx） */
function getServiceConfig(serviceId: string, config: UserConfig): Record<string, unknown> | undefined {
  if (isCustomS3Id(serviceId)) {
    return config.custom_s3_profiles?.find(p => p.id === getCustomS3ProfileId(serviceId)) as Record<string, unknown> | undefined;
  }
  return config.services[serviceId as ServiceType] as Record<string, unknown> | undefined;
}

/**
 * 单个服务完成结果（用于实时回调）
 */
export interface SingleServiceResult {
  serviceId: string;
  result?: UploadResult;
  status: 'success' | 'failed';
  error?: string;
  structuredError?: StructuredError;
}

/**
 * 多图床上传结果
 */
export interface MultiUploadResult {
  /** 主力图床（第一个成功的） */
  primaryService: string;

  /** 所有图床的上传结果 */
  results: SingleServiceResult[];

  /** 主力图床的 URL */
  primaryUrl: string;

  /** 新增：部分失败的图床列表（至少一个成功时） */
  partialFailures?: Array<{
    serviceId: string;
    error: string;
    structuredError?: StructuredError;
  }>;

  /** 新增：是否为部分成功（有成功也有失败） */
  isPartialSuccess?: boolean;
}

/**
 * 多图床并行上传编排器
 * 负责协调多个图床的并行上传，处理失败重试等逻辑
 */
export class MultiServiceUploader {
  /** 最大并发上传数（已移除限制，所有图床并发上传以提升用户体验） */

  /**
   * 并行上传到多个图床（限制最大并发数）
   *
   * @param filePath 文件路径
   * @param enabledServices 启用的图床列表
   * @param config 用户配置
   * @param onProgress 进度回调（每个图床独立进度）
   * @param onServiceResult 单个服务完成回调（实时通知）
   * @returns 多图床上传结果
   */
  async uploadToMultipleServices(
    filePath: string,
    enabledServices: string[],
    config: UserConfig,
    onProgress?: (
      serviceId: string,
      percent: number,
      step?: string,
      stepIndex?: number,
      totalSteps?: number
    ) => void,
    onServiceResult?: (result: SingleServiceResult) => void | Promise<void>
  ): Promise<MultiUploadResult> {
    log.info('开始并行上传到:', enabledServices);

    // 确保 config.services 存在（兼容旧版本配置）
    // 使用安全副本，避免修改传入的 config 对象
    const safeConfig: UserConfig = {
      ...config,
      services: config.services || {}
    };

    // 1. 过滤出已配置的图床
    const validServices = this.filterConfiguredServices(enabledServices, safeConfig);

    // 检查是否有启用的服务
    if (enabledServices.length === 0) {
      throw new Error('没有启用任何图床服务，请在上传界面选择至少一个图床');
    }

    // 检查是否有已配置的服务
    if (validServices.length === 0) {
      const unconfiguredList = enabledServices
        .filter(svc => !validServices.includes(svc))
        .join(', ');

      throw new Error(
        `已启用的图床尚未配置：${unconfiguredList}\n` +
        `请前往设置页面完成配置`
      );
    }

    // 2. 并发上传到所有图床（无并发限制，提升用户体验）
    // 创建所有上传任务
    // 将 TCL 和其他服务分开处理
    const uploadTasks: (() => Promise<SingleServiceResult>)[] = [];

    validServices.forEach((serviceId) => {
      const task = async () => {
        // 获取该图床的信号量，限制并发数
        const semaphore = getServiceSemaphore(serviceId, SERVICE_MAX_CONCURRENT);

        return semaphore.withPermit(async () => {
          let taskResult: SingleServiceResult;

          try {
            const uploader = UploaderFactory.create(serviceId);
            const serviceConfig = getServiceConfig(serviceId, safeConfig)
              ?? (NO_CONFIG_SERVICES.includes(serviceId as ServiceType) ? {} as Record<string, unknown> : undefined);
            if (!serviceConfig) {
              throw new Error(`服务 ${serviceId} 的配置不存在，请检查设置`);
            }

            // 立即触发进度回调,显示"开始上传"状态
            if (onProgress) {
              onProgress(serviceId, 0, '准备上传...', 0, 2);
            }

            // 验证配置
            const validation = await uploader.validateConfig(serviceConfig);
            if (!validation.valid) {
              throw new Error(`配置验证失败: ${validation.errors?.join(', ')}`);
            }

            // 配置验证通过,更新进度
            if (onProgress) {
              onProgress(serviceId, 10, '开始上传...', 1, 2);
            }

            // 上传
            const result = await uploader.upload(
              filePath,
              { config: serviceConfig },
              onProgress ? (percent, step, stepIndex, totalSteps) => {
                onProgress(serviceId, percent, step, stepIndex, totalSteps);
              } : undefined
            );

            log.info(`${serviceId} 上传成功`);
            taskResult = {
              serviceId,
              result,
              status: 'success' as const
            };
          } catch (error) {
            // 转换为结构化错误
            let structuredError: StructuredError;

            switch (serviceId) {
              case 'weibo':
                structuredError = convertToStructuredWeiboError(error);
                break;
              case 'r2':
                structuredError = convertToStructuredR2Error(error);
                break;

              case 'jd':
                structuredError = convertToJDError(error);
                break;
              case 'nami':
                structuredError = convertToNamiError(error);
                break;
              default: {
                // 其他图床使用通用错误
                const errorMsg = error instanceof Error ? error.message : String(error);
                structuredError = createStructuredError(
                  UploadErrorCode.UPLOAD_FAILED,
                  `${serviceId} 上传失败: ${errorMsg}`,
                  {
                    details: errorMsg,
                    retryable: true,
                    originalError: error,
                    serviceId
                  }
                );
                break;
              }
            }

            log.error(`${serviceId} 上传失败:`, structuredError);
            taskResult = {
              serviceId,
              status: 'failed' as const,
              error: structuredError.message,
              structuredError
            };
          }

          // 关键：任务完成后立即通知回调，实现实时 UI 更新
          if (onServiceResult) {
            await onServiceResult(taskResult);
          }

          return taskResult;
        }); // withPermit 结束
      };

      uploadTasks.push(task);
    });

    // 3. 并发执行逻辑优化
    // 启动所有任务
    const uploadResults = await Promise.all(uploadTasks.map(task => task()));

    // 4. 确定主力图床（第一个成功的）
    const primaryResult = uploadResults.find(r => r.status === 'success');
    const failedResults = uploadResults.filter(r => r.status === 'failed');

    if (!primaryResult || !primaryResult.result) {
      // 收集所有失败详情
      const failureDetails = failedResults
        .map(r => `  - ${r.serviceId}: ${r.error || '未知错误'}`)
        .join('\n');

      throw new Error(
        `所有图床上传均失败：\n${failureDetails}\n\n请检查网络连接和服务配置`
      );
    }

    // 新增：检测部分失败
    const isPartialSuccess = failedResults.length > 0;
    const partialFailures = isPartialSuccess ? failedResults.map(r => ({
      serviceId: r.serviceId,
      error: r.error || '未知错误',
      structuredError: r.structuredError
    })) : undefined;

    const successCount = uploadResults.filter(r => r.status === 'success').length;
    const failedCount = uploadResults.filter(r => r.status === 'failed').length;
    log.info(`上传完成: 成功 ${successCount}, 失败 ${failedCount}, 主力: ${primaryResult.serviceId}`);

    if (isPartialSuccess) {
      log.warn('部分图床上传失败:', partialFailures);
    }

    return {
      primaryService: primaryResult.serviceId,
      results: uploadResults,
      primaryUrl: primaryResult.result.url,
      partialFailures,           // 新增
      isPartialSuccess          // 新增
    };
  }

  /**
   * 单个图床重试上传
   *
   * @param filePath 文件路径
   * @param serviceId 图床ID
   * @param config 用户配置
   * @param onProgress 进度回调
   * @returns 上传结果
   */
  async retryUpload(
    filePath: string,
    serviceId: string,
    config: UserConfig,
    onProgress?: (percent: number, step?: string, stepIndex?: number, totalSteps?: number) => void
  ): Promise<UploadResult> {
    log.info(`重试上传到 ${serviceId}`);

    // 使用安全副本，避免修改传入的 config 对象
    const safeConfig: UserConfig = {
      ...config,
      services: config.services || {}
    };

    const uploader = UploaderFactory.create(serviceId);
    const serviceConfig = getServiceConfig(serviceId, safeConfig);
    if (!serviceConfig) {
      throw new Error(`服务 ${serviceId} 的配置不存在，请检查设置`);
    }

    // 验证配置
    const validation = await uploader.validateConfig(serviceConfig);
    if (!validation.valid) {
      throw new Error(`配置验证失败: ${validation.errors?.join(', ')}`);
    }

    // 上传
    return await uploader.upload(
      filePath,
      { config: serviceConfig },
      onProgress
    );
  }

  // 常量已迁移到 src/constants/serviceRequiredFields.ts

  /**
   * 过滤出已配置的图床
   * 在过滤阶段验证配置完整性，避免上传时才报错
   */
  filterConfiguredServices(
    enabledServices: string[],
    config: UserConfig
  ): string[] {
    return enabledServices.filter(serviceId => {
      // 自定义 S3 复合 ID：从 custom_s3_profiles 中检查
      if (isCustomS3Id(serviceId)) {
        const profile = getServiceConfig(serviceId, config);
        if (!profile) {
          log.warn(`${serviceId} 未找到对应 profile，跳过`);
          return false;
        }
        const cfg = profile as Record<string, unknown>;
        const hasAll = CUSTOM_S3_REQUIRED_FIELDS.every(field => {
          const val = cfg[field];
          return typeof val === 'string' ? val.trim() : val;
        });
        if (!hasAll) {
          log.warn(`${serviceId} 配置不完整，跳过`);
          return false;
        }
        return true;
      }

      // 无需配置的图床直接通过
      if (NO_CONFIG_SERVICES.includes(serviceId as ServiceType)) {
        return true;
      }

      const serviceConfig = getServiceConfig(serviceId, config);
      if (!serviceConfig) {
        log.warn(`${serviceId} 未配置，跳过`);
        return false;
      }

      // Cookie 类图床：统一检查 cookie 字段
      if (COOKIE_BASED_SERVICES.includes(serviceId as ServiceType)) {
        if (!(serviceConfig.cookie as string)?.trim()) {
          log.warn(`${serviceId} Cookie 未配置，跳过`);
          return false;
        }
        return true;
      }

      // 通用必填字段校验
      const requiredFields = SERVICE_REQUIRED_FIELDS[serviceId as ServiceType];
      if (requiredFields?.length) {
        const hasAll = requiredFields.every(field => {
          const val = serviceConfig[field];
          return typeof val === 'string' ? val.trim() : val;
        });
        if (!hasAll) {
          log.warn(`${serviceId} 配置不完整，跳过`);
          return false;
        }
        return true;
      }

      // 其他图床：检查 enabled 字段
      if (serviceConfig.enabled === false) {
        log.warn(`${serviceId} 未启用，跳过`);
        return false;
      }

      return true;
    });
  }
}
