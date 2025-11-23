// src/uploadQueue.ts
/**
 * 上传队列管理器 (Vue 3 Refactor)
 * 负责管理可视化的上传队列UI和上传进度
 */

import { createApp, App } from 'vue';
import UploadQueueVue from './components/UploadQueue.vue';
import type { QueueItem } from './components/UploadQueue.vue';
import { appState } from './main';

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
  private vm: any;

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
   * 添加文件到队列
   */
  addFile(filePath: string, fileName: string, uploadToR2: boolean): string {
    const id = `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const item: QueueItem = {
      id,
      fileName,
      filePath,
      uploadToR2,
      weiboProgress: 0,
      r2Progress: 0,
      weiboStatus: '等待中...',
      r2Status: uploadToR2 ? '等待中...' : '已跳过',
      status: 'pending',
    };

    this.vm.addFile(item);
    
    console.log(`[UploadQueue] 添加文件到队列: ${fileName} (ID: ${id})`);
    return id;
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
    return this.vm.getItem(itemId);
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
