// src/composables/upload/UploadExecutor.ts
// 上传执行器：并发调度 + 单文件多图床上传 + 历史记录联动

import type { UserConfig, ServiceType } from '../../config/types';
import { MultiServiceUploader, SingleServiceResult } from '../../core/MultiServiceUploader';
import { UploadQueueManager, type ServiceProgress } from '../../uploadQueue';
import type { CopyLinkItem } from '../useCopyLink';
import type { UploadSessionSummary } from '../../utils/uploadSummary';
import { useServiceHealth } from '../useServiceHealth';
import { useServiceAvailability } from '../useServiceAvailability';
import { useToast } from '../useToast';
import { TOAST_MESSAGES } from '../../constants';
import { SERVICE_DISPLAY_NAMES } from '../../constants/serviceNames';
import { AUTH_CONFIG_ERROR_CODES } from '../../types/serviceHealth';
import { createLogger } from '../../utils/logger';

const log = createLogger('UploadExecutor');

/**
 * UploadExecutor 所需的上下文依赖（由门面注入）
 */
export interface UploadExecutorContext {
  queueManager: UploadQueueManager;
  saveHistoryItemImmediate: (
    filePath: string,
    firstResult: SingleServiceResult,
    historyId: string
  ) => Promise<void>;
  addResultToHistoryItem: (
    historyId: string,
    result: SingleServiceResult
  ) => Promise<boolean>;
  /** 微博前缀快照（由门面在调用前读取 activePrefix.value） */
  weiboPrefix: string | null;
}

/**
 * 并发处理上传队列（多图床并行上传）
 * @param queueItems 已创建的队列项列表
 * @param config 用户配置
 * @param enabledServices 启用的图床服务列表
 * @param maxConcurrent 最大并发数（默认 5）
 * @param ctx 上下文依赖（队列管理器、历史保存、微博前缀）
 * @param collectedLinks 成功链接收集器（用于自动复制，可选）
 * @param uploadSummary 上传会话统计（可选）
 */
