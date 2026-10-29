// src/composables/useUpload.ts
// 上传管理 Composable - 上传流程编排（核心协调器）

import { activeUploads, isUploading } from './uploadState';
import { configStore } from '@/store/instances';
import { filterValidFiles, selectFiles, MAX_FILES_PER_UPLOAD } from './FileValidator';
import { processUploadQueue } from './UploadExecutor';
import type {
  UserConfig} from '@/config/types';
import {
  DEFAULT_CONFIG,
  isPublicRiskService,
} from '@/config/types';
import type { UploadQueueManager } from '@/core/UploadQueue';
import { UPLOAD_CONCURRENCY } from '@/core/uploadConcurrency';
import { useToast } from '@/composables/useToast';
import { useCopyLink, type CopyLinkItem, type CopyLinkResult } from '@/composables/useCopyLink';
import { TOAST_MESSAGES } from '@/constants';
import { checkNetworkConnectivity } from '@/utils/network';
import { chunkArray } from '@/utils/semaphore';
import { useServiceSelector } from '@/composables/service/useServiceSelector';
import { useHistorySaver } from '@/composables/history/useHistorySaver';
import { fetchMetadataBatch, getImageMetadata } from '@/composables/image/useImageMetadata';
import { resolveActivePreset, useImageCompress, type CompressedFile } from '@/composables/image/useImageCompress';
import { createLogger } from '@/utils/logger';
import { buildUploadSummaryToast, type UploadSessionSummary, type UploadCopySummary } from '@/utils/uploadSummary';
import { describeUploadFailure, NETWORK_DOWN_ERROR } from '@/utils/uploadFailureMessage';

const log = createLogger('useUpload');

// --- 配置 ---
const METADATA_BATCH_SIZE = 50;  // 每批处理 50 张图片

/** 进了队列、准备时出了意外一直没开始传的那几张，失败原因这么写 */
const PREPARE_FAILED_ERROR = '准备上传时出错，请重试';

/** 进了上传队列的一张：队列与历史记原图路径 */
interface QueuedFile {
  itemId: string;
  filePath: string;
  fileName: string;
}

const fileNameOf = (filePath: string) => filePath.split(/[/\\]/).pop() || filePath;

export interface UploadManagerOptions {
  /** 返回 true 时上传结果已画在页面上（首页焦点卡 / 批量卡片）：不弹汇总通知，也不为单张失败弹通知 */
  resultsOnScreen?: () => boolean;
}

export interface UploadRequestOptions {
  /** 只对这一次上传使用这些图床（首页「换个图床」），不改「上传到」的勾选 */
  services?: string[];
  /** 这一次的图进了队列（首页按「一次上传操作」把它们归成一组）；几次上传同时进行时各记各的 */
  onQueued?: (itemIds: string[]) => void;
  /** 这一次自动复制成功后（单张在第一个图床传完时，多张在整批结束时） */
  onCopied?: (result: CopyLinkResult) => void;
}

/**
 * 最近一次进了队列的上传是第几次：几次上传同时进行时，只有最新的那次自动复制，
 * 较早那次晚传完不覆盖剪贴板里新的那张的链接（焦点卡也已换成新的那张）
 */
let latestQueued = 0;

/**
 * 上传管理 Composable
 */
