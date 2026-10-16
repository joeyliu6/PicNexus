/**
 * 重试服务 - 统一管理上传重试逻辑
 */

import type { MultiUploadResult } from '@/core/MultiServiceUploader';
import { MultiServiceUploader } from '@/core/MultiServiceUploader';
import type { UploadQueueManager, QueueItem } from '@/core/UploadQueue';
import type { UserConfig } from '@/config/types';
import type { Store } from '@/store';
import type { UploadResult } from '@/uploaders/base/types';
import { checkNetworkConnectivity } from '@/utils/network';
import { useHistorySaver } from '@/composables/history/useHistorySaver';
import { useImageCompress } from '@/composables/image/useImageCompress';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { getFileExtension, getUnsupportedServicesForFormat } from '@/constants/serviceFormats';
import { createLogger } from '@/utils/logger';
import { cleanupClipboardTempFile } from '@/utils/clipboardTempFile';
import {
  areAllEnabledServicesSuccessful,
  getFailedServices,
  mergeSuccessMetadata,
  resolveQueueStatus,
} from './retryStatus';
import { COOKIE_BASED_SERVICES } from '@/constants/serviceRequiredFields';
import { describeUploadFailure, NETWORK_DOWN_ERROR, reasonsByService } from '@/utils/uploadFailureMessage';

const log = createLogger('RetryService');

const isCookieHost = (serviceId: string) => (COOKIE_BASED_SERVICES as readonly string[]).includes(serviceId);

export interface RetryOptions {
  /** 配置存储 */
  configStore: Store;
  /** 队列管理器 */
  queueManager: UploadQueueManager;
  /** Toast 通知回调 */
  toast: {
    success: (title: string, message: string) => void;
    error: (title: string, message: string, duration?: number) => void;
    warn: (title: string, message: string, duration?: number) => void;
    info: (title: string, message: string) => void;
  };
  /**
   * 历史记录保存函数
   *
   * customId 用于全量重试场景：传入队列项原有的 historyId，避免 saveHistoryItem
   * 生成新 UUID 后插出与原记录指向同一文件的孤儿记录。
   */
  saveHistoryItem: (filePath: string, result: MultiUploadResult, customId?: string) => Promise<void>;
}

interface RetrySingleServiceOptions {
  /** 批量重传时静默单项 toast，避免提示轰炸 */
  silentToast?: boolean;
}

interface PreparedRetryFile {
  uploadPath: string;
  cleanup: () => Promise<void>;
}

/**
 * 网络不通就不去白等图床超时，但照一次失败收口：图上写「网络连接中断」。
 * 首页在屏时不弹通知，什么都不标的话用户点了「重试」会以为没反应。
 */
async function ensureNetwork(): Promise<void> {
  if (!(await checkNetworkConnectivity())) throw new Error(NETWORK_DOWN_ERROR);
}

/**
 * 重试服务类
 */
export class RetryService {
  private retryingItems = new Set<string>();
  private uploader = new MultiServiceUploader();
  private historySaver = useHistorySaver();
  private imageCompress = useImageCompress();

  constructor(private options: RetryOptions) { }

  /**
   * 按当前压缩设置准备重试要传的文件。
   * 压缩后的格式有图床不支持（例如上传后把输出格式改成了 webp，而京东不收 webp）时，
   * 只要原图格式这些图床都支持，就改传原图，免得重试必然失败。
   */
  private async prepareRetryFile(
    filePath: string,
    serviceIds: string[],
    config: UserConfig
  ): Promise<PreparedRetryFile> {
    const prepared = await this.imageCompress.prepareSingleUpload(filePath, config.imageCompression);
    const unsupported = (path: string) => getUnsupportedServicesForFormat(serviceIds, getFileExtension(path)).length > 0;
    if (prepared.uploadPath !== filePath && unsupported(prepared.uploadPath) && !unsupported(filePath)) {
      log.info(`压缩后的格式不被 ${serviceIds.join('、')} 支持，重试改传原图`);
      await prepared.cleanup();
      return { uploadPath: filePath, cleanup: async () => {} };
    }
    return prepared;
  }

  private async cleanupClipboardTempFileIfComplete(itemId: string): Promise<void> {
    const latestItem = this.options.queueManager.getItem(itemId);
    if (latestItem && areAllEnabledServicesSuccessful(latestItem)) {
      await cleanupClipboardTempFile(latestItem.filePath);
    }
  }