export async function processUploadQueue(
  queueItems: Array<{ itemId: string | null; filePath: string; fileName: string }>,
  config: UserConfig,
  enabledServices: string[],
  maxConcurrent: number = 5,
  ctx: UploadExecutorContext,
  collectedLinks?: CopyLinkItem[],
  uploadSummary?: UploadSessionSummary
): Promise<void> {
  const toast = useToast();
  const { queueManager, saveHistoryItemImmediate, addResultToHistoryItem, weiboPrefix } = ctx;

  if (!queueManager) {
    log.error('上传队列管理器未初始化');
    toast.showConfig('error', TOAST_MESSAGES.upload.failed('队列管理器未初始化'));
    return;
  }

  const multiServiceUploader = new MultiServiceUploader();

  // 为每个队列项创建上传任务
  const uploadTasks = queueItems.map(({ itemId, filePath, fileName }) => {
    // itemId 在创建时已经过重复检查
    if (!itemId) {
      log.debug(`跳过无效队列项: ${fileName}`);
      return null; // 返回 null 表示跳过
    }

    return async () => {
      try {
        // 使用 UUID 生成唯一 ID，避免高并发时的 ID 碰撞
        const historyId = crypto.randomUUID();

        // 方案 B：标志位跟踪历史记录是否已创建
        let historyCreated = false;
        let historyCreating = false; // 防止并发创建
        // 等待队列：在历史记录创建前/创建期间到达的结果，待 historyCreated 后追加
        const pendingResults: SingleServiceResult[] = [];

        // 实时处理单个服务完成的函数
        const handleServiceResult = async (serviceResult: SingleServiceResult) => {
          if (!historyCreated && historyCreating && serviceResult.status === 'success') {
            pendingResults.push(serviceResult);
          }

          // 方案 B：第一个成功结果到达时立即创建历史记录
          if (serviceResult.status === 'success' && !historyCreated && !historyCreating) {
            historyCreating = true;
            try {
              // 立即创建历史记录（只包含当前这个成功结果）
              await saveHistoryItemImmediate(filePath, serviceResult, historyId);
              historyCreated = true;
              historyCreating = false;

              // 处理等待队列中的结果（创建前/创建期间到达的失败或其他成功结果）
              if (pendingResults.length > 0) {
                const queuedResults = pendingResults.filter(pending => pending !== serviceResult);
                for (const pending of queuedResults) {
                  const success = await addResultToHistoryItem(historyId, pending);
                  if (!success) {
                    log.warn(`${pending.serviceId} 结果追加失败，但不影响上传`);
                  }
                }
                pendingResults.length = 0; // 清空队列
              }
            } catch (err) {
              pendingResults.push(serviceResult);
              log.error('立即保存失败:', err);
              historyCreating = false; // 重置，允许后续成功结果重试
            }
          } else if (historyCreated && serviceResult.status === 'success') {
            // 历史记录已创建后，后续成功结果追加到已有记录（失败结果不持久化）
            const success = await addResultToHistoryItem(historyId, serviceResult);
            if (!success) {
              log.warn(`${serviceResult.serviceId} 结果追加失败，但不影响上传`);
            }
          }

          const item = queueManager.getItem(itemId);
          if (!item) return;

          // 修复竞态条件：只更新当前服务的进度，不覆盖其他服务的状态
          // updateItem 会自动做深度合并，所以只需传递要更新的服务即可
          const serviceId = serviceResult.serviceId;
          const serviceUpdate: Partial<Record<string, ServiceProgress>> = {};

          if (serviceResult.status === 'success' && serviceResult.result) {
            // 七鱼/京东上传成功，标记为可用（重置检测冷却计时器）
            if (serviceId === 'qiyu' || serviceId === 'jd') {
              const { markServiceAvailable } = useServiceAvailability();
              markServiceAvailable(serviceId as 'qiyu' | 'jd').catch(() => {});
            }

            // 成功：立即更新状态并显示链接
            let link = serviceResult.result.url;
            if (serviceId === 'weibo' && weiboPrefix) {
              link = weiboPrefix + link;
            }

            serviceUpdate[serviceId] = {
              ...item.serviceProgress?.[serviceId],
              serviceId,
              status: '✓ 完成',
              progress: 100,
              link: link
            };
          } else if (serviceResult.status === 'failed') {
            // 失败：更新错误状态
            serviceUpdate[serviceId] = {
              ...item.serviceProgress?.[serviceId],
              serviceId,
              status: '✗ 失败',
              progress: 0,
              error: serviceResult.error || '上传失败'
            };

            // 认证/配置类错误联动健康状态
            if (serviceResult.structuredError) {
              const code = serviceResult.structuredError.code;
              if ((AUTH_CONFIG_ERROR_CODES as readonly string[]).includes(code)) {
                useServiceHealth().markUploadError(serviceId, serviceResult.structuredError);
              }
            }
          }

          // 实时更新 UI（只更新当前服务，不影响其他服务）
          queueManager.updateItem(itemId, {
            serviceProgress: serviceUpdate
          });
        };

        // 使用多图床上传编排器
        const result = await multiServiceUploader.uploadToMultipleServices(
          filePath,
          enabledServices,
          config,
          // 进度回调
          (serviceId, percent, step, stepIndex, totalSteps) => {
            queueManager.updateServiceProgress(
              itemId,
              serviceId,
              percent,
              step,
              stepIndex,
              totalSteps
            );
          },
          // 单项完成回调 - 实现实时 UI 响应
          (singleResult) => handleServiceResult(singleResult)
        );

        log.info(`${fileName} 全部完成，主力图床: ${result.primaryService}`);

        // 双重保险：确保 UI 状态一致
        // 注意：不需要遍历 result.results，因为 handleServiceResult 已经处理了

        // 通知队列管理器上传成功（谁先上传完用谁的链接）
        let thumbUrl = result.primaryUrl;
        if (result.primaryService === 'weibo' && weiboPrefix) {
          thumbUrl = weiboPrefix + thumbUrl;
        }

        if (uploadSummary && result.partialFailures?.length) {
          const failureCounts = new Map(
            (uploadSummary.partialFailedServices ?? []).map(item => [item.serviceName, item.count])
          );

          result.partialFailures.forEach(({ serviceId }) => {
            const serviceName = (SERVICE_DISPLAY_NAMES as Record<string, string>)[serviceId] || serviceId;
            failureCounts.set(serviceName, (failureCounts.get(serviceName) ?? 0) + 1);
          });

          uploadSummary.partialServiceFailureCount =
            (uploadSummary.partialServiceFailureCount ?? 0) + result.partialFailures.length;
          uploadSummary.partialFailedServices = Array.from(
            failureCounts,
            ([serviceName, count]) => ({ serviceName, count })
          );
        }

        // 收集主力图床链接（用于自动复制，serviceId 用于统一前缀处理）
        if (result.primaryUrl && collectedLinks) {
          collectedLinks.push({
            url: result.primaryUrl,
            fileName,
            serviceId: result.primaryService as ServiceType,
          });
        }

        queueManager.markItemComplete(itemId, thumbUrl);
        if (uploadSummary) {
          uploadSummary.success += 1;
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error(`${fileName} 上传失败:`, errorMsg);

        // 从错误消息中提取图床信息（所有图床失败时包含详细信息）
        const failedServices: string[] = [];

        // 尝试从错误消息中解析失败的图床
        const servicePattern = /- (\w+):/g;
        let match;
        while ((match = servicePattern.exec(errorMsg)) !== null) {
          failedServices.push(match[1]);
        }

        // 智能错误提示 - 带图床名称
        if (errorMsg.includes('Cookie') || errorMsg.includes('100006')) {
          // Cookie 相关错误（通常是微博）
          const serviceName = failedServices.length > 0 ? failedServices.join('、') : '微博';
          toast.showConfig('error', TOAST_MESSAGES.auth.tokenFailed(serviceName, '登录凭证/Cookie 已过期，请前往更新'));
        } else if (errorMsg.includes('认证失败') || errorMsg.includes('authentication')) {
          // 认证错误
          const serviceName = failedServices.length > 0 ? failedServices.join('、') : '图床';
          toast.showConfig('error', TOAST_MESSAGES.auth.connectionFailed(serviceName, '请检查 AK/SK 或 Token 配置是否正确'));
        } else if (errorMsg.includes('所有图床上传均失败')) {
          // 所有图床都失败
          toast.showConfig('error', TOAST_MESSAGES.upload.failed(`${fileName} 未能上传至任何图床`));
        } else {
          // 通用错误
          toast.showConfig('error', TOAST_MESSAGES.upload.failed(`${fileName}: ${errorMsg}`));
        }

        const item = queueManager.getItem(itemId);
        if (item) {
          const updatedServiceProgress = { ...(item.serviceProgress || {}) };
          enabledServices.forEach(serviceId => {
            updatedServiceProgress[serviceId] = {
              ...updatedServiceProgress[serviceId],
              serviceId,
              status: '✗ 失败',
              progress: 0,
              error: errorMsg
            };
          });
          queueManager.updateItem(itemId, {
            serviceProgress: updatedServiceProgress
          });
        }

        queueManager.markItemFailed(itemId, errorMsg);
        if (uploadSummary) {
          uploadSummary.failed += 1;
        }
      }
    };
  }).filter(task => task !== null); // 过滤掉 null 值

  log.debug(`实际需要上传的文件数: ${uploadTasks.length}/${queueItems.length}`);
  if (uploadSummary) {
    uploadSummary.total += uploadTasks.length;
  }

  // ✅ 改进的并发控制：使用信号量模式避免竞态条件
  let activeCount = 0;
  let taskIndex = 0;
  const results: PromiseSettledResult<void>[] = [];

  return new Promise<void>((resolve) => {
    const runNext = () => {
      // 所有任务都已启动且完成
      if (taskIndex >= uploadTasks.length && activeCount === 0) {
        resolve();
        return;
      }

      // 在并发限制内启动新任务
      while (activeCount < maxConcurrent && taskIndex < uploadTasks.length) {
        const currentIndex = taskIndex++;
        const task = uploadTasks[currentIndex];

        activeCount++;

        task()
          .then(() => {
            results.push({ status: 'fulfilled', value: undefined });
          })
          .catch((error) => {
            results.push({ status: 'rejected', reason: error });
            log.error(`任务 ${currentIndex} 失败:`, error);
          })
          .finally(() => {
            activeCount--;
            runNext(); // 递归启动下一个任务
          });
      }
    };

    runNext(); // 启动初始批次
  });
}
