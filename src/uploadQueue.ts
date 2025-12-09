// src/uploadQueue.ts
/**
 * 上传队列管理器 (Vue 3 Refactor - 多图床架构)
 * 负责管理可视化的上传队列UI和上传进度
 */

import { createApp, App } from 'vue';
import UploadQueueVue from './components/UploadQueue.vue';
import { appState } from './appState';
import { ServiceType } from './config/types';
import { useQueueState } from './composables/useQueueState';

/**
 * 单个图床服务的进度状态
 */
export interface ServiceProgress {
  serviceId: ServiceType;
  progress: number;  // 0-100
  status: string;    // 状态文本
  link?: string;     // 上传成功后的链接
  error?: string;    // 错误信息
  metadata?: Record<string, any>;  // 额外元数据（如微博 PID）
}

/**
 * 队列项类型定义（新架构 - 支持多图床）
 */
export interface QueueItem {
  id: string;
  fileName: string;
  filePath: string;
  enabledServices: ServiceType[];  // 启用的图床列表
  serviceProgress: Record<ServiceType, ServiceProgress>;  // 各图床独立进度
  status: 'pending' | 'uploading' | 'success' | 'error';
  errorMessage?: string;
  primaryUrl?: string;  // 主力图床的URL
  thumbUrl?: string;

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
export type UploadProgressCallback = (progress: {
  type: 'weibo_progress' | 'r2_progress' | 'weibo_success' | 'r2_success' | 'error' | 'complete';
  payload: any;
}) => void;

/**
 * 上传队列管理器类
 */
export class UploadQueueManager {
  private app: App | null = null;
  private vm: InstanceType<typeof UploadQueueVue> | null = null;
  private queueState = useQueueState();  // 新架构：使用全局状态管理

  constructor(queueListElementId?: string) {
    // 新架构：如果没有提供 elementId，说明组件已经通过 Vue 模板挂载
    // 只需要提供数据管理功能，不需要挂载组件
    if (queueListElementId) {
      const el = document.getElementById(queueListElementId);
      if (!el) {
        console.error(`[UploadQueue] 队列列表元素不存在: ${queueListElementId}`);
        throw new Error(`Element #${queueListElementId} not found`);
      }

      // Mount Vue App (仅旧架构使用)
      this.app = createApp(UploadQueueVue);
      this.vm = this.app.mount(el) as InstanceType<typeof UploadQueueVue>;
    } else {
      console.log('[UploadQueue] 使用新架构模式 - 组件由 Vue 模板管理');
    }
  }

  /**
   * 检查文件是否已在队列中（排除失败的项）
   * @param filePath 文件路径
   * @returns 是否存在重复（仅允许失败项重新上传）
   */
  private isFileInQueue(filePath: string): boolean {
    const allItems = this.vm ? this.vm.getAllItems() : this.queueState.queueItems.value;
    // 只检查 pending、uploading 和 success 状态的项
    // 失败(error)的项不算重复，允许重新上传
    return allItems.some(item =>
      item.filePath === filePath &&
      (item.status === 'pending' || item.status === 'uploading' || item.status === 'success')
    );
  }

  /**
   * 获取队列中相同文件的数量
   * @param filePath 文件路径
   * @returns 重复文件数量
   */
  private getDuplicateCount(filePath: string): number {
    const allItems = this.vm ? this.vm.getAllItems() : this.queueState.queueItems.value;
    return allItems.filter(item => item.filePath === filePath).length;
  }

