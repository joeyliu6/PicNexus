// src/composables/useUpload.ts
// 上传管理 Composable - 封装文件选择、上传、历史记录保存等功能

import { ref, Ref, computed } from 'vue';
import { dialog, invoke } from '@tauri-apps/api';
import { basename } from '@tauri-apps/api/path';
import { Store } from '../store';
import {
  UserConfig,
  DEFAULT_CONFIG,
  ServiceType,
  HistoryItem
} from '../config/types';
import { MultiServiceUploader, MultiUploadResult, SingleServiceResult } from '../core/MultiServiceUploader';
import { UploadQueueManager } from '../uploadQueue';
import { useToast } from './useToast';
import { debounceWithError } from '../utils/debounce';
import { checkNetworkConnectivity } from '../utils/network';

// --- STORES ---
const configStore = new Store('.settings.dat');
const historyStore = new Store('.history.dat');

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
    tcl: true,  // TCL 开箱即用
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
      const selected = await dialog.open({
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
        toast.warn('没有有效的图片', '请选择图片文件（jpg, png, gif, webp, bmp）');
        return;
      }

      if (invalid.length > 0) {
        toast.warn('部分文件无效', `已过滤 ${invalid.length} 个非图片文件`);
      }

      console.log(`[上传] 有效文件: ${valid.length}个，无效文件: ${invalid.length}个`);

      // 获取配置
      let config: UserConfig | null = null;
      try {
        config = await configStore.get<UserConfig>('config');
      } catch (error) {
        console.error('[上传] 读取配置失败:', error);
        toast.error('读取配置失败', '请重试');
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
        toast.error('配置缺失', '请至少选择一个图床服务！');
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

      // ⭐ 立即将所有文件加入队列（用户立即看到反馈）
      if (!queueManager) {
        console.error('[上传] 队列管理器未初始化');
        toast.error('上传错误', '队列管理器未初始化');
        return;
      }

      const queueItems = valid.map(filePath => {
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        const itemId = queueManager!.addFile(filePath, fileName, [...enabledServices]);
        return { itemId, filePath, fileName };
      }).filter(item => item.itemId); // 过滤重复文件

      if (queueItems.length === 0) {
        console.log('[上传] 所有文件都是重复的');
        return;
      }

      console.log(`[上传] 已添加 ${queueItems.length} 个文件到队列`);

      // ⭐ 异步检测网络（不阻塞UI）
      const isNetworkAvailable = await checkNetworkConnectivity();

      if (!isNetworkAvailable) {
        // 网络不通：将所有队列项标记为失败
        queueItems.forEach(({ itemId }) => {
          // 获取队列项
          const item = queueManager!.getItem(itemId!);
          if (item && item.serviceProgress) {
            // 更新所有图床的状态为失败
            const updatedServiceProgress = { ...item.serviceProgress };
            enabledServices.forEach(serviceId => {
              if (updatedServiceProgress[serviceId]) {
                updatedServiceProgress[serviceId] = {
                  ...updatedServiceProgress[serviceId],
                  status: '✗ 失败',
                  progress: 0,
                  error: '网络连接失败，请检查网络后重试'
                };
              }
            });
            queueManager!.updateItem(itemId!, {
              serviceProgress: updatedServiceProgress
            });
          }

          // 标记整体状态为失败
          queueManager!.markItemFailed(
            itemId!,
            '网络连接失败，请检查网络后重试'
          );
        });

        toast.error(
          '网络连接失败',
          `${queueItems.length}个文件未能上传，请检查网络后重试`
        );
        return;
      }

      // 网络正常，开始上传
      console.log('[上传] 网络检测通过，开始上传');
      isUploading.value = true;

      // 并发处理上传队列
      await processUploadQueue(valid, config, enabledServices);

      console.log('[上传] 上传队列处理完成');

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
   * @param filePaths 文件路径列表
   * @param config 用户配置
   * @param enabledServices 启用的图床服务列表
   * @param maxConcurrent 最大并发数（默认5，提升吞吐量）
   */
  async function processUploadQueue(
    filePaths: string[],
    config: UserConfig,
    enabledServices: ServiceType[],
    maxConcurrent: number = 5
  ): Promise<void> {
    if (!queueManager) {
      console.error('[并发上传] 上传队列管理器未初始化');
      toast.error('上传错误', '队列管理器未初始化');
      return;
    }

    console.log(`[并发上传] 开始处理 ${filePaths.length} 个文件，启用图床:`, enabledServices);

    const multiServiceUploader = new MultiServiceUploader();

    // 为每个文件创建队列项
    const uploadTasks = filePaths.map(filePath => {
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      const itemId = queueManager!.addFile(filePath, fileName, [...enabledServices]);  // 传递数组副本

      // 检查是否因为重复而跳过
      if (!itemId) {
        console.log(`[并发上传] 跳过重复文件: ${fileName}`);
        return null; // 返回 null 表示跳过
      }

      return async () => {
        try {
          console.log(`[并发上传] 开始上传: ${fileName}`);

          // 实时处理单个服务完成的函数
          const handleServiceResult = (serviceResult: SingleServiceResult) => {
            const item = queueManager!.getItem(itemId);
            if (!item) return;

            const updatedServiceProgress = { ...item.serviceProgress };

            if (serviceResult.status === 'success' && serviceResult.result) {
              // 成功：立即更新状态并显示链接
              let link = serviceResult.result.url;
              if (serviceResult.serviceId === 'weibo' && activePrefix.value) {
                link = activePrefix.value + link;
              }

              updatedServiceProgress[serviceResult.serviceId] = {
                ...updatedServiceProgress[serviceResult.serviceId],
                status: '✓ 完成',
                progress: 100,
                link: link
              };
            } else if (serviceResult.status === 'failed') {
              // 失败：更新错误状态
              updatedServiceProgress[serviceResult.serviceId] = {
                ...updatedServiceProgress[serviceResult.serviceId],
                status: '✗ 失败',
                progress: 0,
                error: serviceResult.error || '上传失败'
              };
            }

            // 实时更新 UI
            queueManager!.updateItem(itemId, {
              serviceProgress: updatedServiceProgress
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
                  weibo: '微博', r2: 'R2', tcl: 'TCL', jd: '京东',
                  nowcoder: '牛客', qiyu: '七鱼', zhihu: '知乎', nami: '纳米'
                };
                return nameMap[f.serviceId] || f.serviceId;
              })
              .join('、');

            toast.warn(
              '部分图床上传失败',
              `${fileName} 的 ${failedServiceNames} 上传失败，但主力图床已成功`,
              5000
            );
          }

          // 双重保险：实时回调已处理各服务状态，此处作为最终确认
          // 确保所有状态在 Promise.all 完成后都是最新的
          const item = queueManager!.getItem(itemId);
          if (item) {
            const updatedServiceProgress = { ...item.serviceProgress };

            result.results.forEach(serviceResult => {
              if (updatedServiceProgress[serviceResult.serviceId]) {
                if (serviceResult.status === 'success' && serviceResult.result) {
                  let link = serviceResult.result.url;
                  if (serviceResult.serviceId === 'weibo' && activePrefix.value) {
                    link = activePrefix.value + link;
                  }

                  updatedServiceProgress[serviceResult.serviceId] = {
                    ...updatedServiceProgress[serviceResult.serviceId],
                    status: '✓ 完成',
                    progress: 100,
                    link: link
                  };
                } else if (serviceResult.status === 'failed') {
                  updatedServiceProgress[serviceResult.serviceId] = {
                    ...updatedServiceProgress[serviceResult.serviceId],
                    status: '✗ 失败',
                    progress: 0,
                    error: serviceResult.error || '上传失败'
                  };
                }
              }
            });

            queueManager!.updateItem(itemId, {
              serviceProgress: updatedServiceProgress
            });
          }

          // 保存历史记录
          await saveHistoryItem(filePath, result);

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
              `${serviceName} Cookie 已过期`,
              '请前往设置页面更新 Cookie 后重试',
              6000
            );
          } else if (errorMsg.includes('认证失败') || errorMsg.includes('authentication')) {
            // 认证错误
            const serviceName = failedServices.length > 0 ? failedServices.join('、') : '图床';
            toast.error(
              `${serviceName}认证失败`,
              '请检查配置信息是否正确',
              5000
            );
          } else if (errorMsg.includes('所有图床上传均失败')) {
            // 所有图床都失败 - 显示失败的图床列表
            const servicesText = failedServices.length > 0
              ? failedServices.join('、')
              : '所有图床';
            toast.error(
              '上传失败',
              `${fileName} 的 ${servicesText} 上传均失败，请检查网络连接和服务配置`,
              5000
            );
          } else {
            // 通用错误
            toast.error(
              '上传失败',
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

    console.log(`[并发上传] 实际需要上传的文件数: ${uploadTasks.length}/${filePaths.length}`);

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
   * @param filePath 文件路径
   * @param uploadResult 多图床上传结果
   */
  async function saveHistoryItem(
    filePath: string,
    uploadResult: MultiUploadResult
  ): Promise<void> {
    try {
      let items: HistoryItem[] = [];

      try {
        items = await historyStore.get<HistoryItem[]>('uploads') || [];
        if (!Array.isArray(items)) {
          items = [];
        }
      } catch (readError: any) {
        console.error('[历史记录] 读取历史记录失败:', readError?.message || String(readError));
        items = [];
      }

      // 获取本地文件名
      let fileName: string;
      try {
        fileName = await basename(filePath);
        if (!fileName || fileName.trim().length === 0) {
          fileName = filePath.split(/[/\\]/).pop() || '未知文件';
        }
      } catch (nameError: any) {
        fileName = filePath.split(/[/\\]/).pop() || '未知文件';
      }

      // 创建历史记录项
      const newItem: HistoryItem = {
        id: `${Date.now()}_${Math.random().toString(36).substring(7)}`,
        localFileName: fileName,
        timestamp: Date.now(),
        filePath: filePath,
        results: uploadResult.results,
        primaryService: uploadResult.primaryService,
        generatedLink: uploadResult.primaryUrl || ''
      };

      // 添加到历史记录（最新的在前面）
      items.unshift(newItem);

      // 保存
      try {
        await historyStore.set('uploads', items);
        await historyStore.save();
        console.log('[历史记录] 已保存历史记录:', newItem.localFileName);
      } catch (saveError: any) {
        console.error('[历史记录] 保存历史记录失败:', saveError?.message || String(saveError));
        throw new Error(`保存历史记录失败: ${saveError?.message || String(saveError)}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[历史记录] 保存历史记录失败:', error);
      throw new Error(`保存历史记录失败: ${errorMsg}`);
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
    serviceConfigStatus.value.tcl = true;
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
    saveHistoryItem
  };
}
