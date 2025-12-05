// src/uploadQueue.ts
/**
 * 上传队列管理器 (Vue 3 Refactor - 多图床架构)
 * 负责管理可视化的上传队列UI和上传进度
 */

import { createApp, App } from 'vue';
import UploadQueueVue from './components/UploadQueue.vue';
import { appState } from './main';
import { ServiceType } from './config/types';

/**
 * 单个图床服务的进度状态
 */
export interface ServiceProgress {
  serviceId: ServiceType;
  progress: number;  // 0-100
  status: string;    // 状态文本
  link?: string;     // 上传成功后的链接
  error?: string;    // 错误信息
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
  private app: App;
  private vm: InstanceType<typeof UploadQueueVue> | null = null;

  constructor(queueListElementId: string) {
    const el = document.getElementById(queueListElementId);
    if (!el) {
      console.error(`[UploadQueue] 队列列表元素不存在: ${queueListElementId}`);
      throw new Error(`Element #${queueListElementId} not found`);
    }
    
    // Mount Vue App
    this.app = createApp(UploadQueueVue);
    this.vm = this.app.mount(el);
  }

  /**
   * 添加文件到队列（新架构 - 多图床支持）
   */
  addFile(filePath: string, fileName: string, enabledServices: ServiceType[]): string {
    const id = `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
      enabledServices,
      serviceProgress: serviceProgress as Record<ServiceType, ServiceProgress>,
      status: 'pending',
      // 向后兼容
      uploadToR2: enabledServices.includes('r2'),
      weiboProgress: 0,
      r2Progress: 0,
      weiboStatus: '等待中...',
      r2Status: enabledServices.includes('r2') ? '等待中...' : '已跳过',
    };

    this.vm.addFile(item);

    console.log(`[UploadQueue] 添加文件到队列: ${fileName} (图床: ${enabledServices.join(', ')})`);
    return id;
  }

  /**
   * 更新某个图床的上传进度
   */
  updateServiceProgress(itemId: string, serviceId: ServiceType, percent: number): void {
    const item = this.vm.getItem(itemId);
    if (!item) {
      console.warn(`[UploadQueue] 找不到队列项: ${itemId}`);
      return;
    }

    const safePercent = Math.max(0, Math.min(100, percent));

    const updates: Partial<QueueItem> = {
      status: 'uploading',
      serviceProgress: {
        ...item.serviceProgress,
        [serviceId]: {
          ...item.serviceProgress[serviceId],
          progress: safePercent,
          status: `${safePercent}%`
        }
      }
    };

    // 向后兼容
    if (serviceId === 'weibo') {
      updates.weiboProgress = safePercent;
      updates.weiboStatus = `${safePercent}%`;
    } else if (serviceId === 'r2') {
      updates.r2Progress = safePercent;
      updates.r2Status = `${safePercent}%`;
    }

    this.vm.updateItem(itemId, updates);
  }

  /**
   * 标记队列项上传成功
   */
  markItemComplete(itemId: string, primaryUrl: string): void {
    const item = this.vm.getItem(itemId);
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

    this.vm.updateItem(itemId, {
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
    const item = this.vm.getItem(itemId);
    if (!item) {
      console.warn(`[UploadQueue] 找不到队列项: ${itemId}`);
      return;
    }

    this.vm.updateItem(itemId, {
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
      // We get the item from Vue to check current state if needed, but mostly we just push updates
      // Since we can't easily sync read from Vue proxy in this callback structure without reference,
      // we will just dispatch updates to Vue.
      
      const updates: Partial<QueueItem> = {};

      switch (progress.type) {
        case 'weibo_progress':
          // 确保 payload 是数字，并限制在 0-100 范围内
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
          // 确保 payload 是数字，并限制在 0-100 范围内
          const r2Percent = Math.max(0, Math.min(100, Number(progress.payload) || 0));
          updates.r2Progress = r2Percent;
          updates.r2Status = `${r2Percent}%`;
          break;

        case 'r2_success':
          updates.r2Progress = 100;
          updates.r2Status = '✓ 完成';
          updates.r2Link = progress.payload.r2Link;
          // [v2.6 优化] 标记 R2 数据已变更
          appState.isR2Dirty = true;
          break;

        case 'error':
          updates.status = 'error';
          updates.errorMessage = progress.payload;
          
          // Helper to decide which part failed
          // We need current state to know which step failed strictly, 
          // but we can infer or just set status.
          // Simplification: Just set error message and Vue component will show it.
          // But to update specific column status:
          // We assume if weiboProgress < 100 it's weibo error
          const currentItem = this.vm.getItem(itemId);
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

      this.vm.updateItem(itemId, updates);
    };
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
    this.vm.clear();
    console.log('[UploadQueue] 队列已清空');
  }

  /**
   * 获取队列大小
   */
  getQueueSize(): number {
    return this.vm.count();
  }

  /**
   * 获取队列项
   */
  getItem(itemId: string): QueueItem | undefined {
    return this.vm?.getItem(itemId);
  }

  /**
   * 更新队列项
   */
  updateItem(itemId: string, updates: Partial<QueueItem>): void {
    this.vm?.updateItem(itemId, updates);
  }

  /**
   * 重置队列项状态（用于重试）
   */
  resetItemForRetry(itemId: string): void {
    const item = this.vm.getItem(itemId);
    if (!item) {
      console.warn(`[UploadQueue] 重试失败: 找不到队列项 ${itemId}`);
      return;
    }

    // 重置状态
    this.vm.updateItem(itemId, {
      status: 'pending',
      weiboProgress: 0,
      r2Progress: 0,
      weiboStatus: '等待中...',
      r2Status: item.uploadToR2 ? '等待中...' : '已跳过',
      weiboLink: undefined,
      r2Link: undefined,
      baiduLink: undefined,
      weiboPid: undefined,
      errorMessage: undefined,
    });
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
