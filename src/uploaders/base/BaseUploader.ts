// 上传器抽象基类，提供共享逻辑

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { IUploader } from './IUploader';
import {
  UploadResult,
  ValidationResult,
  UploadOptions,
  ConnectionTestResult,
  ProgressCallback
} from './types';
import { getErrorMessage, isAuthError } from '../../types/errors';

/**
 * 进度事件负载
 * Rust 后端发送的进度事件格式
 */
interface ProgressEvent {
  id: string;
  progress: number;
  total: number;
  step?: string;         // 可选：当前步骤描述（如"获取Token中..."）
  step_index?: number;   // 可选：当前步骤索引（从1开始）
  total_steps?: number;  // 可选：总步骤数
}

/**
 * 上传器抽象基类
 * 提供通用的 Rust 调用逻辑，减少子类重复代码
 *
 * 子类需要实现：
 * - serviceId: 服务标识符
 * - serviceName: 服务显示名称
 * - getRustCommand(): 返回对应的 Rust 命令名
 * - validateConfig(): 验证配置
 * - upload(): 实现上传逻辑（通常调用 uploadViaRust）
 * - getPublicUrl(): 生成公开 URL
 */
export abstract class BaseUploader implements IUploader {
  /** 服务标识符（子类必须实现） */
  abstract readonly serviceId: string;

  /** 服务显示名称（子类必须实现） */
  abstract readonly serviceName: string;

  /**
   * 返回对应的 Rust 命令名
   * 子类必须实现此方法
   *
   * @example
   * protected getRustCommand() {
   *   return 'upload_to_weibo';
   * }
   */
  protected abstract getRustCommand(): string;

  /** 验证配置（子类必须实现） */
  abstract validateConfig(config: any): Promise<ValidationResult>;

  /** 上传文件（子类必须实现） */
  abstract upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult>;

  /** 生成公开 URL（子类必须实现） */
  abstract getPublicUrl(result: UploadResult): string;

  /**
   * 通过 Rust 后端上传文件（共享方法）
   * 处理进度监听、命令调用、错误处理等通用逻辑
   *
   * 包含进度平滑机制：
   * - 在后端静默期间自动蠕动（Auto-Creep），避免进度条假死
   * - 后端发来真实进度时直接使用，保持与 Rust 后端兼容
   * - 配合 CSS transition 实现丝滑视觉效果
   *
   * @param filePath 文件绝对路径
   * @param params 传递给 Rust 命令的参数（不包括 id 和 filePath）
   * @param onProgress 进度回调函数
   * @returns Rust 命令返回的原始结果
   *
   * @example
   * const rustResult = await this.uploadViaRust(
   *   filePath,
   *   { weiboCookie: config.cookie },
   *   onProgress
   * );
   */
  protected async uploadViaRust(
    filePath: string,
    params: Record<string, any>,
    onProgress?: ProgressCallback
  ): Promise<any> {
    // 1. 生成唯一上传 ID（用于匹配进度事件）
    const uploadId = `${this.serviceId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[${this.serviceName}] 开始上传... (ID: ${uploadId})`);

    // 2. 进度平滑状态
    let lastReportedPercent = 0;       // 上次报告的真实进度
    let currentVisualPercent = 0;      // 当前视觉进度（用于蠕动）
    let lastStep: string | undefined;  // 上次步骤描述
    let lastStepIndex: number | undefined;
    let lastTotalSteps: number | undefined;
    let autoCreepInterval: ReturnType<typeof setInterval> | null = null;

    // 3. 设置自动蠕动机制（Auto-Creep）
    // 在后端静默期间，每 200ms 增加少量进度，避免视觉假死
    if (onProgress) {
      // 初始状态：显示准备中
      onProgress(0, '准备上传...');

      autoCreepInterval = setInterval(() => {
        // 只在进度未达到 95% 且未完成时蠕动
        if (currentVisualPercent < 95 && currentVisualPercent >= lastReportedPercent) {
          // 蠕动增量：距离目标越近，增量越小
          const creepAmount = Math.max(0.1, (95 - currentVisualPercent) * 0.01);
          currentVisualPercent = Math.min(currentVisualPercent + creepAmount, 95);

          // 回调蠕动进度（保留1位小数）
          onProgress(
            Number(currentVisualPercent.toFixed(1)),
            lastStep,
            lastStepIndex,
            lastTotalSteps
          );
        }
      }, 200);
    }

