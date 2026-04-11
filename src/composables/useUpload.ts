// src/composables/useUpload.ts
// 上传管理 Composable - 上传流程编排（核心协调器）

import { isUploading } from './uploadState';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { configStore } from '../store/instances';
import {
  UserConfig,
  DEFAULT_CONFIG,
  DEFAULT_COMPRESSION_PRESET,
} from '../config/types';
import type { ServiceType } from '../config/types';
import { MultiServiceUploader, SingleServiceResult } from '../core/MultiServiceUploader';
import { UploadQueueManager } from '../uploadQueue';
import { useToast } from './useToast';
import { useCopyLink, type CopyLinkItem, type CopyLinkResult } from './useCopyLink';
import { TOAST_MESSAGES } from '../constants';
import { checkNetworkConnectivity } from '../utils/network';
import { chunkArray } from '../utils/semaphore';
import { useServiceSelector } from './useServiceSelector';
import { useServiceHealth } from './useServiceHealth';
import { useServiceAvailability } from './useServiceAvailability';
import { useHistorySaver } from './useHistorySaver';
import { fetchMetadataBatch, getImageMetadata } from './useImageMetadata';
import { useImageCompress } from './useImageCompress';
import { AUTH_CONFIG_ERROR_CODES } from '../types/serviceHealth';
import { createLogger } from '../utils/logger';
import { buildUploadSummaryToast, type UploadSessionSummary, type UploadCopySummary } from '../utils/uploadSummary';
import { SERVICE_DISPLAY_NAMES } from '../constants/serviceNames';

const log = createLogger('useUpload');

// --- 配置 ---
const METADATA_BATCH_SIZE = 50;  // 每批处理 50 张图片
const MAX_FILES_PER_UPLOAD = 200; // 单次上传最大文件数，防止内存溢出

/**
 * 上传管理 Composable
 */
