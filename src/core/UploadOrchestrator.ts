// src/core/UploadOrchestrator.ts
// 上传调度器 - 替代 coreLogic.ts
// @deprecated 此文件为实验性实现，主要用于示例和测试
// 实际项目使用 MultiServiceUploader，此文件保留作为 API 参考
// @ts-nocheck - 暂时忽略类型检查，因为不是核心流程的一部分

import { UploaderFactory } from '../uploaders/base/UploaderFactory';
import { UploadResult, ProgressCallback } from '../uploaders/base/types';
import { UserConfig, HistoryItem, ServiceType } from '../config/types';
import { LinkGenerator } from './LinkGenerator';
import { Store } from '../store';
import { writeText as writeToClipboard } from '@tauri-apps/api/clipboard';
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/api/notification';
import { basename } from '@tauri-apps/api/path';

/**
 * 上传调度器
 * 简化的核心业务逻辑，负责：
 * 1. 调度主力上传
 * 2. 处理备份上传（非阻塞）
 * 3. 生成链接
 * 4. 保存历史记录
 * 5. 剪贴板和通知
 */
export class UploadOrchestrator {
  private historyStore: Store;

  constructor() {
    this.historyStore = new Store('history.dat');
  }

  /**
   * 上传文件（主入口）
   *
   * @param filePath 文件绝对路径
   * @param config 用户配置
   * @param onProgress 进度回调（可选）
   * @returns 历史记录项
   */
  async uploadFile(
    filePath: string,
    config: UserConfig,
    onProgress?: ProgressCallback
  ): Promise<HistoryItem> {
    console.log('[UploadOrchestrator] 开始上传流程', { filePath, primaryService: config.primaryService });

    // 1. 创建主力上传器
    const primaryUploader = UploaderFactory.create(config.primaryService);
    const serviceConfig = config.services[config.primaryService];

    if (!serviceConfig) {
      throw new Error(`未配置 ${primaryUploader.serviceName} 服务`);
    }

    // 2. 验证配置
    const validation = await primaryUploader.validateConfig(serviceConfig);
    if (!validation.valid) {
      const errors = validation.errors?.join(', ') || '配置无效';
      throw new Error(`${primaryUploader.serviceName}配置无效: ${errors}`);
    }

    // 3. 执行主力上传
    console.log(`[UploadOrchestrator] 开始上传到 ${primaryUploader.serviceName}`);

    const primaryResult = await primaryUploader.upload(
      filePath,
      { config: serviceConfig },
      onProgress
    );

    console.log('[UploadOrchestrator] 主力上传成功', primaryResult);

    // 4. 生成最终链接（处理百度前缀等）
    const generatedLink = LinkGenerator.generate(primaryResult, config);

    // 5. 创建历史记录项
    const historyItem: HistoryItem = {
      id: this.generateHistoryId(),
      timestamp: Date.now(),
      localFileName: await basename(filePath),
      primaryService: config.primaryService,
      primaryResult: primaryResult,
      generatedLink: generatedLink,
    };

    // 6. 保存历史记录（同步）
    await this.saveHistory(historyItem);

    // 7. 复制到剪贴板
    await writeToClipboard(generatedLink);
    console.log('[UploadOrchestrator] 已复制链接到剪贴板');

    // 8. 发送通知
    await this.showNotification('上传成功', generatedLink);

    // 9. 异步备份上传（非阻塞）
    if (config.backup?.enabled && config.backup.services.length > 0) {
      this.uploadBackups(filePath, config, historyItem)
        .then(async (backups) => {
          // 更新历史记录（添加备份信息）
          historyItem.backups = backups;
          await this.saveHistory(historyItem);
          console.log('[UploadOrchestrator] 备份上传完成', backups);
        })
        .catch((error) => {
          console.error('[UploadOrchestrator] 备份上传失败', error);
        });
    }

    return historyItem;
  }

  /**
   * 备份上传（非阻塞，并行执行）
   */
  private async uploadBackups(
    filePath: string,
    config: UserConfig,
    historyItem: HistoryItem
  ): Promise<Array<{
    serviceId: ServiceType;
    result?: UploadResult;
    status: 'success' | 'failed';
    error?: string;
  }>> {
    if (!config.backup || !config.backup.enabled || !config.backup.services.length) {
      return [];
    }

    console.log('[UploadOrchestrator] 开始备份上传', config.backup.services);

    const backupPromises = config.backup.services.map(async (serviceId) => {
      // 跳过与主力相同的服务
      if (serviceId === config.primaryService) {
        return null;
      }

      try {
        const uploader = UploaderFactory.create(serviceId);
        const serviceConfig = config.services[serviceId];

        if (!serviceConfig) {
          return {
            serviceId,
            status: 'failed' as const,
            error: '未配置此服务'
          };
        }

        const result = await uploader.upload(filePath, { config: serviceConfig });

        return {
          serviceId,
          result,
          status: 'success' as const
        };
      } catch (error) {
        return {
          serviceId,
          status: 'failed' as const,
          error: String(error)
        };
      }
    });

    const results = await Promise.allSettled(backupPromises);

    return results
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }

  /**
   * 保存历史记录
   */
  private async saveHistory(item: HistoryItem): Promise<void> {
    try {
      const history = await this.historyStore.get<HistoryItem[]>('uploads', []);

      // 更新或添加记录
      const existingIndex = history.findIndex(h => h.id === item.id);
      if (existingIndex >= 0) {
        history[existingIndex] = item;
      } else {
        history.unshift(item);
      }

      // 限制历史记录条数（最多 500 条）
      if (history.length > 500) {
        history.splice(500);
      }

      await this.historyStore.set('uploads', history);
      await this.historyStore.save();

      console.log('[UploadOrchestrator] 历史记录已保存', { id: item.id });
    } catch (error) {
      console.error('[UploadOrchestrator] 保存历史记录失败', error);
      // 不抛出错误，避免影响主流程
    }
  }

  /**
   * 显示系统通知
   */
  private async showNotification(title: string, body: string): Promise<void> {
    try {
      let permissionGranted = await isPermissionGranted();

      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === 'granted';
      }

      if (permissionGranted) {
        await sendNotification({ title, body });
      }
    } catch (error) {
      console.error('[UploadOrchestrator] 通知发送失败', error);
      // 不抛出错误，通知失败不影响主流程
    }
  }

  /**
   * 生成历史记录 ID
   */
  private generateHistoryId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
