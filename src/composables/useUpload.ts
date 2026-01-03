// src/composables/useUpload.ts
// 上传管理 Composable - 封装文件选择、上传、历史记录保存等功能

import { ref, Ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { basename } from '@tauri-apps/api/path';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Store } from '../store';
import {
  UserConfig,
  DEFAULT_CONFIG,
  ServiceType,
  HistoryItem,
  ImageMetadata
} from '../config/types';
import { MultiServiceUploader, MultiUploadResult, SingleServiceResult } from '../core/MultiServiceUploader';
import { UploadQueueManager } from '../uploadQueue';
import { useToast } from './useToast';
import { invalidateCache } from './useHistory';
import { emitHistoryUpdated } from '../events/cacheEvents';
import { debounceWithError } from '../utils/debounce';
import { checkNetworkConnectivity } from '../utils/network';
import { historyDB } from '../services/HistoryDatabase';
import { Semaphore, chunkArray } from '../utils/semaphore';

// --- 图片元信息缓存（避免重复获取） ---
const imageMetadataCache = new Map<string, ImageMetadata>();

/**
 * 获取图片元信息
 * 使用缓存避免重复调用 Rust 命令
 * @param filePath 图片文件路径
 * @returns 图片元信息
 */
async function getImageMetadata(filePath: string): Promise<ImageMetadata> {
  // 检查缓存
  if (imageMetadataCache.has(filePath)) {
    return imageMetadataCache.get(filePath)!;
  }

  try {
    const metadata = await invoke<ImageMetadata>('get_image_metadata', { filePath });
    // 缓存结果
    imageMetadataCache.set(filePath, metadata);
    return metadata;
  } catch (error) {
    console.error('[元信息] 获取图片元信息失败:', error);
    // 返回默认值，避免阻塞上传流程
    return {
      width: 0,
      height: 0,
      aspect_ratio: 1,
      file_size: 0,
      format: 'unknown'
    };
  }
}

/**
 * 清理图片元信息缓存
 * @param filePath 可选，指定要清理的文件路径；不传则清理全部
 */
function clearImageMetadataCache(filePath?: string): void {
  if (filePath) {
    imageMetadataCache.delete(filePath);
  } else {
    imageMetadataCache.clear();
  }
}

// --- 分批获取元数据配置 ---
const METADATA_BATCH_SIZE = 50;  // 每批处理 50 张图片
const METADATA_CONCURRENCY = 5;  // 元数据获取并发数

/**
 * 批量获取图片元数据（带并发控制）
 * 性能优化：分批获取避免同时发起大量请求
 * @param filePaths 文件路径列表
 * @param concurrency 并发数（默认 5）
 * @returns 文件路径到元数据的 Map
 */
async function fetchMetadataBatch(
  filePaths: string[],
  concurrency: number = METADATA_CONCURRENCY
): Promise<Map<string, ImageMetadata>> {
  const results = new Map<string, ImageMetadata>();
  const semaphore = new Semaphore(concurrency);

  await Promise.all(filePaths.map(async (filePath) => {
    await semaphore.acquire();
    try {
      const metadata = await getImageMetadata(filePath);
      results.set(filePath, metadata);
    } finally {
      semaphore.release();
    }
  }));

  return results;
}

// --- STORES ---
const configStore = new Store('.settings.dat');

/**
 * 上传管理 Composable
 */