  /**
   * 添加文件到队列（新架构 - 多图床支持）
   */
  addFile(filePath: string, fileName: string, enabledServices: ServiceType[]): string | null {
    // 检查重复
    if (this.isFileInQueue(filePath)) {
      const duplicateCount = this.getDuplicateCount(filePath);
      console.warn(`[UploadQueue] 文件已在队列中: ${fileName} (重复次数: ${duplicateCount})`);
      return null; // 返回 null 表示重复，不添加到队列
    }

    const id = `queue-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // 初始化每个图床的进度状态
    const serviceProgress: Record<string, ServiceProgress> = {};
    enabledServices.forEach(serviceId => {
      serviceProgress[serviceId] = {
        serviceId,
        progress: 0,
        status: '等待中...'
      };
    });

    const item: QueueItem = {
      id,
      fileName,
      filePath,
      enabledServices: [...enabledServices],  // 创建数组副本,避免引用共享
      serviceProgress: serviceProgress as Record<ServiceType, ServiceProgress>,
      status: 'pending',
      // 向后兼容
      uploadToR2: enabledServices.includes('r2'),
      weiboProgress: 0,
      r2Progress: 0,
      weiboStatus: '等待中...',
      r2Status: enabledServices.includes('r2') ? '等待中...' : '已跳过',
    };

    // 根据架构模式选择添加方式
    if (this.vm) {
      this.vm.addFile(item);
    } else {
      this.queueState.addItem(item);
    }

    console.log(`[UploadQueue] 添加文件到队列: ${fileName} (图床: ${enabledServices.join(', ')})`);
    return id;
  }

  /**
   * 更新某个图床的上传进度
   */
  updateServiceProgress(
    itemId: string,
    serviceId: ServiceType,
    percent: number,
    step?: string,
    stepIndex?: number,
    totalSteps?: number
  ): void {
    const item = this.getItem(itemId);
    if (!item) {
      console.warn(`[UploadQueue] 找不到队列项: ${itemId}`);
      return;
    }

    const safePercent = Math.max(0, Math.min(100, percent));

    // 构建状态文本
    let statusText = `${safePercent}%`;
    if (step && stepIndex && totalSteps) {
      // 显示步骤信息，例如："获取凭证中... (1/2)"
      statusText = `${step} (${stepIndex}/${totalSteps})`;
    }

    const updates: Partial<QueueItem> = {
      status: 'uploading',
      serviceProgress: {
        ...item.serviceProgress,
        [serviceId]: {
          ...item.serviceProgress[serviceId],
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

    // 向后兼容
    if (serviceId === 'weibo') {
      updates.weiboProgress = safePercent;
      updates.weiboStatus = statusText;
    } else if (serviceId === 'r2') {
      updates.r2Progress = safePercent;
      updates.r2Status = statusText;
    }

    this.updateItem(itemId, updates);
  }

  /**
   * 标记队列项上传成功
   */
  markItemComplete(itemId: string, primaryUrl: string): void {
    const item = this.getItem(itemId);
    if (!item) {
      console.warn(`[UploadQueue] 找不到队列项: ${itemId}`);
      return;
    }

    // 更新成功的图床状态
    const serviceProgress = { ...item.serviceProgress };
    item.enabledServices.forEach((serviceId: ServiceType) => {
      if (serviceProgress[serviceId]?.progress === 100) {
        serviceProgress[serviceId] = {
          ...serviceProgress[serviceId],
          status: '✓ 完成'
        };
      }
    });

    // 设置缩略图 URL（使用主力图床的 URL）
    const thumbUrl = primaryUrl;

    // 根据启用的服务设置对应的链接字段
    const linkFields: any = {
      thumbUrl,
      primaryUrl
    };

    item.enabledServices.forEach((serviceId: ServiceType) => {
      const serviceLink = serviceProgress[serviceId]?.link;
      if (serviceLink) {
        // 设置各个服务的链接字段
        if (serviceId === 'weibo') {
          linkFields.weiboLink = serviceLink;
          // 从 serviceProgress 中获取 PID（如果有的话）
          const weiboPid = serviceProgress[serviceId]?.metadata?.pid;
          if (weiboPid) {
            linkFields.weiboPid = weiboPid;
          }
        } else if (serviceId === 'r2') {
          linkFields.r2Link = serviceLink;
        } else if (serviceId === 'tcl') {
          linkFields.tclLink = serviceLink;
        }
      }
    });

    this.updateItem(itemId, {
      status: 'success',
      serviceProgress,
      ...linkFields,
      weiboStatus: item.enabledServices.includes('weibo') ? '✓ 完成' : '已跳过',  // 向后兼容
      r2Status: item.enabledServices.includes('r2') ? '✓ 完成' : '已跳过'
    });

    console.log(`[UploadQueue] ${item.fileName} 上传成功`);
  }

  /**
   * 标记队列项上传失败
   */
  markItemFailed(itemId: string, errorMessage: string): void {
    const item = this.getItem(itemId);
    if (!item) {
      console.warn(`[UploadQueue] 找不到队列项: ${itemId}`);
      return;
    }

    this.updateItem(itemId, {
      status: 'error',
      errorMessage,
      weiboStatus: '✗ 失败',  // 向后兼容
    });

    console.error(`[UploadQueue] ${item.fileName} 上传失败: ${errorMessage}`);
  }

  /**
   * 创建进度回调函数
   */
  createProgressCallback(itemId: string): UploadProgressCallback {
    return (progress) => {
      const updates: Partial<QueueItem> = {};

      switch (progress.type) {
        case 'weibo_progress':
          const weiboPercent = Math.max(0, Math.min(100, Number(progress.payload) || 0));
          updates.weiboProgress = weiboPercent;
          updates.weiboStatus = `${weiboPercent}%`;
          updates.status = 'uploading';
          break;

        case 'weibo_success':
          updates.weiboProgress = 100;
          updates.weiboStatus = '✓ 完成';
          updates.weiboPid = progress.payload.pid;
          updates.weiboLink = progress.payload.largeUrl;
          updates.baiduLink = progress.payload.baiduLink;
          break;

        case 'r2_progress':
          const r2Percent = Math.max(0, Math.min(100, Number(progress.payload) || 0));
          updates.r2Progress = r2Percent;
          updates.r2Status = `${r2Percent}%`;
          break;

        case 'r2_success':
          updates.r2Progress = 100;
          updates.r2Status = '✓ 完成';
          updates.r2Link = progress.payload.r2Link;
          appState.isR2Dirty = true;
          break;

        case 'error':
          updates.status = 'error';
          updates.errorMessage = progress.payload;

          const currentItem = this.getItem(itemId);
          if (currentItem) {
             if (currentItem.weiboProgress < 100) {
                 updates.weiboStatus = '✗ 失败';
             } else if (currentItem.uploadToR2 && currentItem.r2Progress < 100) {
                 updates.r2Status = '✗ 失败';
             }
          }
          break;

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
    if (this.vm) {
      this.vm.clear();
    } else {
      this.queueState.clearQueue();
    }
    console.log('[UploadQueue] 队列已清空');
  }

  /**
   * 获取队列大小
   */
  getQueueSize(): number {
    if (this.vm) {
      return this.vm.count();
    } else {
      return this.queueState.queueItems.value.length;
    }
  }

  /**
   * 获取队列项
   */
  getItem(itemId: string): QueueItem | undefined {
    if (this.vm) {
      return this.vm.getItem(itemId);
    } else {
      return this.queueState.getItem(itemId);
    }
  }

  /**
   * 更新队列项
   */
  updateItem(itemId: string, updates: Partial<QueueItem>): void {
    if (this.vm) {
      this.vm.updateItem(itemId, updates);
    } else {
      this.queueState.updateItem(itemId, updates);
    }
  }

  /**
   * 重置队列项状态（用于重试 - 支持新架构）
   */
  resetItemForRetry(itemId: string): void {
    const item = this.getItem(itemId);
    if (!item) {
      console.warn(`[UploadQueue] 重试失败: 找不到队列项 ${itemId}`);
      return;
    }

    // 重置所有字段，包括新架构的 serviceProgress
    const resetServiceProgress: Record<string, ServiceProgress> = {};
    if (item.enabledServices) {
      item.enabledServices.forEach(serviceId => {
        resetServiceProgress[serviceId] = {
          progress: 0,
          status: '等待中...',
          link: undefined,
          error: undefined
        };
      });
    }

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

    console.log(`[UploadQueue] ${item.fileName} 已重置为重试状态`);
  }

  /**
   * 设置重试回调
   */
  setRetryCallback(callback: (itemId: string) => void): void {
    if (this.vm && typeof this.vm.setRetryCallback === 'function') {
      this.vm.setRetryCallback(callback);
    }
  }
}
