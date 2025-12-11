// src/services/RetryService.ts
/**
 * 重试服务 - 统一管理上传重试逻辑
 */

import { MultiServiceUploader, MultiUploadResult } from '../core/MultiServiceUploader';
import { UploadQueueManager, QueueItem } from '../uploadQueue';
import { UserConfig, ServiceType } from '../config/types';
import { Store } from '../store';
import { UploadResult } from '../uploaders/base/types';
import { checkNetworkConnectivity } from '../utils/network';

export interface RetryOptions {
  /** 配置存储 */
  configStore: Store;
  /** 队列管理器 */
  queueManager: UploadQueueManager;
  /** 活跃链接前缀 */
  activePrefix: string | null;
  /** Toast 通知回调 */
  toast: {
    success: (title: string, message: string) => void;
    error: (title: string, message: string, duration?: number) => void;
    warn: (title: string, message: string, duration?: number) => void;
    info: (title: string, message: string) => void;
  };
  /** 历史记录保存函数 */
  saveHistoryItem: (filePath: string, result: MultiUploadResult) => Promise<void>;
}

/**
 * 重试服务类
 */
export class RetryService {
  private retryingItems = new Set<string>();
  private uploader = new MultiServiceUploader();

  constructor(private options: RetryOptions) {}

  /**
   * 单个服务重试
   */
  async retrySingleService(
    itemId: string,
    serviceId: ServiceType,
    config: UserConfig
  ): Promise<void> {
    const item = this.options.queueManager.getItem(itemId);
    if (!item) {
      this.options.toast.error('重试失败', '找不到队列项');
      return;
    }

    console.log(`[重试] 单独重试 ${item.fileName} -> ${serviceId}`);

    // 检测网络连通性
    const isNetworkAvailable = await checkNetworkConnectivity();
    if (!isNetworkAvailable) {
      this.options.toast.error(
        '网络连接失败',
        '请检查网络后重试',
        3000
      );
      return;
    }

    // 并发控制
    const retryKey = `${itemId}-${serviceId}`;
    if (this.retryingItems.has(retryKey)) {
      console.warn(`[重试] ${item.fileName}-${serviceId} 已在重试中，跳过`);
      return;
    }

    // 重置 UI 状态
    this.options.queueManager.resetServiceForRetry(itemId, serviceId);
    this.retryingItems.add(retryKey);

    try {
      const result = await this.uploader.retryUpload(
        item.filePath,
        serviceId,
        config,
        (percent, step, stepIndex, totalSteps) => {
          this.options.queueManager.updateServiceProgress(
            itemId,
            serviceId,
            percent,
            step,
            stepIndex,
            totalSteps
          );
        }
      );

      // 处理成功
      await this.handleSingleServiceSuccess(itemId, serviceId, item, result);

      const serviceLabels: Record<ServiceType, string> = {
        weibo: '微博', r2: 'R2', tcl: 'TCL', jd: '京东',
        nowcoder: '牛客', qiyu: '七鱼', zhihu: '知乎', nami: '纳米'
      };
      this.options.toast.success('重试成功', `${serviceLabels[serviceId]} 上传成功`);

    } catch (error) {
      await this.handleSingleServiceFailure(itemId, serviceId, item, error);
    } finally {
      this.retryingItems.delete(retryKey);
    }
  }