export function useUploadManager(queueManager?: UploadQueueManager, options: UploadManagerOptions = {}) {
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
    if (options.resultsOnScreen?.()) return;
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
   * 用户一动手，这几张就进队列：首页焦点卡 / 批量卡当场换成它们，联网检测、读尺寸、压缩都算「上传中」
   * （开着压缩传大照片要压好几秒，压完才进队列的话，这期间界面上什么都不变）。已经在传的同一个文件跳过
   */
  function queueFiles(queue: UploadQueueManager, filePaths: string[], services: string[]): QueuedFile[] {
    return filePaths.flatMap((filePath) => {
      const fileName = fileNameOf(filePath);
      const itemId = queue.addFile(filePath, fileName, [...services]);
      return itemId ? [{ itemId, filePath, fileName }] : [];
    });
  }

  /**
   * 进了队列却没开始传的（网络不通、准备时出了意外）：不去白等每个图床超时，每个图床都标成失败、写清原因，
   * 首页卡片上就有「重试」（HomeScreen H06）；首页不在屏时再弹通知
   */
  function failBeforeUpload(queue: UploadQueueManager, items: readonly QueuedFile[], services: string[], error: string): void {
    for (const { itemId } of items) {
      queue.updateItem(itemId, {
        // 和正常上传一样先分好历史记录 id，重试传上了就记在这条下面
        historyId: crypto.randomUUID(),
        serviceProgress: Object.fromEntries(services.map((serviceId) => [
          serviceId,
          { serviceId, progress: 0, status: '✗ 失败', error },
        ])),
      });
      queue.markItemFailed(itemId, error);
    }
    if (items.length === 0 || options.resultsOnScreen?.()) return;
    const { reason, advice } = describeUploadFailure(undefined, error);
    const title = items.length === 1 ? `${items[0].fileName} 上传失败` : `${items.length} 张上传失败`;
    toast.error(title, `${reason}，${advice}`, 5000);
  }

  /**
   * 处理文件上传
   * @param filePaths 文件路径列表
   */
  async function handleFilesUpload(filePaths: string[], request: UploadRequestOptions = {}): Promise<void> {
    // 验证输入
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      log.warn('无效的文件列表:', filePaths);
      return;
    }

    const { compressImageBatch, cleanupTempFiles } = useImageCompress();
    let compressionEnabled = false;
    /** 这次进了队列的；结束时还没开始传的按失败处理 */
    let queued: QueuedFile[] = [];
    let queuedServices: string[] = [];

    // 几次上传可以同时进行：上一次还有图床在传（慢、重试、等超时）时，这一次照样立即开始。
    // 紧贴着 try：finally 里减回去，这中间不能有会抛错的语句
    activeUploads.value += 1;
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
      const selectedServicesSnapshot = [...(request.services ?? selectedServices.value)];
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
            detail: '京东、七鱼等公共图床需先确认风险：请在首页「上传到」重新勾选。',
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
          toast.showConfig('error', TOAST_MESSAGES.upload.noHost);
        }
        return;
      }

      if (blockedRiskServices.length > 0) {
        toast.showConfig('warn', {
          summary: '已跳过未确认风险的图床',
          detail: '部分公共图床尚未确认风险，本次只上传到其余图床；在首页「上传到」重新勾选即可确认。',
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

      queued = queueFiles(queueManager, valid, enabledServices);
      queuedServices = enabledServices;
      const order = queued.length > 0 ? ++latestQueued : latestQueued;
      const isNewest = () => queued.length > 0 && order === latestQueued;
      if (queued.length > 0) request.onQueued?.(queued.map(({ itemId }) => itemId));
      const duplicatesSkipped = valid.length - queued.length;
      if (duplicatesSkipped > 0) log.info(`${duplicatesSkipped} 张已在上传中，这次跳过`);

      // ⭐ 异步检测网络（图已经在队列里，这段算「上传中」）
      const isNetworkAvailable = await checkNetworkConnectivity();
      if (!isNetworkAvailable) {
        failBeforeUpload(queueManager, queued, enabledServices, NETWORK_DOWN_ERROR);
        return;
      }

      // ⭐ 流水线处理：分批获取元数据 + 上传
      // 每批 50 张图片，限制同时进行的批次数量避免网络拥塞
      const batches = chunkArray(queued, METADATA_BATCH_SIZE);
      // 一次只跑一个批次，批内同时传 UPLOAD_CONCURRENCY 张，总并发才是 3 张
      const MAX_CONCURRENT_BATCHES = 1;
      log.info(`开始流水线处理：${queued.length} 个文件，分 ${batches.length} 批，最大并发 ${MAX_CONCURRENT_BATCHES} 批`);

      // 收集成功上传的链接（用于自动复制）
      const collectedLinks: CopyLinkItem[] = [];
      const batchCollectedLinks: Array<Array<CopyLinkItem | undefined> | undefined> = [];
      const uploadSummary: UploadSessionSummary = {
        total: 0,
        success: 0,
        failed: 0,
        partialServiceFailureCount: 0,
        partialFailedServices: [],
        duplicatesSkipped,
      };

      const autoCopyEnabled = config.linkOutput?.autoCopy !== false;
      // 单张：「复制时使用」的链接一确定就复制，其余图床在后台继续；多张：整批结束后一次复制（交接说明规则 4.9）
      let earlyCopyResult: CopyLinkResult | null = null;
      const onPrimaryReady = autoCopyEnabled && queued.length === 1
        ? async (_queueIndex: number, link: CopyLinkItem) => {
          if (!isNewest()) return;
          const result = await copyLinks([link], { showSuccessToast: false, showErrorToast: false });
          earlyCopyResult = result;
          if (result.ok) request.onCopied?.(result);
        }
        : undefined;

      const compressionConfig = config.imageCompression ?? DEFAULT_CONFIG.imageCompression!;
      compressionEnabled = compressionConfig.enabled;
      const activePreset = resolveActivePreset(compressionConfig);

      // 批次处理函数
      const processBatch = async (batch: QueuedFile[], batchIndex: number) => {
        const batchFiles = batch.map((file) => file.filePath);
        // 1. 批量获取元数据（并发控制）
        // 这会预填充缓存，后续 saveHistoryItemImmediate 会直接使用缓存
        try {
          await fetchMetadataBatch(batchFiles);
        } catch (metaError) {
          log.warn(`批次 ${batchIndex + 1} 元数据获取失败，继续上传:`, metaError);
        }

        // 1.5 图片压缩预处理
        let compressedFiles = new Map<string, CompressedFile>();
        if (compressionConfig.enabled) {
          try {
            const fileSizes = new Map<string, number>();
            const metaResults = await Promise.all(
              batchFiles.map(fp => getImageMetadata(fp).catch(() => null))
            );
            metaResults.forEach((meta, i) => {
              if (meta?.file_size) fileSizes.set(batchFiles[i], meta.file_size);
            });

            compressedFiles = await compressImageBatch(batchFiles, activePreset, fileSizes);
            if (compressedFiles.size > 0) {
              log.info(`批次 ${batchIndex + 1}: ${compressedFiles.size} 张图片已压缩`);
            }
          } catch (compressError) {
            log.warn(`批次 ${batchIndex + 1} 压缩失败，使用原图:`, compressError);
          }
        }

        // 2. 压缩过的换成压缩后的文件去传
        // 关键：filePath 写入队列与历史的应该是用户原图路径，
        // uploadFilePath（可能是压缩后的临时文件）只用于喂给 uploader，
        // 否则上传后 cleanupTempFiles 把临时文件删掉，重试/元数据修复就找不到原图了
        const queueItems = batch.map(({ itemId, filePath, fileName }) => {
          const compressed = compressedFiles.get(filePath);
          if (compressed?.size) queueManager!.updateItem(itemId, { compressedSize: compressed.size });
          return { itemId, filePath, uploadFilePath: compressed?.path ?? filePath, fileName };
        });

        // 3. 立即开始上传该批
        const batchLinks = await processUploadQueue(
          queueItems,
          config,
          enabledServices,
          UPLOAD_CONCURRENCY,
          {
            queueManager: queueManager!,
            saveHistoryItemImmediate,
            addResultToHistoryItem,
            reconcileHistoryPrimary,
            saveHistoryItem,
            toast,
            onPrimaryReady,
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

      // 自动复制链接到剪贴板（使用统一 useCopyLink）；单张已在第一时间复制过
      let copyResult: CopyLinkResult | null = earlyCopyResult;
      if (autoCopyEnabled && collectedLinks.length > 0 && !copyResult && isNewest()) {
        copyResult = await copyLinks(collectedLinks, {
          showSuccessToast: false,
          showErrorToast: false,
        });
        if (copyResult.ok) request.onCopied?.(copyResult);
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
      // 准备时出了意外（如某一批中途抛错）、一直没开始传的：标成失败，别让焦点卡一直「上传中」
      const stuck = queued.filter(({ itemId }) => queueManager?.getItem(itemId)?.status === 'pending');
      if (queueManager && stuck.length > 0) failBeforeUpload(queueManager, stuck, queuedServices, PREPARE_FAILED_ERROR);
      activeUploads.value -= 1;
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
