// src/composables/useUpload.ts
// 上传管理 Composable - 上传流程编排（核心协调器）

import { isUploading } from './uploadState';
import { configStore } from '../store/instances';
import { filterValidFiles, selectFiles, MAX_FILES_PER_UPLOAD } from './upload/FileValidator';
import { processUploadQueue } from './upload/UploadExecutor';
import {
  UserConfig,
  DEFAULT_CONFIG,
  DEFAULT_COMPRESSION_PRESET,
  isPublicRiskService,
} from '../config/types';
import { UploadQueueManager } from '../core/UploadQueue';
import { useToast } from './useToast';
import { useCopyLink, type CopyLinkItem, type CopyLinkResult } from './useCopyLink';
import { TOAST_MESSAGES } from '../constants';
import { checkNetworkConnectivity } from '../utils/network';
import { chunkArray } from '../utils/semaphore';
import { useServiceSelector } from './useServiceSelector';
import { useHistorySaver } from './useHistorySaver';
import { fetchMetadataBatch, getImageMetadata } from './useImageMetadata';
import { useImageCompress } from './useImageCompress';
import { createLogger } from '../utils/logger';
import { buildUploadSummaryToast, type UploadSessionSummary, type UploadCopySummary } from '../utils/uploadSummary';

const log = createLogger('useUpload');

// --- 配置 ---
const METADATA_BATCH_SIZE = 50;  // 每批处理 50 张图片

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
    addResultToHistoryItem,
    reconcileHistoryPrimary
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
      const { valid: initialValid, invalid, truncatedCount } = await filterValidFiles(filePaths);
      let valid = initialValid;

      if (valid.length === 0) {
        log.warn('没有有效的图片文件');
        toast.showConfig('warn', TOAST_MESSAGES.upload.noImage);
        return;
      }

      if (invalid.length > 0) {
        toast.showConfig('warn', TOAST_MESSAGES.upload.invalidFormat(invalid.length));
      }

      if (truncatedCount > 0) {
        toast.showConfig('warn', { summary: '文件数量超限', detail: `单次最多上传 ${MAX_FILES_PER_UPLOAD} 个文件，已截断多余的 ${truncatedCount} 个` });
      }

      // 防御性限制：filterValidFiles 默认会截断，这里兜底避免调用方传入不同上限。
      if (valid.length > MAX_FILES_PER_UPLOAD) {
        const overflowCount = valid.length - MAX_FILES_PER_UPLOAD;
        toast.showConfig('warn', { summary: '文件数量超限', detail: `单次最多上传 ${MAX_FILES_PER_UPLOAD} 个文件，已截断多余的 ${overflowCount} 个` });
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

      // 上传必须使用当前界面选择快照，避免防抖保存尚未落盘时读到旧配置。
      const selectedServicesSnapshot = [...selectedServices.value];
      const blockedRiskServices = config.publicServiceRiskAccepted
        ? []
        : selectedServicesSnapshot.filter(isPublicRiskService);
      const enabledServices = config.publicServiceRiskAccepted
        ? selectedServicesSnapshot
        : selectedServicesSnapshot.filter(serviceId => !isPublicRiskService(serviceId));

      // 验证是否选中了图床服务
      if (enabledServices.length === 0) {
        if (blockedRiskServices.length > 0) {
          toast.showConfig('warn', {
            summary: '需要确认公共图床风险',
            detail: '京东、七鱼等非官方公共图床需先在设置中确认风险后才能上传。',
            life: 6000,
          });
          return;
        }

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

      if (blockedRiskServices.length > 0) {
        toast.showConfig('warn', {
          summary: '已跳过未确认风险的图床',
          detail: '部分公共图床需先在设置中确认风险，本次仅上传到已允许的图床。',
          life: 6000,
        });
      }

      const sortedEnabled = [...enabledServices].sort();
      const sortedConfigured = [...(config.enabledServices ?? [])].sort();
      if (JSON.stringify(sortedEnabled) !== JSON.stringify(sortedConfigured)) {
        log.warn('检测到界面选择与配置不一致，本次上传使用界面选择快照');
      }

      config = {
        ...config,
        enabledServices: [...enabledServices],
      };

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
          `${valid.length} 个文件请求超时或中断，请检查网络\n建议：检查图床配置 / 切换图床`,
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
      const batchCollectedLinks: Array<Array<CopyLinkItem | undefined> | undefined> = [];
      const uploadSummary: UploadSessionSummary = {
        total: 0,
        success: 0,
        failed: 0,
        partialServiceFailureCount: 0,
        partialFailedServices: [],
        duplicatesSkipped: 0,
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
        // 关键：filePath 写入队列与历史的应该是用户原图路径，
        // uploadFilePath（可能是压缩后的临时文件）只用于喂给 uploader，
        // 否则上传后 cleanupTempFiles 把临时文件删掉，重试/元数据修复就找不到原图了
        const queueItems = actualFiles.map((uploadFilePath, index) => {
          const originalPath = batchFiles[index];
          const fileName = originalPath.split(/[/\\]/).pop() || originalPath;
          const itemId = queueManager!.addFile(originalPath, fileName, [...enabledServices]);
          return { itemId, filePath: originalPath, uploadFilePath, fileName };
        }).filter(item => item.itemId);

        // 同批次内被 isFileInQueue 拦截的重复路径计数（addFile 返回 null 时被 filter 过滤）
        const droppedAsDuplicate = actualFiles.length - queueItems.length;
        if (droppedAsDuplicate > 0) {
          uploadSummary.duplicatesSkipped = (uploadSummary.duplicatesSkipped ?? 0) + droppedAsDuplicate;
          log.info(`批次 ${batchIndex + 1}: ${droppedAsDuplicate} 张重复路径被忽略`);
        }

        if (queueItems.length === 0) {
          return;
        }

        // 3. 立即开始上传该批
        const batchLinks = await processUploadQueue(
          queueItems,
          config,
          enabledServices,
          5,
          {
            queueManager: queueManager!,
            saveHistoryItemImmediate,
            addResultToHistoryItem,
            reconcileHistoryPrimary,
            saveHistoryItem,
            toast,
          },
          undefined,
          uploadSummary
        );
        batchCollectedLinks[batchIndex] = batchLinks;

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
      collectedLinks.push(
        ...batchCollectedLinks.flatMap(batchLinks =>
          (batchLinks ?? []).filter((item): item is CopyLinkItem => Boolean(item))
        )
      );

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
    selectFiles: () => selectFiles(toast),
    handleFilesUpload,
    loadServiceButtonStates,
    toggleServiceSelection,
    saveHistoryItem,
    setupConfigListener
  };
}