  /**
   * 全量重试（所有失败的服务）
   */
  async retryAll(itemId: string, config: UserConfig): Promise<void> {
    const item = this.options.queueManager.getItem(itemId);
    if (!item) {
      this.options.toast.error('重试失败', '找不到队列项');
      return;
    }

    // 并发控制
    if (this.retryingItems.has(itemId)) {
      console.warn(`[重试] ${item.fileName} 已在重试中，跳过`);
      return;
    }

    // 检查重试次数限制
    const currentRetryCount = item.retryCount || 0;
    const maxRetries = item.maxRetries || 3;

    if (currentRetryCount >= maxRetries) {
      this.options.toast.error(
        '重试次数已达上限',
        `${item.fileName} 已重试 ${maxRetries} 次，无法继续重试`,
        5000
      );
      return;
    }

    console.log(`[重试] 全量重试 (${currentRetryCount + 1}/${maxRetries}): ${item.fileName}`);

    // 检测网络连通性
    const isNetworkAvailable = await checkNetworkConnectivity();
    if (!isNetworkAvailable) {
      this.options.toast.error(
        '网络连接失败',
        '请检查网络后重试',
        3000
      );
      return;
    }

    // 指数退避延迟
    const delays = [0, 2000, 4000];
    const delay = delays[currentRetryCount] || 4000;

    if (delay > 0) {
      console.log(`[重试] 等待 ${delay}ms 后重试...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // 标记为重试中
    this.retryingItems.add(itemId);
    this.options.queueManager.updateItem(itemId, {
      isRetrying: true,
      retryCount: currentRetryCount + 1,
      lastRetryTime: Date.now()
    });

    this.options.toast.info(
      '重试中',
      `正在重新上传 ${item.fileName} (${currentRetryCount + 1}/${maxRetries})`
    );

    // 重置状态
    this.options.queueManager.resetItemForRetry(itemId);

    const enabledServices = item.enabledServices || [];

    try {
      const result = await this.uploader.uploadToMultipleServices(
        item.filePath,
        enabledServices,
        config,
        (serviceId, percent, step, stepIndex, totalSteps) => {
          this.options.queueManager.updateServiceProgress(
            itemId,
            serviceId,
            percent,
            step,
            stepIndex,
            totalSteps
          );
        }
      );

      // 处理成功
      await this.handleFullRetrySuccess(itemId, item, result);

      // 清理重试���态
      this.retryingItems.delete(itemId);
      this.options.queueManager.updateItem(itemId, { isRetrying: false });

      // 检测部分失败
      if (result.isPartialSuccess && result.partialFailures) {
        const failedServiceNames = result.partialFailures
          .map(f => {
            const nameMap: Record<string, string> = {
              weibo: '微博', r2: 'R2', tcl: 'TCL', jd: '京东',
              nowcoder: '牛客', qiyu: '七鱼', zhihu: '知乎', nami: '纳米'
            };
            return nameMap[f.serviceId] || f.serviceId;
          })
          .join('、');

        this.options.toast.warn(
          '部分图床上传失败',
          `${item.fileName} 的 ${failedServiceNames} 上传失败，但主力图床已成功`,
          5000
        );
      }

    } catch (error) {
      await this.handleFullRetryFailure(itemId, item, enabledServices, error);

      // 清理重试状态
      this.retryingItems.delete(itemId);
      this.options.queueManager.updateItem(itemId, { isRetrying: false });
    }
  }

  /**
   * 处理单个服务重试成功
   */
  private async handleSingleServiceSuccess(
    itemId: string,
    serviceId: ServiceType,
    item: QueueItem,
    result: UploadResult
  ): Promise<void> {
    const updates = { ...item.serviceProgress };
    let link = result.url;

    if (serviceId === 'weibo' && this.options.activePrefix) {
      link = this.options.activePrefix + link;
    }

    updates[serviceId] = {
      ...updates[serviceId],
      status: '✓ 完成',
      progress: 100,
      link: link,
      isRetrying: false,
      error: undefined
    };

    // 检查是否所有服务都成功
    const allSuccess = item.enabledServices.every(s =>
      (updates[s]?.status?.includes('完成') || updates[s]?.status?.includes('✓'))
    );

    this.options.queueManager.updateItem(itemId, {
      serviceProgress: updates,
      status: allSuccess ? 'success' : 'uploading'
    });

    // 如果这是主力图床或尚无主力图床，设置它
    if (!item.primaryUrl || serviceId === item.enabledServices[0]) {
      this.options.queueManager.updateItem(itemId, {
        primaryUrl: link,
        thumbUrl: link
      });
    }
  }

  /**
   * 处理单个服务重试失败
   */
  private async handleSingleServiceFailure(
    itemId: string,
    serviceId: ServiceType,
    item: QueueItem,
    error: unknown
  ): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[重试] ${serviceId} 失败:`, errorMsg);

    const updates = { ...item.serviceProgress };
    updates[serviceId] = {
      ...updates[serviceId],
      status: '✗ 失败',
      progress: 0,
      error: errorMsg,
      isRetrying: false
    };

    this.options.queueManager.updateItem(itemId, { serviceProgress: updates });

    const serviceLabels: Record<ServiceType, string> = {
      weibo: '微博', r2: 'R2', tcl: 'TCL', jd: '京东',
      nowcoder: '牛客', qiyu: '七鱼', zhihu: '知乎', nami: '纳米'
    };
    this.options.toast.error('重试失败', `${serviceLabels[serviceId]}: ${errorMsg}`);
  }

  /**
   * 处理全量重试成功
   */
  private async handleFullRetrySuccess(
    itemId: string,
    item: QueueItem,
    result: MultiUploadResult
  ): Promise<void> {
    const currentItem = this.options.queueManager.getItem(itemId);
    if (!currentItem) return;

    const updatedServiceProgress = { ...currentItem.serviceProgress };

    result.results.forEach(serviceResult => {
      if (updatedServiceProgress[serviceResult.serviceId]) {
        if (serviceResult.status === 'success' && serviceResult.result) {
          let link = serviceResult.result.url;
          if (serviceResult.serviceId === 'weibo' && this.options.activePrefix) {
            link = this.options.activePrefix + link;
          }

          updatedServiceProgress[serviceResult.serviceId] = {
            ...updatedServiceProgress[serviceResult.serviceId],
            status: '✓ 完成',
            progress: 100,
            link: link
          };
        } else if (serviceResult.status === 'failed') {
          updatedServiceProgress[serviceResult.serviceId] = {
            ...updatedServiceProgress[serviceResult.serviceId],
            status: '✗ 失败',
            progress: 0,
            error: serviceResult.error || '上传失败'
          };
        }
      }
    });

    this.options.queueManager.updateItem(itemId, {
      serviceProgress: updatedServiceProgress
    });

    // 更新缩略图
    let thumbUrl = result.primaryUrl;
    if (result.primaryService === 'weibo' && this.options.activePrefix) {
      thumbUrl = this.options.activePrefix + thumbUrl;
    }
    this.options.queueManager.markItemComplete(itemId, thumbUrl);

    // 保存历史记录
    await this.options.saveHistoryItem(item.filePath, result);
  }

  /**
   * 处理全量重试失败
   */
  private async handleFullRetryFailure(
    itemId: string,
    item: QueueItem,
    enabledServices: ServiceType[],
    error: unknown
  ): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[重试] ${item.fileName} 上传失败:`, errorMsg);

    // 解析失败的图床
    let failedServices: string[] = [];
    const servicePattern = /- (\w+):/g;
    let match;
    while ((match = servicePattern.exec(errorMsg)) !== null) {
      failedServices.push(match[1]);
    }

    // 智能错误提示
    if (errorMsg.includes('Cookie') || errorMsg.includes('100006')) {
      const serviceName = failedServices.length > 0 ? failedServices.join('、') : '微博';
      this.options.toast.error(
        `${serviceName} Cookie 已过期`,
        '请前往设置页面更新 Cookie 后重试',
        6000
      );
    } else if (errorMsg.includes('认证失败') || errorMsg.includes('authentication')) {
      const serviceName = failedServices.length > 0 ? failedServices.join('、') : '图床';
      this.options.toast.error(
        `${serviceName}认证失败`,
        '请检查配置信息是否正确',
        5000
      );
    } else {
      this.options.toast.error(
        '重试失败',
        `${item.fileName}: ${errorMsg}`,
        5000
      );
    }

    // 更新所有服务的失败状态
    const currentItem = this.options.queueManager.getItem(itemId);
    if (currentItem && currentItem.serviceProgress) {
      const updatedServiceProgress = { ...currentItem.serviceProgress };
      enabledServices.forEach(serviceId => {
        if (updatedServiceProgress[serviceId]) {
          updatedServiceProgress[serviceId] = {
            ...updatedServiceProgress[serviceId],
            status: '✗ 失败',
            progress: 0,
            error: errorMsg
          };
        }
      });
      this.options.queueManager.updateItem(itemId, {
        serviceProgress: updatedServiceProgress
      });
    }

    this.options.queueManager.markItemFailed(itemId, errorMsg);
  }
}
