// src/core/MultiServiceUploader.ts
// 多图床并行上传编排器

import { UploaderFactory } from '../uploaders/base/UploaderFactory';
import { UploadResult } from '../uploaders/base/types';
import { UserConfig, ServiceType } from '../config/types';
import { StructuredError, UploadErrorCode, createStructuredError } from '../uploaders/base/ErrorTypes';
import { convertToStructuredWeiboError } from '../uploaders/weibo/WeiboError';
import { convertToStructuredR2Error } from '../uploaders/r2/R2Error';
import { convertToTCLError } from '../uploaders/tcl/TCLError';
import { convertToJDError } from '../uploaders/jd/JDError';
import { convertToNamiError } from '../uploaders/nami/NamiError';

/**
 * 单个服务完成结果（用于实时回调）
 */
export interface SingleServiceResult {
  serviceId: ServiceType;
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
  primaryService: ServiceType;

  /** 所有图床的上传结果 */
  results: SingleServiceResult[];

  /** 主力图床的 URL */
  primaryUrl: string;

  /** 新增：部分失败的图床列表（至少一个成功时） */
  partialFailures?: Array<{
    serviceId: ServiceType;
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
  // private readonly MAX_CONCURRENT_UPLOADS = 3;  // 已废弃

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
    enabledServices: ServiceType[],
    config: UserConfig,
    onProgress?: (
      serviceId: ServiceType,
      percent: number,
      step?: string,
      stepIndex?: number,
      totalSteps?: number
    ) => void,
    onServiceResult?: (result: SingleServiceResult) => void
  ): Promise<MultiUploadResult> {
    console.log('[MultiUploader] 开始并行上传到:', enabledServices);

    // 确保 config.services 存在（兼容旧版本配置）
    if (!config.services) {
      console.warn('[MultiUploader] 配置中缺少 services 字段，使用默认值');
      config.services = {};
    }

    // 1. 过滤出已配置的图床
    const validServices = this.filterConfiguredServices(enabledServices, config);

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
    console.log(`[MultiUploader] 将上传到 ${validServices.length} 个图床，全部并发上传`);

    // 创建所有上传任务
    const uploadTasks = validServices.map((serviceId) => async () => {
      let taskResult: SingleServiceResult;

      try {
        const uploader = UploaderFactory.create(serviceId);
        const serviceConfig = config.services[serviceId];

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

        console.log(`[MultiUploader] ${serviceId} 上传成功`);
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
          case 'tcl':
            structuredError = convertToTCLError(error);
            break;
          case 'jd':
            structuredError = convertToJDError(error);
            break;
          case 'nami':
            structuredError = convertToNamiError(error);
            break;
          default:
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
        }

        console.error(`[MultiUploader] ${serviceId} 上传失败:`, structuredError);
        taskResult = {
          serviceId,
          status: 'failed' as const,
          error: structuredError.message,
          structuredError
        };
      }

      // 关键：任务完成后立即通知回调，实现实时 UI 更新
      if (onServiceResult) {
        onServiceResult(taskResult);
      }

      return taskResult;
    });

    // 3. 并发执行所有上传任务（所有图床同时上传）
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

    console.log('[MultiUploader] 主力图床:', primaryResult.serviceId);
    console.log('[MultiUploader] 上传结果:', {
      成功: uploadResults.filter(r => r.status === 'success').length,
      失败: uploadResults.filter(r => r.status === 'failed').length
    });

    // 新增：记录警告
    if (isPartialSuccess) {
      console.warn('[MultiUploader] 部分图床上传失败:', partialFailures);
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
    serviceId: ServiceType,
    config: UserConfig,
    onProgress?: (percent: number, step?: string, stepIndex?: number, totalSteps?: number) => void
  ): Promise<UploadResult> {
    console.log(`[MultiUploader] 重试上传到 ${serviceId}`);

    // 确保 config.services 存在（兼容旧版本配置）
    if (!config.services) {
      console.warn('[MultiUploader] 配置中缺少 services 字段，使用默认值');
      config.services = {};
    }

    const uploader = UploaderFactory.create(serviceId);
    const serviceConfig = config.services[serviceId];

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

  /**
   * 过滤出已配置的图床
   *
   * @param enabledServices 用户启用的图床列表
   * @param config 用户配置
   * @returns 已配置的图床列表
   */
  private filterConfiguredServices(
    enabledServices: ServiceType[],
    config: UserConfig
  ): ServiceType[] {
    return enabledServices.filter(serviceId => {
      const serviceConfig = config.services[serviceId];

      // TCL 和京东图床无需配置，直接返回 true
      if (serviceId === 'tcl' || serviceId === 'jd') {
        return true;
      }

      // 其他图床检查是否已配置
      if (!serviceConfig) {
        console.warn(`[MultiUploader] ${serviceId} 未配置，跳过`);
        return false;
      }

      // 检查必填字段（而不是检查 enabled 字段）
      // enabled 字段只是一个开关，不影响配置是否完整
      if (serviceId === 'weibo') {
        const weiboConfig = serviceConfig as any;
        if (!weiboConfig.cookie || weiboConfig.cookie.trim().length === 0) {
          console.warn(`[MultiUploader] ${serviceId} Cookie 未配置，跳过`);
          return false;
        }
        // 如果 cookie 存在，认为已配置
        return true;
      }

      if (serviceId === 'nowcoder') {
        const nowcoderConfig = serviceConfig as any;
        if (!nowcoderConfig.cookie || nowcoderConfig.cookie.trim().length === 0) {
          console.warn(`[MultiUploader] ${serviceId} Cookie 未配置，跳过`);
          return false;
        }
        // 如果 cookie 存在，认为已配置
        return true;
      }

      if (serviceId === 'zhihu') {
        const zhihuConfig = serviceConfig as any;
        if (!zhihuConfig.cookie || zhihuConfig.cookie.trim().length === 0) {
          console.warn(`[MultiUploader] ${serviceId} Cookie 未配置，跳过`);
          return false;
        }
        // 如果 cookie 存在，认为已配置
        return true;
      }

      if (serviceId === 'nami') {
        const namiConfig = serviceConfig as any;
        if (!namiConfig.cookie || namiConfig.cookie.trim().length === 0) {
          console.warn(`[MultiUploader] ${serviceId} Cookie 未配置，跳过`);
          return false;
        }
        // 如果 cookie 存在，认为已配置
        return true;
      }

      if (serviceId === 'qiyu') {
        // 七鱼图床 Token 由后端自动获取，只要启用了就认为已配置
        // Chrome/Edge 检测在前端 UI 层面处理
        return true;
      }

      if (serviceId === 'r2') {
        const r2Config = serviceConfig as any;
        if (
          !r2Config.accountId ||
          !r2Config.accessKeyId ||
          !r2Config.secretAccessKey ||
          !r2Config.bucketName ||
          !r2Config.publicDomain
        ) {
          console.warn(`[MultiUploader] ${serviceId} 配置不完整，跳过`);
          return false;
        }
        // 如果所有必填字段都存在，认为已配置
        return true;
      }

      // 对于其他图床，检查 enabled 字段
      if (serviceConfig.enabled === false) {
        console.warn(`[MultiUploader] ${serviceId} 未启用，跳过`);
        return false;
      }

      return true;
    });
  }
}
