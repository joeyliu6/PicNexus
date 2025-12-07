// src/core/MultiServiceUploader.ts
// 多图床并行上传编排器

import { UploaderFactory } from '../uploaders/base/UploaderFactory';
import { UploadResult } from '../uploaders/base/types';
import { UserConfig, ServiceType } from '../config/types';

/**
 * 多图床上传结果
 */
export interface MultiUploadResult {
  /** 主力图床（第一个成功的） */
  primaryService: ServiceType;

  /** 所有图床的上传结果 */
  results: Array<{
    serviceId: ServiceType;
    result?: UploadResult;
    status: 'success' | 'failed';
    error?: string;
  }>;

  /** 主力图床的 URL */
  primaryUrl: string;
}

/**
 * 多图床并行上传编排器
 * 负责协调多个图床的并行上传，处理失败重试等逻辑
 */
export class MultiServiceUploader {
  /** 最大并发上传数（同时上传的图床数量） */
  private readonly MAX_CONCURRENT_UPLOADS = 3;

  /**
   * 并行上传到多个图床（限制最大并发数）
   *
   * @param filePath 文件路径
   * @param enabledServices 启用的图床列表
   * @param config 用户配置
   * @param onProgress 进度回调（每个图床独立进度）
   * @returns 多图床上传结果
   */
  async uploadToMultipleServices(
    filePath: string,
    enabledServices: ServiceType[],
    config: UserConfig,
    onProgress?: (serviceId: ServiceType, percent: number) => void
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

    // 2. 分批并发上传到所有图床（最多同时3个）
    console.log(`[MultiUploader] 将上传到 ${validServices.length} 个图床，并发数: ${this.MAX_CONCURRENT_UPLOADS}`);

    // 创建所有上传任务
    const uploadTasks = validServices.map((serviceId) => async () => {
      try {
        const uploader = UploaderFactory.create(serviceId);
        const serviceConfig = config.services[serviceId];

        // 验证配置
        const validation = await uploader.validateConfig(serviceConfig);
        if (!validation.valid) {
          throw new Error(`配置验证失败: ${validation.errors?.join(', ')}`);
        }

        // 上传
        const result = await uploader.upload(
          filePath,
          { config: serviceConfig },
          onProgress ? (percent) => onProgress(serviceId, percent) : undefined
        );

        console.log(`[MultiUploader] ${serviceId} 上传成功`);
        return {
          serviceId,
          result,
          status: 'success' as const
        };
      } catch (error) {
        // 增强类型安全的错误处理
        let errorMsg = '未知错误';

        if (error instanceof Error) {
          errorMsg = error.message;
        } else if (typeof error === 'string') {
          errorMsg = error;
        }

        console.error(`[MultiUploader] ${serviceId} 上传失败:`, error);
        return {
          serviceId,
          status: 'failed' as const,
          error: errorMsg
        };
      }
    });

    // 3. 使用并发控制执行上传任务
    const executing: Promise<any>[] = [];
    const uploadResults: any[] = [];

    for (const task of uploadTasks) {
      const promise = task().then(result => {
        uploadResults.push(result);
        return result;
      }).finally(() => {
        executing.splice(executing.indexOf(promise), 1);
      });

      executing.push(promise);

      // 当达到最大并发数时，等待至少一个任务完成
      if (executing.length >= this.MAX_CONCURRENT_UPLOADS) {
        await Promise.race(executing);
      }
    }

    // 等待所有剩余任务完成
    await Promise.all(executing);

    // 4. 确定主力图床（第一个成功的）
    const primaryResult = uploadResults.find(r => r.status === 'success');

    if (!primaryResult || !primaryResult.result) {
      // 收集所有失败详情
      const failureDetails = uploadResults
        .filter(r => r.status === 'failed')
        .map(r => `  - ${r.serviceId}: ${r.error || '未知错误'}`)
        .join('\n');

      throw new Error(
        `所有图床上传均失败：\n${failureDetails}\n\n请检查网络连接和服务配置`
      );
    }

    console.log('[MultiUploader] 主力图床:', primaryResult.serviceId);
    console.log('[MultiUploader] 上传结果:', {
      成功: uploadResults.filter(r => r.status === 'success').length,
      失败: uploadResults.filter(r => r.status === 'failed').length
    });

    return {
      primaryService: primaryResult.serviceId,
      results: uploadResults,
      primaryUrl: primaryResult.result.url
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
    onProgress?: (percent: number) => void
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
