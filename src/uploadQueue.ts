/**
 * 上传队列管理器 (Vue 3 Refactor - 多图床架构)
 * 负责管理可视化的上传队列UI和上传进度
 */

import { useQueueState } from './composables/useQueueState';
import { createLogger } from './utils/logger';

const log = createLogger('UploadQueue');

/**
 * 单个图床服务的进度状态
 */
export interface ServiceProgress {
  serviceId: string;
  progress: number;  // 0-100
  status: string;    // 状态文本
  link?: string;     // 上传成功后的链接
  error?: string;    // 错误信息
  metadata?: Record<string, unknown>;  // 额外元数据（如微博 PID）
  isRetrying?: boolean; // 是否正在重试中
}

/**
 * 微博上传成功时的 payload 结构
 */
interface WeiboSuccessPayload {
  pid: string;
  largeUrl: string;
  baiduLink?: string;
}

/**
 * R2 上传成功时的 payload 结构
 */
interface R2SuccessPayload {
  r2Link: string;
}

/**
 * 上传进度事件的判别联合类型
 */
export type UploadProgressEvent =
  | { type: 'weibo_progress'; payload: number }
  | { type: 'r2_progress'; payload: number }
  | { type: 'weibo_success'; payload: WeiboSuccessPayload }
  | { type: 'r2_success'; payload: R2SuccessPayload }
  | { type: 'error'; payload: string }
  | { type: 'complete'; payload?: unknown };

/**
 * 队列项类型定义（新架构 - 支持多图床）
 */
export interface QueueItem {
  id: string;
  fileName: string;
  filePath: string;
  enabledServices: string[];  // 启用的图床列表
  serviceProgress: Partial<Record<string, ServiceProgress>>;  // 各图床独立进度
  status: 'pending' | 'uploading' | 'success' | 'error';
  errorMessage?: string;
  primaryUrl?: string;  // 主力图床的URL
  thumbUrl?: string;

  // 新增：重试相关字段
  retryCount?: number;        // 当前重试次数（默认 0）
  maxRetries?: number;        // 最大重试次数（默认 3）
  lastRetryTime?: number;     // 上次重试时间戳
  isRetrying?: boolean;       // 是否正在重试中

  // 向后兼容字段（可选，供旧UI使用）
  uploadToR2?: boolean;
  weiboProgress?: number;
  r2Progress?: number;
  weiboStatus?: string;
  r2Status?: string;
  weiboPid?: string;
  weiboLink?: string;
  baiduLink?: string;
  r2Link?: string;
}

/**
 * 上传进度回调类型
 */
export type UploadProgressCallback = (progress: UploadProgressEvent) => void;

/**
 * 上传队列管理器类
 */
/**
 * 为每个启用的图床创建初始进度状态
 */
function createServiceProgress(enabledServices: string[]): Record<string, ServiceProgress> {
  return Object.fromEntries(
    enabledServices.map(s => [s, { serviceId: s, progress: 0, status: '等待中...' }])
  );
}

/**
 * 从队列项的 serviceProgress 中提取各服务的链接字段（向后兼容）
 */
function buildLinkFields(item: QueueItem): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const serviceId of item.enabledServices) {
    const serviceLink = item.serviceProgress[serviceId]?.link;
    if (!serviceLink) continue;
    if (serviceId === 'weibo') {
      fields.weiboLink = serviceLink;
      const weiboPid = item.serviceProgress[serviceId]?.metadata?.pid;
      if (typeof weiboPid === 'string') fields.weiboPid = weiboPid;
    } else if (serviceId === 'r2') {
      fields.r2Link = serviceLink;
    }
  }
  return fields;
}

export class UploadQueueManager {
  private queueState = useQueueState();  // 统一使用全局状态管理

  constructor() {
    log.debug('初始化队列管理器（新架构）');
  }

  /**
   * 检查文件是否正在上传中
   * @param filePath 文件路径
   * @returns 是否正在上传（pending/uploading 状态），已完成的项允许再次上传
   */
  private isFileInQueue(filePath: string): boolean {
    const allItems = this.queueState.queueItems.value;
    // 只检查 pending 和 uploading 状态的项
    // 成功(success)和失败(error)的项不算重复，允许再次上传
    return allItems.some(item =>
      item.filePath === filePath &&
      (item.status === 'pending' || item.status === 'uploading')
    );
  }