export function useUploadManager(queueManager?: UploadQueueManager) {
  const toast = useToast();
  const { copyLinks } = useCopyLink();

  // 使用服务选择模块
  const {
    selectedServices,
    availableServices,
    serviceConfigStatus,
    activePrefix,
    isServiceAvailable,
    isServiceSelected,
    loadServiceButtonStates,
    toggleServiceSelection,
    setupConfigListener
  } = useServiceSelector();

  // 使用历史记录保存模块
  const {
    saveHistoryItem,
    saveHistoryItemImmediate,
    addResultToHistoryItem
  } = useHistorySaver();


  function showUploadSessionSummary(
    summary: UploadSessionSummary,
    copy: UploadCopySummary
  ): void {
    const payload = buildUploadSummaryToast(summary, copy);
    if (!payload) return;

    if (payload.severity === 'success') {
      toast.success(payload.summary, payload.detail);
    } else if (payload.severity === 'error') {
      toast.error(payload.summary, payload.detail);
    } else {
      toast.warn(payload.summary, payload.detail);
    }
  }

  /**
   * 验证文件类型（只允许图片）
   * @param filePaths 文件路径列表
   */
  async function filterValidFiles(filePaths: string[]): Promise<{
    valid: string[];
    invalid: string[];
  }> {
    const validExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
    const valid: string[] = [];
    const invalid: string[] = [];

    for (const filePath of filePaths) {
      const ext = filePath.split('.').pop()?.toLowerCase();
      if (ext && validExtensions.includes(ext)) {
        valid.push(filePath);
      } else {
        invalid.push(filePath);
      }
    }

    return { valid, invalid };
  }

  /**
   * 选择文件
   */
  async function selectFiles(): Promise<string[] | null> {
    try {
      const selected = await dialogOpen({
        multiple: true,
        filters: [{
          name: '图片',
          extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']
        }]
      });

      if (selected) {
        return Array.isArray(selected) ? selected : [selected];
      }
      return null;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('文件选择失败:', error);
      toast.showConfig('error', TOAST_MESSAGES.upload.selectFailed(errorMsg));
      return null;
    }
  }

  /**
   * 处理文件上传
   * @param filePaths 文件路径列表
   */
  async function handleFilesUpload(filePaths: string[]): Promise<void> {
    // 防止重入：上传期间不接受新上传
    if (isUploading.value) {
      toast.showConfig('warn', { summary: '请稍候', detail: '当前有上传任务进行中，请等待完成后再试' });
      return;
    }

    // 验证输入
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      log.warn('无效的文件列表:', filePaths);
      return;
    }

    // 立即锁定，防止 await 间隙的竞态
    isUploading.value = true;

    const { compressImageBatch, cleanupTempFiles } = useImageCompress();
    let compressionEnabled = false;

    try {
      log.info('接收到文件:', filePaths);

      // 文件类型验证
      const { valid: initialValid, invalid } = await filterValidFiles(filePaths);
      let valid = initialValid;

      if (valid.length === 0) {
        log.warn('没有有效的图片文件');
        toast.showConfig('warn', TOAST_MESSAGES.upload.noImage);
        return;
      }

      if (invalid.length > 0) {
        toast.showConfig('warn', TOAST_MESSAGES.upload.invalidFormat(invalid.length));
      }

      // 文件数量限制，防止内存溢出
      if (valid.length > MAX_FILES_PER_UPLOAD) {
        toast.showConfig('warn', { summary: '文件数量超限', detail: `单次最多上传 ${MAX_FILES_PER_UPLOAD} 个文件，已截断多余的 ${valid.length - MAX_FILES_PER_UPLOAD} 个` });
        valid = valid.slice(0, MAX_FILES_PER_UPLOAD);
      }

      log.info(`有效文件: ${valid.length}个，无效文件: ${invalid.length}个`);

      // 获取配置
      let config: UserConfig | null = null;
      try {
        // 传入默认值：配置损坏时由 Store 自动恢复，避免偶发读取失败中断上传
        config = await configStore.get<UserConfig>('config', DEFAULT_CONFIG);
      } catch (error) {
        log.error('读取配置失败，回退默认配置:', error);
        toast.showConfig('warn', {
          summary: '读取配置失败',
          detail: '已回退到默认配置继续上传，可前往设置页检查配置文件'
        });
        config = DEFAULT_CONFIG;
      }

      // 验证配置存在
      if (!config) {
        log.warn('配置不存在，使用默认配置');
        config = DEFAULT_CONFIG;
      }

      // 关键修改：使用配置中的服务列表，而不是界面状态
      const enabledServices = config.enabledServices || selectedServices.value;

      // 验证是否选中了图床服务
      if (enabledServices.length === 0) {
        log.warn('没有选择任何图床');

        // 检查是否有可用的图床可供选择
        const hasConfiguredServices = availableServices.value.length > 0;

        if (hasConfiguredServices) {
          // 有已配置的图床但未选中
          toast.showConfig('error', TOAST_MESSAGES.upload.noService);
        } else {
          // 没有任何已配置的图床
          toast.showConfig('error', TOAST_MESSAGES.upload.notConfigured('任何'));
        }
        return;
      }

      // 同步界面状态和配置状态（修复：先复制再排序，避免修改原数组）
      const sortedEnabled = [...enabledServices].sort();
      const sortedSelected = [...selectedServices.value].sort();
      if (JSON.stringify(sortedEnabled) !== JSON.stringify(sortedSelected)) {
        log.warn('检测到状态不一致，同步中...');
        selectedServices.value = [...enabledServices];
      }

      // ⭐ 检查队列管理器
      if (!queueManager) {
        log.error('队列管理器未初始化');
        toast.showConfig('error', TOAST_MESSAGES.upload.failed('队列管理器未初始化'));
        return;
      }

      // ⭐ 异步检测网络（在处理之前）
      const isNetworkAvailable = await checkNetworkConnectivity();
      if (!isNetworkAvailable) {
        toast.error(
          '网络请求失败',
          `${valid.length} 个文件请求超时或中断，请检查网络`,
          6000
        );
        return;
      }

      // ⭐ 流水线处理：分批获取元数据 + 上传
      // 每批 50 张图片，限制同时进行的批次数量避免网络拥塞
      const batches = chunkArray(valid, METADATA_BATCH_SIZE);
      const MAX_CONCURRENT_BATCHES = 2;  // 最多同时处理 2 个批次
      log.info(`开始流水线处理：${valid.length} 个文件，分 ${batches.length} 批，最大并发 ${MAX_CONCURRENT_BATCHES} 批`);

      // 收集成功上传的链接（用于自动复制）
      const collectedLinks: CopyLinkItem[] = [];
      const uploadSummary: UploadSessionSummary = {
        total: 0,
        success: 0,
        failed: 0,
        partialServiceFailureCount: 0,
        partialFailedServices: [],
      };

      const compressionConfig = config.imageCompression ?? DEFAULT_CONFIG.imageCompression!;
      compressionEnabled = compressionConfig.enabled;
      const activePreset = compressionConfig.presets?.find(
        p => p.id === compressionConfig.activePresetId,
      ) ?? compressionConfig.presets?.[0] ?? { ...DEFAULT_COMPRESSION_PRESET };

      // 批次处理函数
      const processBatch = async (batchFiles: string[], batchIndex: number) => {
        // 1. 批量获取元数据（并发控制）
        // 这会预填充缓存，后续 saveHistoryItemImmediate 会直接使用缓存
        try {
          await fetchMetadataBatch(batchFiles);
        } catch (metaError) {
          log.warn(`批次 ${batchIndex + 1} 元数据获取失败，继续上传:`, metaError);
        }

        // 1.5 图片压缩预处理
        let actualFiles = batchFiles;
        if (compressionConfig.enabled) {
          try {
            const fileSizes = new Map<string, number>();
            const metaResults = await Promise.all(
              batchFiles.map(fp => getImageMetadata(fp).catch(() => null))
            );
            metaResults.forEach((meta, i) => {
              if (meta?.file_size) fileSizes.set(batchFiles[i], meta.file_size);
            });

            const pathMap = await compressImageBatch(batchFiles, activePreset, fileSizes);
            if (pathMap.size > 0) {
              actualFiles = batchFiles.map(fp => pathMap.get(fp) ?? fp);
              log.info(`批次 ${batchIndex + 1}: ${pathMap.size} 张图片已压缩`);
            }
          } catch (compressError) {
            log.warn(`批次 ${batchIndex + 1} 压缩失败，使用原图:`, compressError);
          }
        }

        // 2. 将该批文件加入队列
        const queueItems = actualFiles.map((filePath, index) => {
          // 使用原始文件名（不是压缩后的临时文件名）
          const originalPath = batchFiles[index];
          const fileName = originalPath.split(/[/\\]/).pop() || originalPath;
          const itemId = queueManager!.addFile(filePath, fileName, [...enabledServices]);
          return { itemId, filePath, fileName };
        }).filter(item => item.itemId);

        if (queueItems.length === 0) {
          return;
        }

        // 3. 立即开始上传该批
        await processUploadQueue(queueItems, config, enabledServices, 5, collectedLinks, uploadSummary);

        log.debug(`批次 ${batchIndex + 1}/${batches.length} 完成：${queueItems.length} 个文件`);
      };

      // 限制并发批次数量，避免网络拥塞和服务器限流
      let activeBatches = 0;
      let batchIndex = 0;

      await new Promise<void>((resolve) => {
        const runNextBatch = () => {
          // 所有批次都已完成
          if (batchIndex >= batches.length && activeBatches === 0) {
            resolve();
            return;
          }

          // 在并发限制内启动新批次
          while (activeBatches < MAX_CONCURRENT_BATCHES && batchIndex < batches.length) {
            const currentIndex = batchIndex++;
            activeBatches++;

            processBatch(batches[currentIndex], currentIndex)
              .catch((error) => {
                log.error(`批次 ${currentIndex + 1} 处理失败:`, error);
              })
              .finally(() => {
                activeBatches--;
                runNextBatch();
              });
          }
        };

        runNextBatch();
      });

      log.info('所有批次处理完成');

      // 自动复制链接到剪贴板（使用统一 useCopyLink）
      const autoCopyEnabled = config.linkOutput?.autoCopy !== false;
      let copyResult: CopyLinkResult | null = null;
      if (autoCopyEnabled && collectedLinks.length > 0) {
        copyResult = await copyLinks(collectedLinks, {
          showSuccessToast: false,
          showErrorToast: false,
        });
      }

      showUploadSessionSummary(uploadSummary, {
        autoCopyEnabled,
        copiedCount: copyResult?.copiedCount ?? 0,
        format: copyResult?.format || config.linkOutput?.defaultFormat || 'url',
        copyFailed: autoCopyEnabled && !!copyResult && !copyResult.ok,
      });
    } catch (error) {
      log.error('文件处理失败:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      toast.showConfig('error', TOAST_MESSAGES.upload.failed(errorMsg));
    } finally {
      isUploading.value = false;
      // 清理压缩产生的临时文件
      if (compressionEnabled) {
        cleanupTempFiles().catch((err: unknown) => log.warn('清理压缩临时文件失败:', err));
      }
    }
  }

  /**
   * 并发处理上传队列（多图床并行上传）
   * @param queueItems 已创建的队列项列表
   * @param config 用户配置
   * @param enabledServices 启用的图床服务列表
   * @param maxConcurrent 最大并发数（默认5，提升吞吐量）
   */
  async function processUploadQueue(
    queueItems: Array<{ itemId: string | null; filePath: string; fileName: string }>,
    config: UserConfig,
    enabledServices: string[],
    maxConcurrent: number = 5,
    collectedLinks?: CopyLinkItem[],
    uploadSummary?: UploadSessionSummary
  ): Promise<void> {
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
            if (!historyCreated && historyCreating) {
              pendingResults.push(serviceResult);
            } else if (!historyCreated && serviceResult.status === 'failed') {
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
            } else if (historyCreated) {
              // 历史记录已创建后，后续成功/失败结果都追加到已有记录
              const success = await addResultToHistoryItem(historyId, serviceResult);
              if (!success) {
                log.warn(`${serviceResult.serviceId} 结果追加失败，但不影响上传`);
              }
            }

            const item = queueManager!.getItem(itemId);
            if (!item) return;

            // 修复竞态条件：只更新当前服务的进度，不覆盖其他服务的状态
            // updateItem 会自动做深度合并，所以只需传递要更新的服务即可
            const serviceId = serviceResult.serviceId;
            const serviceUpdate: Record<string, any> = {};

            if (serviceResult.status === 'success' && serviceResult.result) {
              // 七鱼/京东上传成功，标记为可用（重置检测冷却计时器）
              if (serviceId === 'qiyu' || serviceId === 'jd') {
                const { markServiceAvailable } = useServiceAvailability();
                markServiceAvailable(serviceId as 'qiyu' | 'jd').catch(() => {});
              }

              // 成功：立即更新状态并显示链接
              let link = serviceResult.result.url;
              if (serviceId === 'weibo' && activePrefix.value) {
                link = activePrefix.value + link;
              }

              serviceUpdate[serviceId] = {
                ...item.serviceProgress?.[serviceId],
                status: '✓ 完成',
                progress: 100,
                link: link
              };
            } else if (serviceResult.status === 'failed') {
              // 失败：更新错误状态
              serviceUpdate[serviceId] = {
                ...item.serviceProgress?.[serviceId],
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
            queueManager!.updateItem(itemId, {
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
              queueManager!.updateServiceProgress(
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
          if (result.primaryService === 'weibo' && activePrefix.value) {
            thumbUrl = activePrefix.value + thumbUrl;
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

          queueManager!.markItemComplete(itemId, thumbUrl);
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

          const item = queueManager!.getItem(itemId);
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
            queueManager!.updateItem(itemId, {
              serviceProgress: updatedServiceProgress
            });
          }

          queueManager!.markItemFailed(itemId, errorMsg);
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

  return {
    // 状态
    selectedServices,
    availableServices,
    serviceConfigStatus,
    isUploading,
    activePrefix,

    // 计算属性
    isServiceAvailable,
    isServiceSelected,

    // 方法
    selectFiles,
    handleFilesUpload,
    loadServiceButtonStates,
    toggleServiceSelection,
    saveHistoryItem,
    setupConfigListener
  };
}