    // 4. 设置进度监听器
    let unlisten: UnlistenFn | undefined;

    if (onProgress) {
      try {
        unlisten = await listen<ProgressEvent>('upload://progress', (event) => {
          // 只处理当前上传任务的进度事件
          if (event.payload.id === uploadId) {
            // 如果有步骤信息，记录到控制台
            if (event.payload.step) {
              console.log(
                `[${this.serviceName}] ${event.payload.step}`,
                `(步骤${event.payload.step_index}/${event.payload.total_steps})`
              );
            }

            // 计算后端真实百分比
            const realPercent = event.payload.total > 0
              ? Math.round((event.payload.progress / event.payload.total) * 100)
              : 0;

            // 更新步骤信息
            lastStep = event.payload.step;
            lastStepIndex = event.payload.step_index;
            lastTotalSteps = event.payload.total_steps;

            // 核心逻辑：进度条永不倒退
            // - 如果蠕动进度 > 真实进度：保持蠕动进度
            // - 如果蠕动进度 < 真实进度：追上真实进度
            const displayPercent = Math.max(realPercent, currentVisualPercent);
            currentVisualPercent = displayPercent;
            lastReportedPercent = displayPercent; // 更新蠕动基准为当前显示进度

            // 传递显示进度给外部回调（永不倒退）
            onProgress(
              displayPercent,
              event.payload.step,
              event.payload.step_index,
              event.payload.total_steps
            );
          }
        });
      } catch (error) {
        console.warn(`[${this.serviceName}] 无法监听进度事件:`, error);
        // 继续执行，不因为进度监听失败而中断上传
      }
    }

    try {
      // 5. 调用 Rust 命令
      const result = await invoke(this.getRustCommand(), {
        id: uploadId,
        filePath,
        ...params
      });

      // 6. 上传成功，立即设置 100%
      if (onProgress) {
        onProgress(100, '完成', lastTotalSteps, lastTotalSteps);
      }

      console.log(`[${this.serviceName}] 上传成功:`, result);
      return result;
    } catch (error: unknown) {
      console.error(`[${this.serviceName}] 上传失败:`, error);

      // 使用统一的错误处理函数解析 AppError
      const errorMessage = getErrorMessage(error);

      // 检查是否为认证错误（Cookie 过期等）
      if (isAuthError(error)) {
        throw new Error(`认证失败: ${errorMessage}`);
      }

      throw new Error(`${this.serviceName}上传失败: ${errorMessage}`);
    } finally {
      // 7. 清理资源（防止内存泄漏）
      if (autoCreepInterval !== null) {
        clearInterval(autoCreepInterval);
        autoCreepInterval = null;
      }
      if (unlisten) {
        unlisten();
      }
    }
  }

  /**
   * 测试连接（默认实现，子类可覆盖）
   * 默认返回未实现
   * @param config 可选的服务配置，用于验证凭证
   */
  async testConnection(_config?: any): Promise<ConnectionTestResult> {
    return {
      success: false,
      error: '此服务暂未实现连接测试'
    };
  }

  /**
   * 辅助方法：生成唯一 ID
   * 用于上传任务标识、临时文件名等场景
   */
  protected generateUniqueId(): string {
    return `${this.serviceId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 辅助方法：检查字段是否为空
   * 用于配置验证
   */
  protected isEmpty(value: string | undefined | null): boolean {
    return !value || value.trim().length === 0;
  }

  /**
   * 辅助方法：记录日志
   * 统一的日志格式
   */
  protected log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
    const prefix = `[${this.serviceName}]`;

    switch (level) {
      case 'info':
        console.log(prefix, message, data ?? '');
        break;
      case 'warn':
        console.warn(prefix, message, data ?? '');
        break;
      case 'error':
        console.error(prefix, message, data ?? '');
        break;
    }
  }
}