  /**
   * 获取队列中相同文件的数量
   * @param filePath 文件路径
   * @returns 重复文件数量
   */
  private getDuplicateCount(filePath: string): number {
    const allItems = this.queueState.queueItems.value;
    return allItems.filter(item => item.filePath === filePath).length;
  }

  /**
   * 添加文件到队列（新架构 - 多图床支持）
   */
  addFile(filePath: string, fileName: string, enabledServices: string[]): string | null {
    // 检查重复
    if (this.isFileInQueue(filePath)) {
      const duplicateCount = this.getDuplicateCount(filePath);
      log.warn(`文件已在队列中: ${fileName} (重复次数: ${duplicateCount})`);
      return null; // 返回 null 表示重复，不添加到队列
    }

    const id = `queue-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // 初始化每个图床的进度状态
    const serviceProgress = createServiceProgress(enabledServices);

    const item: QueueItem = {
      id,
      fileName,
      filePath,
      enabledServices: [...enabledServices],  // 创建数组副本,避免引用共享
      serviceProgress: serviceProgress as Record<string, ServiceProgress>,
      status: 'pending',
      // 新增：初始化重试相关字段
      retryCount: 0,
      maxRetries: 3,
      lastRetryTime: undefined,
      isRetrying: false,
      // 向后兼容
      uploadToR2: enabledServices.includes('r2'),
      weiboProgress: 0,
      r2Progress: 0,
      weiboStatus: '等待中...',
      r2Status: enabledServices.includes('r2') ? '等待中...' : '已跳过',
    };

    // 添加到队列
    this.queueState.addItem(item);

    log.debug(`添加文件到队列: ${fileName} (图床: ${enabledServices.join(', ')})`);
    return id;
  }

  /**
   * 更新某个图床的上传进度（简化版，使用 CSS transition）
   */
  updateServiceProgress(
    itemId: string,
    serviceId: string,
    percent: number,
    step?: string,
    stepIndex?: number,
    totalSteps?: number
  ): void {
    const item = this.getItem(itemId);
    if (!item) {
      log.warn(`找不到队列项: ${itemId}`);
      return;
    }

    const safePercent = Math.max(0, Math.min(100, percent));

    // 构建状态文本
    let statusText = `${Math.round(safePercent)}%`;
    if (step && stepIndex && totalSteps) {
      statusText = `${step} (${stepIndex}/${totalSteps})`;
    } else if (step) {
      statusText = step;
    }

    // 修复竞态条件：只更新当前服务的进度，不覆盖其他服务的状态
    // updateItem 会自动做深度合并，所以只需传递要更新的服务即可
    const updates: Partial<QueueItem> = {
      serviceProgress: {
        [serviceId]: {
          ...item.serviceProgress[serviceId],
          serviceId,
          progress: safePercent,
          status: statusText,
          metadata: {
            ...item.serviceProgress[serviceId]?.metadata,
            step: step,
            stepIndex: stepIndex,
            totalSteps: totalSteps
          }
        }
      }
    };

    // 如果整体状态是 error，且收到进度更新，说明正在重试，改为 uploading
    if (item.status === 'error') {
      updates.status = 'uploading';
    } else if (item.status !== 'success') {
      updates.status = 'uploading';
    }

    // 向后兼容
    if (serviceId === 'weibo') {
      updates.weiboProgress = safePercent;
      updates.weiboStatus = statusText;
    } else if (serviceId === 'r2') {
      updates.r2Progress = safePercent;
      updates.r2Status = statusText;
    }

    // 使用节流更新，合并同一帧内的多次进度更新
    this.updateItemThrottled(itemId, updates);
  }

  /**
   * 标记队列项上传成功
   * 修复竞态条件：只更新需要更新的服务，不覆盖其他服务的并发更新
   */
  markItemComplete(itemId: string, primaryUrl: string): void {
    const item = this.getItem(itemId);
    if (!item) {
      log.warn(`找不到队列项: ${itemId}`);
      return;
    }

    // 关键：清除所有待处理的节流更新，防止过时的进度更新覆盖成功状态
    this.queueState.clearPendingUpdatesForItem(itemId);

    // 修复竞态条件：只构建需要更新的服务进度
    // 不再使用 { ...item.serviceProgress } 展开全部，避免覆盖并发更新
    const serviceProgressUpdates: Record<string, ServiceProgress> = {};

    item.enabledServices.forEach((serviceId: string) => {
      const currentProgress = item.serviceProgress[serviceId];
      const currentStatus = currentProgress?.status || '';
      // 只标记那些进度为100且不是失败状态的服务
      if (currentProgress?.progress === 100 && !currentStatus.includes('失败') && !currentStatus.includes('✗')) {
        serviceProgressUpdates[serviceId] = {
          ...currentProgress,
          status: '✓ 完成',
          isRetrying: false // 清除重试标记
        };
      } else if ((currentProgress?.progress ?? 0) === 0 && currentStatus === '等待中...') {
        // 上传到此处仍是初始 '等待中...' 状态 = 该服务被 filterConfiguredServices 过滤、从未启动过 task
        // 此时整体上传已成功（至少一个图床成功才会进 markItemComplete），把未启动的服务标为已跳过，避免 UI 永远卡在 '等待中...'
        serviceProgressUpdates[serviceId] = {
          ...currentProgress,
          serviceId,
          progress: 0,
          status: '已跳过（未配置）',
          isRetrying: false
        };
      }
    });

    // 设置缩略图 URL（使用主力图床的 URL）
    const thumbUrl = primaryUrl;

    // 根据启用的服务设置对应的链接字段
    const latestItem = this.getItem(itemId);
    const linkFields: Record<string, string> = {
      thumbUrl,
      primaryUrl,
      ...(latestItem ? buildLinkFields(latestItem) : {})
    };

    // 只传递需要更新的服务进度，让 updateItem 做深度合并
    this.updateItem(itemId, {
      status: 'success',
      serviceProgress: serviceProgressUpdates,
      ...linkFields,
      weiboStatus: item.enabledServices.includes('weibo') ? '✓ 完成' : '已跳过',  // 向后兼容
      r2Status: item.enabledServices.includes('r2') ? '✓ 完成' : '已跳过'
    });

    log.debug(`${item.fileName} 上传成功`);

    // 【内存优化】自动修剪队列，保留最近 500 条已完成记录
    // 注：单次上传上限 200 张，500 确保至少 2 批完整上传记录不被裁剪
    this.trimQueue(500);
  }

  /**
   * 标记队列项上传失败
   */
  markItemFailed(itemId: string, errorMessage: string): void {
    const item = this.getItem(itemId);
    if (!item) {
      log.warn(`找不到队列项: ${itemId}`);
      return;
    }

    // 关键：清除所有待处理的节流更新，防止过时的进度更新覆盖失败状态
    this.queueState.clearPendingUpdatesForItem(itemId);

    this.updateItem(itemId, {
      status: 'error',
      errorMessage,
      weiboStatus: '✗ 失败',  // 向后兼容
    });

    log.error(`${item.fileName} 上传失败: ${errorMessage}`);
  }

  /**
   * 创建进度回调函数
   */
  createProgressCallback(itemId: string): UploadProgressCallback {
    return (progress) => {
      const updates: Partial<QueueItem> = {};

      switch (progress.type) {
        case 'weibo_progress': {
          const weiboPercent = Math.max(0, Math.min(100, Number(progress.payload) || 0));
          updates.weiboProgress = weiboPercent;
          updates.weiboStatus = `${weiboPercent}%`;
          updates.status = 'uploading';
          break;
        }

        case 'weibo_success':
          updates.weiboProgress = 100;
          updates.weiboStatus = '✓ 完成';
          updates.weiboPid = progress.payload.pid;
          updates.weiboLink = progress.payload.largeUrl;
          updates.baiduLink = progress.payload.baiduLink;
          break;

        case 'r2_progress': {
          const r2Percent = Math.max(0, Math.min(100, Number(progress.payload) || 0));
          updates.r2Progress = r2Percent;
          updates.r2Status = `${r2Percent}%`;
          break;
        }

        case 'r2_success':
          updates.r2Progress = 100;
          updates.r2Status = '✓ 完成';
          updates.r2Link = progress.payload.r2Link;
          break;

        case 'error': {
          updates.status = 'error';
          updates.errorMessage = progress.payload;

          const currentItem = this.getItem(itemId);
          if (currentItem) {
            if ((currentItem.weiboProgress ?? 0) < 100) {
              updates.weiboStatus = '✗ 失败';
            } else if (currentItem.uploadToR2 && (currentItem.r2Progress ?? 0) < 100) {
              updates.r2Status = '✗ 失败';
            }
          }
          break;
        }

        case 'complete':
          updates.status = 'success';
          break;
      }

      this.updateItem(itemId, updates);
    };
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
    this.queueState.clearQueue();
    log.debug('队列已清空');
  }

  /**
   * 获取队列大小
   */
  getQueueSize(): number {
    return this.queueState.queueItems.value.length;
  }

  /**
   * 获取队列项
   */
  getItem(itemId: string): QueueItem | undefined {
    return this.queueState.getItem(itemId);
  }

  /**
   * 更新队列项
   */
  updateItem(itemId: string, updates: Partial<QueueItem>): void {
    this.queueState.updateItem(itemId, updates);
  }

  /**
   * 节流更新队列项（用于高频进度更新）
   * 使用 requestAnimationFrame 合并同一帧内的多次更新
   */
  updateItemThrottled(itemId: string, updates: Partial<QueueItem>): void {
    this.queueState.updateItemThrottled(itemId, updates);
  }

  /**
   * 重置队列项状态（用于重试 - 支持新架构）
   */
  resetItemForRetry(itemId: string): void {
    const item = this.getItem(itemId);
    if (!item) {
      log.warn(`重试失败: 找不到队列项 ${itemId}`);
      return;
    }

    // 重置所有字段，包括新架构的 serviceProgress
    const resetServiceProgress = item.enabledServices
      ? createServiceProgress(item.enabledServices)
      : {};

    // 重置状态
    this.updateItem(itemId, {
      status: 'pending',
      // 旧架构字段
      weiboProgress: 0,
      r2Progress: 0,
      weiboStatus: '等待中...',
      r2Status: item.uploadToR2 ? '等待中...' : '已跳过',
      weiboLink: undefined,
      r2Link: undefined,
      baiduLink: undefined,
      weiboPid: undefined,
      // 新架构字段
      serviceProgress: resetServiceProgress,
      primaryUrl: undefined,
      thumbUrl: undefined,
      errorMessage: undefined,
    });

    log.debug(`${item.fileName} 已重置为全量重试状态`);
  }

  /**
   * 重置单个服务的状态（用于单独重试）
   */
  resetServiceForRetry(itemId: string, serviceId: string): void {
    const item = this.getItem(itemId);
    if (!item || !item.serviceProgress[serviceId]) {
      log.warn(`重试失败: 找不到服务 ${serviceId}`);
      return;
    }

    // 修复竞态条件：只更新当前服务的状态，不覆盖其他服务的状态
    const updates: Partial<QueueItem> = {
      serviceProgress: {
        [serviceId]: {
          ...item.serviceProgress[serviceId],
          progress: 0,
          status: '等待中...',
          error: undefined,
          isRetrying: true // 标记为重试中
        }
      }
    };

    // 如果是单独重试，且当前整体状态是 error，临时改为 uploading 以避免 UI 显示红色左边框
    if (item.status === 'error') {
      updates.status = 'uploading';
    }

    this.updateItem(itemId, updates);
    log.debug(`${item.fileName} - ${serviceId} 已重置为单独重试状态`);
  }

  /**
   * 设置重试回调（保留接口兼容性）
   */
  setRetryCallback(_callback: (itemId: string, serviceId?: string) => void): void {
    // 在新架构中，重试回调直接在 UploadView 中处理
    // 这里保留方法以保持接口兼容
    log.debug('重试回调将由 UploadView 处理');
  }

  /**
   * 【内存优化】修剪队列，保留最近的 N 条已完成项目
   * @param maxSize 最大保留数量，默认 100
   */
  trimQueue(maxSize: number = 100): void {
    const items = this.queueState.queueItems.value;

    // 筛选已完成的项目（success 或 error）
    const completedItems = items.filter(
      item => item.status === 'success' || item.status === 'error'
    );

    // 如果已完成项目超过限制，删除最旧的
    if (completedItems.length > maxSize) {
      // 队列是按时间倒序排列的（最新在前），所以取后面的删除
      const itemsToRemove = completedItems.slice(maxSize);
      const idsToRemove = new Set(itemsToRemove.map(item => item.id));

      // 一次性过滤，只触发一次 Vue 响应式更新
      this.queueState.queueItems.value = items.filter(item => !idsToRemove.has(item.id));

      log.debug(`内存优化: 已删除 ${itemsToRemove.length} 条旧记录，保留最近 ${maxSize} 条`);
    }
  }
}