  /**
   * 单个服务重试
   */
  async retrySingleService(
    itemId: string,
    serviceId: string,
    config: UserConfig,
    options?: RetrySingleServiceOptions
  ): Promise<void> {
    const silentToast = options?.silentToast === true;
    const item = this.options.queueManager.getItem(itemId);
    if (!item) {
      if (!silentToast) {
        this.options.toast.error('重试失败', '队列项不存在');
      }
      return;
    }

    log.info(`单独重试 ${item.fileName} -> ${serviceId}`);

    // 并发控制
    const retryKey = `${itemId}-${serviceId}`;
    if (this.retryingItems.has(retryKey)) {
      log.warn(`${item.fileName}-${serviceId} 已在重试中，跳过`);
      return;
    }

    // 重置 UI 状态
    this.options.queueManager.resetServiceForRetry(itemId, serviceId);
    this.retryingItems.add(retryKey);

    let prepared: PreparedRetryFile | undefined;
    try {
      await ensureNetwork();
      // 与首次上传一样按当前设置压缩；队列与历史仍记原图路径，临时文件传完即删
      prepared = await this.prepareRetryFile(item.filePath, [serviceId], config);
      const result = await this.uploader.retryUpload(
        prepared.uploadPath,
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
      await this.handleSingleServiceSuccess(itemId, serviceId, item, result, config.linkOutput?.copyFromService);

      if (!silentToast) {
        // 「修复」在新界面专指链接健康里的修复，这里是补传
        this.options.toast.success(`已补传到${getServiceDisplayName(serviceId, config)}`, item.fileName);
      }

    } catch (error) {
      await this.handleSingleServiceFailure(itemId, serviceId, item, error, silentToast, config);
    } finally {
      this.retryingItems.delete(retryKey);
      await prepared?.cleanup();
    }
  }

  /**
   * 全量重试（所有失败的服务）
   */
  async retryAll(itemId: string, config: UserConfig): Promise<void> {
    const item = this.options.queueManager.getItem(itemId);
    if (!item) {
      this.options.toast.error('重试失败', '队列项不存在');
      return;
    }

    // 并发控制
    if (this.retryingItems.has(itemId)) {
      log.warn(`${item.fileName} 已在重试中，跳过`);
      return;
    }

    // 「重试」是用户点的：立刻重传，不等退避、不设次数上限
    log.info(`全量重试: ${item.fileName}`);

    // 标记为重试中（界面上的花瓣与进度就是反馈，不另弹「正在重试」）
    this.retryingItems.add(itemId);
    this.options.queueManager.updateItem(itemId, { isRetrying: true });

    // 重置状态
    this.options.queueManager.resetItemForRetry(itemId);

    const enabledServices = item.enabledServices || [];
    let prepared: PreparedRetryFile | undefined;

    try {
      await ensureNetwork();
      prepared = await this.prepareRetryFile(item.filePath, enabledServices, config);
      const result = await this.uploader.uploadToMultipleServices(
        prepared.uploadPath,
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

      // 清理重试状态
      this.retryingItems.delete(itemId);
      this.options.queueManager.updateItem(itemId, { isRetrying: false });

      // 检测部分失败
      if (result.isPartialSuccess && result.partialFailures) {
        const failedServiceNames = result.partialFailures
          .map(f => getServiceDisplayName(f.serviceId, config))
          .join('、');

        this.options.toast.warn(
          '部分服务上传失败',
          `${item.fileName}: ${failedServiceNames} 上传失败，其余图床已完成`,
          5000
        );
      }

    } catch (error) {
      await this.handleFullRetryFailure(itemId, item, enabledServices, error);

      // 清理重试状态
      this.retryingItems.delete(itemId);
      this.options.queueManager.updateItem(itemId, { isRetrying: false });
    } finally {
      await prepared?.cleanup();
    }
  }

  /**
   * 处理单个服务重试成功
   */
  private async handleSingleServiceSuccess(
    itemId: string,
    serviceId: string,
    item: QueueItem,
    result: UploadResult,
    pinnedCopySource: string | undefined
  ): Promise<void> {
    const currentItem = this.options.queueManager.getItem(itemId) ?? item;
    const link = result.url;
    const metadata = mergeSuccessMetadata(serviceId, currentItem.serviceProgress[serviceId], result);

    const serviceUpdate = {
      ...currentItem.serviceProgress[serviceId],
      serviceId,
      status: '✓ 完成',
      progress: 100,
      link: link,
      isRetrying: false,
      error: undefined,
      succeededAt: Date.now(),
      ...(metadata ? { metadata } : {}),
    };

    const nextServiceProgress = {
      ...currentItem.serviceProgress,
      [serviceId]: serviceUpdate
    };
    const nextStatus = resolveQueueStatus(currentItem.enabledServices, nextServiceProgress);

    this.options.queueManager.updateItem(itemId, {
      serviceProgress: {
        [serviceId]: serviceUpdate
      },
      status: nextStatus
    });

    // 「复制时使用」：还没有可复制的链接，或这正是用户固定的图床，才改用它；不按配置顺序抢位置
    const shouldPromotePrimary = !currentItem.primaryUrl || serviceId === pinnedCopySource;
    if (shouldPromotePrimary) {
      this.options.queueManager.updateItem(itemId, { primaryUrl: link, thumbUrl: link });
    }

    // 更新历史记录
    await this.updateHistoryRecord(itemId, currentItem.filePath, serviceId, result, link, shouldPromotePrimary);
    await this.cleanupClipboardTempFileIfComplete(itemId);
  }

  /**
   * 把单个服务的重试结果写进队列项自己的历史记录
   *
   * 只认队列项的 historyId：记录不存在（首次上传全部失败，从没建过）就用这个 id 新建。
   * 不按文件路径去找——同一文件以前传过时，路径会命中那条旧记录，把它的主链接和
   * 同图床结果改掉，旧链接从历史消失、远端文件成孤儿。
   *
   * 写入走 saveHistoryItemImmediate：与首次上传共用同一把 per-id 锁和「已在则合并」
   * 逻辑，上传还没结束就点重试时两边谁先到都不丢结果。
   */
  private async updateHistoryRecord(
    itemId: string,
    filePath: string,
    serviceId: string,
    result: UploadResult,
    link: string,
    shouldPromotePrimary: boolean
  ): Promise<void> {
    let historyId = this.options.queueManager.getItem(itemId)?.historyId;
    if (!historyId) {
      // 正常不会发生：上传任务一开始就分配了 historyId。兜底为本队列项补一个，后续重试复用。
      historyId = crypto.randomUUID();
      this.options.queueManager.updateItem(itemId, { historyId });
    }

    const uploadResult: UploadResult = {
      serviceId,
      fileKey: result.fileKey || '',
      url: link,
      size: result.size,
      width: result.width,
      height: result.height,
      metadata: result.metadata
    };

    try {
      await this.historySaver.saveHistoryItemImmediate(
        filePath,
        { serviceId, status: 'success', result: uploadResult },
        historyId,
        { promotePrimary: shouldPromotePrimary }
      );
      log.info(`历史记录已更新: ${filePath} -> ${serviceId}`);
    } catch (error) {
      log.error('更新历史记录失败:', error);
      // 不阻塞主流程
    }
  }

  /**
   * 处理单个服务重试失败
   */
  private async handleSingleServiceFailure(
    itemId: string,
    serviceId: string,
    item: QueueItem,
    error: unknown,
    silentToast: boolean = false,
    config?: UserConfig
  ): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`${serviceId} 失败:`, errorMsg);

    const currentItem = this.options.queueManager.getItem(itemId) ?? item;
    const serviceUpdate = {
      ...currentItem.serviceProgress[serviceId],
      serviceId,
      status: '✗ 失败',
      progress: 0,
      error: errorMsg,
      isRetrying: false
    };

    this.options.queueManager.updateItem(itemId, {
      serviceProgress: {
        [serviceId]: serviceUpdate
      }
    });

    const latestItem = this.options.queueManager.getItem(itemId);
    if (latestItem) {
      const nextStatus = resolveQueueStatus(latestItem.enabledServices, latestItem.serviceProgress);
      if (latestItem.status !== nextStatus) {
        this.options.queueManager.updateItem(itemId, { status: nextStatus });
      }
    }

    if (!silentToast) {
      const failure = describeUploadFailure(serviceId, errorMsg, { cookieLogin: isCookieHost(serviceId) });
      this.options.toast.error(`${getServiceDisplayName(serviceId, config)}上传失败`, `${failure.reason}，${failure.advice}`);
    }
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
          const link = serviceResult.result.url;
          const metadata = mergeSuccessMetadata(
            serviceResult.serviceId,
            updatedServiceProgress[serviceResult.serviceId],
            serviceResult.result
          );

          updatedServiceProgress[serviceResult.serviceId] = {
            ...updatedServiceProgress[serviceResult.serviceId],
            serviceId: serviceResult.serviceId,
            status: '✓ 完成',
            progress: 100,
            link,
            ...(metadata ? { metadata } : {}),
          };
        } else if (serviceResult.status === 'failed') {
          updatedServiceProgress[serviceResult.serviceId] = {
            ...updatedServiceProgress[serviceResult.serviceId],
            serviceId: serviceResult.serviceId,
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
    this.options.queueManager.markItemComplete(itemId, result.primaryUrl);

    // 保存历史记录
    // Why: 必须传 item.historyId，否则 saveHistoryItem 内部 fallback 到
    // crypto.randomUUID() 会插出新记录，造成同一文件在历史里出现两条孤儿条目。
    // resetItemForRetry 不会清掉 historyId，所以这里始终能拿到原始 ID。
    await this.options.saveHistoryItem(item.filePath, result, item.historyId);
    await this.cleanupClipboardTempFileIfComplete(itemId);
  }

  /**
   * 批量重试所有失败的队列项（只重试失败的服务，不重传已成功的）
   * @param failedItemIds 包含失败服务的队列项 ID 列表
   * @param config 用户配置
   * @returns 重试结果统计
   */
  async retryAllFailed(
    failedItemIds: string[],
    config: UserConfig
  ): Promise<{ success: number; failed: number }> {
    if (failedItemIds.length === 0) {
      return { success: 0, failed: 0 };
    }

    // 收集所有需要重试的服务
    const retryTasks: { itemId: string; serviceId: string }[] = [];
    for (const itemId of failedItemIds) {
      const item = this.options.queueManager.getItem(itemId);
      if (item) {
        const failedServices = getFailedServices(item);
        for (const serviceId of failedServices) {
          retryTasks.push({ itemId, serviceId });
        }
      }
    }

    if (retryTasks.length === 0) {
      return { success: 0, failed: 0 };
    }

    log.info(`开始重传 ${retryTasks.length} 个失败的图床`);

    // 并发执行所有重试（只重试失败的服务）；网络不通时每一项各自按失败收口，写清原因
    const results = await Promise.allSettled(
      retryTasks.map(({ itemId, serviceId }) =>
        this.retrySingleService(itemId, serviceId, config, { silentToast: true })
      )
    );

    // 统计结果
    let successCount = 0;
    let failedCount = 0;

    results.forEach((_, index) => {
      const { itemId, serviceId } = retryTasks[index];
      const item = this.options.queueManager.getItem(itemId);
      if (item?.serviceProgress?.[serviceId]) {
        const status = item.serviceProgress[serviceId].status || '';
        if (status.includes('完成') || status.includes('✓')) {
          successCount++;
        } else {
          failedCount++;
        }
      } else {
        failedCount++;
      }
    });

    // 显示结果
    if (failedCount === 0) {
      this.options.toast.success(
        '批量重传完成',
        `重传结果：成功 ${successCount}，失败 ${failedCount}。`
      );
    } else if (successCount === 0) {
      this.options.toast.error(
        '批量重传失败',
        `重传结果：成功 ${successCount}，失败 ${failedCount}。`,
        5000
      );
    } else {
      this.options.toast.warn(
        '批量重传部分完成',
        `重传结果：成功 ${successCount}，失败 ${failedCount}。`,
        5000
      );
    }

    log.info(`完成: ${successCount} 成功, ${failedCount} 失败`);
    return { success: successCount, failed: failedCount };
  }

  /**
   * 处理全量重试失败
   */
  private async handleFullRetryFailure(
    itemId: string,
    item: QueueItem,
    enabledServices: string[],
    error: unknown
  ): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`${item.fileName} 上传失败:`, errorMsg);

    // 每个图床记它自己的原因；通知按第一个失败的图床写「原因 + 处理办法」（交接说明第 9 节）
    const ownReasons = reasonsByService(errorMsg);
    const [firstHost, firstReason] = ownReasons.entries().next().value ?? [enabledServices[0], errorMsg];
    const failure = describeUploadFailure(firstHost, firstReason, { cookieLogin: isCookieHost(firstHost) });
    this.options.toast.error(`${item.fileName} 上传失败`, `${failure.reason}，${failure.advice}`, 5000);

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
            error: ownReasons.get(serviceId) ?? errorMsg
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