export function useUploadManager(queueManager?: UploadQueueManager) {
  const toast = useToast();

  // 选中的图床服务列表（用户在上传界面选中的）
  const selectedServices: Ref<ServiceType[]> = ref([]);

  // 可用的图床服务列表（在设置中启用的）
  const availableServices: Ref<ServiceType[]> = ref([]);

  // 各图床的配置状态（是否已配置完成）
  const serviceConfigStatus: Ref<Record<ServiceType, boolean>> = ref({
    weibo: false,
    r2: false,

    jd: true,   // 京东开箱即用
    nowcoder: false,
    qiyu: false,
    zhihu: false,
    nami: false
  });

  // 当前活跃的链接前缀
  const activePrefix = ref<string | null>(null);

  // 上传中状态
  const isUploading = ref(false);

  /**
   * 保存启用的服务到配置
   * 防抖版本，避免频繁写入
   */
  const saveEnabledServicesToConfig = debounceWithError(
    async (services: ServiceType[]) => {
      try {
        console.log('[配置保存] 保存图床选择到配置:', services);

        // 获取当前配置
        let config: UserConfig | null = null;
        try {
          config = await configStore.get<UserConfig>('config');
        } catch (error) {
          console.error('[配置保存] 读取配置失败:', error);
          throw error;
        }

        // 如果配置不存在，使用默认配置
        if (!config) {
          config = DEFAULT_CONFIG;
        }

        // 更新启用的服务
        config.enabledServices = [...services]; // 创建副本

        // 保存配置
        await configStore.set('config', config);
        await configStore.save();

        console.log('[配置保存] ✓ 图床选择已保存');
      } catch (error) {
        console.error('[配置保存] 保存失败:', error);
        throw error;
      }
    },
    500, // 500ms 防抖延迟
    (_error) => {
      toast.warn('保存失败', '图床选择保存失败，请重试');
    }
  );

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
      console.error('[上传] 文件选择失败:', error);
      toast.error('文件选择失败', errorMsg);
      return null;
    }
  }

  /**
   * 处理文件上传
   * @param filePaths 文件路径列表
   */
  async function handleFilesUpload(filePaths: string[]): Promise<void> {
    try {
      // 验证输入
      if (!Array.isArray(filePaths) || filePaths.length === 0) {
        console.warn('[上传] 无效的文件列表:', filePaths);
        return;
      }

      console.log('[上传] 接收到文件:', filePaths);

      // 文件类型验证
      const { valid, invalid } = await filterValidFiles(filePaths);

      if (valid.length === 0) {
        console.warn('[上传] 没有有效的图片文件');
        toast.warn('未检测到图片', '请选择有效的图片文件（支持 JPG, PNG, GIF, WEBP, BMP）');
        return;
      }

      if (invalid.length > 0) {
        toast.warn('部分格式不支持', `已自动忽略 ${invalid.length} 个不支持的文件`);
      }

      console.log(`[上传] 有效文件: ${valid.length}个，无效文件: ${invalid.length}个`);

      // 获取配置
      let config: UserConfig | null = null;
      try {
        config = await configStore.get<UserConfig>('config');
      } catch (error) {
        console.error('[上传] 读取配置失败:', error);
        toast.error('配置加载异常', '读取配置文件失败，请刷新或稍后重试');
        return;
      }

      // 验证配置存在
      if (!config) {
        console.warn('[上传] 配置不存在，使用默认配置');
        config = DEFAULT_CONFIG;
      }

      // 关键修改：使用配置中的服务列表，而不是界面状态
      const enabledServices = config.enabledServices || selectedServices.value;

      // 验证是否选中了图床服务
      if (enabledServices.length === 0) {
        console.warn('[上传] 没有选择任何图床');

        // 检查是否有已配置的图床可供选择
        const hasConfiguredServices = Object.values(serviceConfigStatus.value).some(status => status === true);

        if (hasConfiguredServices) {
          // 有已配置的图床但未选中
          toast.error('未选择图床', '请在上传界面选择至少一个图床服务');
        } else {
          // 没有任何已配置的图床
          toast.error('未配置图床', '请前往设置页启用至少一个图床服务');
        }
        return;
      }

      // 同步界面状态和配置状态（修复：先复制再排序，避免修改原数组）
      const sortedEnabled = [...enabledServices].sort();
      const sortedSelected = [...selectedServices.value].sort();
      if (JSON.stringify(sortedEnabled) !== JSON.stringify(sortedSelected)) {
        console.warn('[上传] 检测到状态不一致，同步中...');
        selectedServices.value = [...enabledServices];
      }

      console.log(`[上传] 启用的图床:`, enabledServices);

      // ⭐ 检查队列管理器
      if (!queueManager) {
        console.error('[上传] 队列管理器未初始化');
        toast.error('上传错误', '队列管理器未初始化');
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
      // 每批 50 张图片，避免同时发起大量请求
      const batches = chunkArray(valid, METADATA_BATCH_SIZE);
      console.log(`[上传] 开始流水线处理：${valid.length} 个文件，分 ${batches.length} 批`);

      isUploading.value = true;

      // 流水线处理各批次（并行）
      // 每批：获取元数据 → 加入队列 → 开始上传
      const batchPromises = batches.map(async (batchFiles, batchIndex) => {
        console.log(`[上传] 批次 ${batchIndex + 1}/${batches.length}：开始获取 ${batchFiles.length} 个文件的元数据`);

        // 1. 批量获取元数据（并发控制）
        // 这会预填充缓存，后续 saveHistoryItemImmediate 会直接使用缓存
        await fetchMetadataBatch(batchFiles);
        console.log(`[上传] 批次 ${batchIndex + 1}：元数据获取完成`);

        // 2. 将该批文件加入队列
        const queueItems = batchFiles.map(filePath => {
          const fileName = filePath.split(/[/\\]/).pop() || filePath;
          const itemId = queueManager!.addFile(filePath, fileName, [...enabledServices]);
          return { itemId, filePath, fileName };
        }).filter(item => item.itemId);

        if (queueItems.length === 0) {
          console.log(`[上传] 批次 ${batchIndex + 1}：所有文件都是重复的`);
          return;
        }

        console.log(`[上传] 批次 ${batchIndex + 1}：已添加 ${queueItems.length} 个文件到队列，开始上传`);

        // 3. 立即开始上传该批
        await processUploadQueue(queueItems, config, enabledServices);

        console.log(`[上传] 批次 ${batchIndex + 1}：上传完成`);
      });

      // 等待所有批次完成
      await Promise.all(batchPromises);

      console.log('[上传] 所有批次处理完成');

      // 上传完成
      isUploading.value = false;

    } catch (error) {
      isUploading.value = false;
      console.error('[上传] 文件处理失败:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      toast.error('上传错误', `上传失败: ${errorMsg}`);
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
    enabledServices: ServiceType[],
    maxConcurrent: number = 5
  ): Promise<void> {
    if (!queueManager) {
      console.error('[并发上传] 上传队列管理器未初始化');
      toast.error('上传错误', '队列管理器未初始化');
      return;
    }

    console.log(`[并发上传] 开始处理 ${queueItems.length} 个文件，启用图床:`, enabledServices);

    const multiServiceUploader = new MultiServiceUploader();

    // 为每个队列项创建上传任务
    const uploadTasks = queueItems.map(({ itemId, filePath, fileName }) => {
      // itemId 在创建时已经过重复检查
      if (!itemId) {
        console.log(`[并发上传] 跳过无效队列项: ${fileName}`);
        return null; // 返回 null 表示跳过
      }

      return async () => {
        try {
          console.log(`[并发上传] 开始上传: ${fileName}`);

          // 跟踪历史记录 ID 和累积结果
          // 使用 UUID 生成唯一 ID，避免高并发时的 ID 碰撞
          const historyId = crypto.randomUUID();
          const allServiceResults: SingleServiceResult[] = [];

          // 方案 B：标志位跟踪历史记录是否已创建
          let historyCreated = false;
          let historyCreating = false; // 防止并发创建
          // 等待队列：在 historyCreating 期间到达的成功结果，待 historyCreated 后追加
          const pendingResults: SingleServiceResult[] = [];

          // 实时处理单个服务完成的函数
          const handleServiceResult = async (serviceResult: SingleServiceResult) => {
            // 记录此结果，确保后续保存时包含它
            allServiceResults.push(serviceResult);

            // 方案 B：第一个成功结果到达时立即创建历史记录
            if (serviceResult.status === 'success' && !historyCreated && !historyCreating) {
              historyCreating = true;
              try {
                // 立即创建历史记录（只包含当前这个成功结果）
                await saveHistoryItemImmediate(filePath, serviceResult, historyId);
                historyCreated = true;
                console.log(`[历史记录] 首个成功结果 ${serviceResult.serviceId} 已触发历史记录创建`);

                // 处理等待队列中的结果（在创建期间到达的其他成功结果）
                if (pendingResults.length > 0) {
                  console.log(`[历史记录] 处理等待队列: ${pendingResults.length} 个结果`);
                  for (const pending of pendingResults) {
                    addResultToHistoryItem(historyId, pending);
                  }
                  pendingResults.length = 0; // 清空队列
                }
              } catch (err) {
                console.error('[历史记录] 立即保存失败:', err);
                historyCreating = false; // 重置，允许后续成功结果重试
              }
            } else if (serviceResult.status === 'success' && historyCreated) {
              // 后续成功结果追加到已有记录
              addResultToHistoryItem(historyId, serviceResult);
            } else if (serviceResult.status === 'success' && historyCreating && !historyCreated) {
              // 正在创建历史记录期间到达的结果，加入等待队列
              pendingResults.push(serviceResult);
              console.log(`[历史记录] ${serviceResult.serviceId} 加入等待队列`);
            }

            const item = queueManager!.getItem(itemId);
            if (!item) return;

            // 修复竞态条件：只更新当前服务的进度，不覆盖其他服务的状态
            // updateItem 会自动做深度合并，所以只需传递要更新的服务即可
            const serviceId = serviceResult.serviceId;
            let serviceUpdate: Record<string, any> = {};

            if (serviceResult.status === 'success' && serviceResult.result) {
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
            (singleResult) => {
              console.log(`[实时更新] ${singleResult.serviceId} 完成:`, singleResult.status);
              handleServiceResult(singleResult);
            }
          );

          console.log(`[并发上传] ${fileName} 全部完成，主力图床: ${result.primaryService}`);

          // 检查部分失败并显示警告 Toast
          if (result.isPartialSuccess && result.partialFailures) {
            const failedServiceNames = result.partialFailures
              .map(f => {
                const nameMap: Record<string, string> = {
                  weibo: '微博', r2: 'R2', jd: '京东',
                  nowcoder: '牛客', qiyu: '七鱼', zhihu: '知乎', nami: '纳米'
                };
                return nameMap[f.serviceId] || f.serviceId;
              })
              .join('、');

            toast.warn(
              '部分服务上传失败',
              `${fileName}: ${failedServiceNames} 上传失败，其余图床已完成`,
              5000
            );
          }

          // 双重保险：确保 UI 状态一致
          // 注意：不需要遍历 result.results，因为 handleServiceResult 已经处理了
          // 但为了保险起见，如果有遗漏的可以再更新一次 (此处略过，依赖 handleServiceResult)

          // 历史记录已在 handleServiceResult 中创建，无需兜底逻辑
          console.log(`[并发上传] 上传完成，历史记录已创建: ${historyCreated}，累积结果: ${allServiceResults.length} 个`);

          // 通知队列管理器上传成功（谁先上传完用谁的链接）
          let thumbUrl = result.primaryUrl;
          if (result.primaryService === 'weibo' && activePrefix.value) {
            thumbUrl = activePrefix.value + thumbUrl;
          }
          queueManager!.markItemComplete(itemId, thumbUrl);

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[并发上传] ${fileName} 上传失败:`, errorMsg);

          // 从错误消息中提取图床信息（所有图床失败时包含详细信息）
          let failedServices: string[] = [];

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
            toast.error(
              `${serviceName} 授权失效`,
              '登录凭证/Cookie 已过期，请前往更新',
              6000
            );
          } else if (errorMsg.includes('认证失败') || errorMsg.includes('authentication')) {
            // 认证错误
            const serviceName = failedServices.length > 0 ? failedServices.join('、') : '图床';
            toast.error(
              `${serviceName} 鉴权失败`,
              '请检查 AK/SK 或 Token 配置是否正确',
              5000
            );
          } else if (errorMsg.includes('所有图床上传均失败')) {
            // 所有图床都失败
            toast.error(
              '全线上传失败',
              `${fileName} 未能上传至任何图床`,
              5000
            );
          } else {
            // 通用错误
            toast.error(
              '上传异常',
              `${fileName}: ${errorMsg}`,
              5000
            );
          }

          // 新增:更新所有服务的失败状态
          const item = queueManager!.getItem(itemId);
          if (item && item.serviceProgress) {
            const updatedServiceProgress = { ...item.serviceProgress };
            enabledServices.forEach(serviceId => {
              if (updatedServiceProgress[serviceId]) {
                updatedServiceProgress[serviceId] = {
                  ...updatedServiceProgress[serviceId],
                  status: '✗ 失败',
                  progress: 0,
                  error: errorMsg
                };
              }
            });
            queueManager!.updateItem(itemId, {
              serviceProgress: updatedServiceProgress
            });
          }

          queueManager!.markItemFailed(itemId, errorMsg);
        }
      };
    }).filter(task => task !== null); // 过滤掉 null 值

    console.log(`[并发上传] 实际需要上传的文件数: ${uploadTasks.length}/${queueItems.length}`);

    // ✅ 改进的并发控制：使用信号量模式避免竞态条件
    let activeCount = 0;
    let taskIndex = 0;
    const results: PromiseSettledResult<void>[] = [];

    return new Promise<void>((resolve) => {
      const runNext = () => {
        // 所有任务都已启动且完成
        if (taskIndex >= uploadTasks.length && activeCount === 0) {
          console.log(`[并发上传] 所有文件处理完成`);
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
              console.error(`[并发上传] 任务 ${currentIndex} 失败:`, error);
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

  /**
   * 保存历史记录（多图床结果）
   * 直接插入 SQLite，无需读取全部数据
   * @param filePath 文件路径
   * @param uploadResult 多图床上传结果
   * @param customId 可选的自定义 ID
   * @param liveResults 实时结果引用（用于并发场景）
   */
  async function saveHistoryItem(
    filePath: string,
    uploadResult: MultiUploadResult,
    customId?: string,
    liveResults?: SingleServiceResult[]
  ): Promise<string | undefined> {
    try {
      // 获取本地文件名
      let fileName: string;
      try {
        fileName = await basename(filePath);
        if (!fileName || fileName.trim().length === 0) {
          fileName = filePath.split(/[/\\]/).pop() || '未知文件';
        }
      } catch {
        fileName = filePath.split(/[/\\]/).pop() || '未知文件';
      }

      // 创建历史记录项（只保存成功的图床结果，失败的不污染历史记录）
      // 关键逻辑：如果提供了 liveResults，则使用它作为数据源（它是最新的引用）
      // 否则回退到 snapshot 的 uploadResult.results
      const resultsSource = liveResults || uploadResult.results;
      const successfulResults = resultsSource.filter(r => r.status === 'success');

      // 使用传入的 ID 或生成新 UUID
      const newItemId = customId || crypto.randomUUID();

      // 获取图片元信息（用于 Justified Layout 布局）
      const metadata = await getImageMetadata(filePath);

      const newItem: HistoryItem = {
        id: newItemId,
        localFileName: fileName,
        timestamp: Date.now(),
        filePath: filePath,
        results: successfulResults,
        primaryService: uploadResult.primaryService,
        generatedLink: uploadResult.primaryUrl || '',
        // 图片元信息（简化版，移除了 colorType 和 hasAlpha）
        width: metadata.width,
        height: metadata.height,
        aspectRatio: metadata.aspect_ratio,
        fileSize: metadata.file_size,
        format: metadata.format
      };

      // 直接插入 SQLite（使用 insertOrIgnore 作为最后防线，处理极端情况下的 ID 冲突）
      await historyDB.insertOrIgnore(newItem);
      console.log('[历史记录] 已保存历史记录:', newItem.localFileName, '(尺寸:', metadata.width, 'x', metadata.height, ')');

      // 使历史记录缓存失效，下次切换到浏览界面时会重新加载
      invalidateCache();

      // 清理元信息缓存
      clearImageMetadataCache(filePath);

      return newItem.id;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[历史记录] 保存历史记录失败:', error);
      throw new Error(`保存历史记录失败: ${errorMsg}`);
    }
  }

  /**
   * 立即保存历史记录（方案 B：第一个成功结果到达时调用）
   * 创建只包含单个结果的历史记录，后续结果通过 addResultToHistoryItem 追加
   * @param filePath 文件路径
   * @param firstResult 第一个成功的上传结果
   * @param historyId 预生成的历史记录 ID
   */
  async function saveHistoryItemImmediate(
    filePath: string,
    firstResult: SingleServiceResult,
    historyId: string
  ): Promise<void> {
    // 获取本地文件名
    let fileName: string;
    try {
      fileName = await basename(filePath);
      if (!fileName || fileName.trim().length === 0) {
        fileName = filePath.split(/[/\\]/).pop() || '未知文件';
      }
    } catch {
      fileName = filePath.split(/[/\\]/).pop() || '未知文件';
    }

    // 获取图片元信息（用于 Justified Layout 布局）
    const metadata = await getImageMetadata(filePath);

    // 构建初始历史记录（只包含第一个成功结果 + 图片元信息）
    const newItem: HistoryItem = {
      id: historyId,
      localFileName: fileName,
      timestamp: Date.now(),
      filePath: filePath,
      results: [firstResult], // 只包含第一个成功结果
      primaryService: firstResult.serviceId,
      generatedLink: firstResult.result?.url || '',
      // 图片元信息（简化版，移除了 colorType 和 hasAlpha）
      width: metadata.width,
      height: metadata.height,
      aspectRatio: metadata.aspect_ratio,
      fileSize: metadata.file_size,
      format: metadata.format
    };

    // 直接插入 SQLite（使用 insertOrIgnore 作为最后防线，处理极端情况下的 ID 冲突）
    await historyDB.insertOrIgnore(newItem);
    console.log('[历史记录] 立即保存历史记录:', newItem.localFileName, '(主力图床:', firstResult.serviceId, ', 尺寸:', metadata.width, 'x', metadata.height, ')');

    // 使缓存失效并通知其他视图
    invalidateCache();
    emitHistoryUpdated([historyId]);

    // 清理元信息缓存（文件已上传完成）
    clearImageMetadataCache(filePath);
  }

  /**
   * 向已有历史记录添加结果（用于后台异步上传完成时更新）
   * 使用 SQLite 更新操作，无需读取全部数据
   *
   * 方案 B 优化：历史记录已在首个成功结果时创建
   * 保留简单的重试机制以应对极端情况（如 saveHistoryItemImmediate 仍在执行）
   */
  async function addResultToHistoryItem(historyId: string, result: SingleServiceResult): Promise<void> {
    if (!historyId || result.status !== 'success') return;

    // 简化的重试：最多 2 次，间隔 50ms（因为 saveHistoryItemImmediate 通常很快完成）
    const MAX_ATTEMPTS = 2;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        // 获取现有记录
        const item = await historyDB.getById(historyId);
        if (!item) {
          if (attempt < MAX_ATTEMPTS - 1) {
            // 短暂等待后重试
            await new Promise(resolve => setTimeout(resolve, 50));
            continue;
          }
          // 记录不存在，可能是首次保存失败，跳过
          console.warn(`[历史记录] 记录 ${historyId} 不存在，无法追加 ${result.serviceId} 结果`);
          return;
        }

        // 检查是否已存在该服务的结果（防止重复）
        const exists = item.results?.some((r: HistoryItem['results'][number]) => r.serviceId === result.serviceId);
        if (exists) {
          return; // 静默跳过，无需日志
        }

        // 追加新结果
        const updatedResults = [...(item.results || []), result];

        // 更新记录
        await historyDB.update(historyId, { results: updatedResults });
        console.log(`[历史记录] 追加结果: ${result.serviceId}`);

        invalidateCache();
        return;
      } catch (error) {
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        } else {
          console.error('[历史记录] 追加结果失败:', error);
        }
      }
    }
  }

  /**
   * 加载服务按钮状态（从配置）
   */
  async function loadServiceButtonStates(): Promise<void> {
    try {
      const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;

      // 加载可用服务列表（在设置中启用的图床）
      availableServices.value = config.availableServices || DEFAULT_CONFIG.availableServices || [];

      // 加载保存的选择状态
      const savedEnabledServices = config.enabledServices || DEFAULT_CONFIG.enabledServices;
      selectedServices.value = savedEnabledServices.filter(
        service => availableServices.value.includes(service)
      );

      // 立即保存当前选择，确保配置同步
      if (selectedServices.value.length > 0) {
        try {
          await saveEnabledServicesToConfig.immediate([...selectedServices.value]);
        } catch (error) {
          console.warn('[服务按钮] 初始同步保存失败:', error);
        }
      }

      // 更新各图床的配置状态
      await updateServiceConfigStatus(config);

      // 过滤掉未配置的已选图床（配置清空后自动取消选中）
      const previousSelected = [...selectedServices.value];
      selectedServices.value = selectedServices.value.filter(
        service => serviceConfigStatus.value[service]
      );

      // 如果有变化，保存到配置
      if (previousSelected.length !== selectedServices.value.length) {
        console.log('[服务按钮] 自动取消未配置图床的选中状态');
        try {
          await saveEnabledServicesToConfig.immediate([...selectedServices.value]);
        } catch (error) {
          console.warn('[服务按钮] 保存选择状态失败:', error);
        }
      }

      // 加载活跃前缀
      activePrefix.value = getActivePrefixFromConfig(config);

      console.log('[服务按钮] 已加载状态:', selectedServices.value, '(可用:', availableServices.value, ')');
    } catch (error) {
      console.error('[服务按钮] 加载状态失败:', error);
    }
  }

  /**
   * 更新服务配置状态（根据配置情况判断是否已配置）
   * @param config 用户配置
   */
  async function updateServiceConfigStatus(config: UserConfig): Promise<void> {
    if (!config.services) {
      config.services = {};
    }

    // TCL 和 JD 开箱即用

    serviceConfigStatus.value.jd = true;

    // 微博
    const weiboConfig = config.services.weibo;
    serviceConfigStatus.value.weibo = !!weiboConfig?.cookie && weiboConfig.cookie.trim().length > 0;

    // R2
    const r2Config = config.services.r2;
    serviceConfigStatus.value.r2 = !!(
      r2Config?.accountId &&
      r2Config.accessKeyId &&
      r2Config.secretAccessKey &&
      r2Config.bucketName
    );

    // 牛客
    const nowcoderConfig = config.services.nowcoder;
    serviceConfigStatus.value.nowcoder = !!nowcoderConfig?.cookie && nowcoderConfig.cookie.trim().length > 0;

    // 知乎
    const zhihuConfig = config.services.zhihu;
    serviceConfigStatus.value.zhihu = !!zhihuConfig?.cookie && zhihuConfig.cookie.trim().length > 0;

    // 七鱼：检测 Chrome/Edge 是否安装
    try {
      const chromeInstalled = await invoke<boolean>('check_chrome_installed');
      serviceConfigStatus.value.qiyu = chromeInstalled;
      if (!chromeInstalled) {
        console.warn('[七鱼] Chrome/Edge 未安装，服务不可用');
      }
    } catch (error) {
      console.error('[七鱼] Chrome 检测失败:', error);
      serviceConfigStatus.value.qiyu = false;
    }

    // 纳米
    const namiConfig = config.services.nami;
    serviceConfigStatus.value.nami = !!namiConfig?.cookie && namiConfig.cookie.trim().length > 0;
  }

  /**
   * 从配置中获取当前活跃的链接前缀
   * @param config 用户配置
   */
  function getActivePrefixFromConfig(config: UserConfig): string | null {
    if (!config.linkPrefixConfig?.enabled) return null;

    const index = config.linkPrefixConfig.selectedIndex;
    const list = config.linkPrefixConfig.prefixList || [];

    if (index >= 0 && index < list.length) {
      return list[index];
    }

    return list[0] || null;
  }

  /**
   * 切换图床服务选择
   * @param serviceId 图床服务ID
   */
  function toggleServiceSelection(serviceId: ServiceType): void {
    const index = selectedServices.value.indexOf(serviceId);
    if (index > -1) {
      // 取消选中
      selectedServices.value.splice(index, 1);
    } else {
      // 选中（无数量限制）
      selectedServices.value.push(serviceId);
    }

    console.log('[上传] 选中的图床:', selectedServices.value);

    // 立即保存到配置（防抖）
    saveEnabledServicesToConfig([...selectedServices.value]); // 传递副本
  }

  /**
   * 检查图床是否可用（在可用列表中且已配置）
   * @param serviceId 图床服务ID
   */
  const isServiceAvailable = computed(() => (serviceId: ServiceType): boolean => {
    return availableServices.value.includes(serviceId) && serviceConfigStatus.value[serviceId];
  });

  /**
   * 检查图床是否选中
   * @param serviceId 图床服务ID
   */
  const isServiceSelected = computed(() => (serviceId: ServiceType): boolean => {
    return selectedServices.value.includes(serviceId);
  });

  /**
   * 设置配置更新监听器
   * 当设置页面修改配置后，自动刷新服务按钮状态
   * @returns 清理函数
   */
  async function setupConfigListener(): Promise<UnlistenFn> {
    return await listen('config-updated', async () => {
      console.log('[上传管理] 收到配置更新事件，刷新服务按钮状态');
      await loadServiceButtonStates();
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
