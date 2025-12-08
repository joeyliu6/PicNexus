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
import { MultiServiceUploader, MultiUploadResult } from '../core/MultiServiceUploader';
import { UploadQueueManager } from '../uploadQueue';
import { useToast } from './useToast';
import { debounceWithError } from '../utils/debounce';

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
    (error) => {
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

      // 关键修改：使用配置中的服务列表，而不是界面状态
      const enabledServices = config.enabledServices || selectedServices.value;

      // 验证是否选中了图床服务
      if (enabledServices.length === 0) {
        console.warn('[上传] 没有选择任何图床');
        toast.error('配置缺失', '请至少选择一个图床服务！');
        return;
      }

      // 同步界面状态和配置状态
      if (JSON.stringify(enabledServices.sort()) !== JSON.stringify(selectedServices.value.sort())) {
        console.warn('[上传] 检测到状态不一致，同步中...');
        selectedServices.value = [...enabledServices];
      }

      console.log(`[上传] 启用的图床:`, enabledServices);

      // 标记为上传中
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
   * @param maxConcurrent 最大并发数（默认3）
   */
  async function processUploadQueue(
    filePaths: string[],
    config: UserConfig,
    enabledServices: ServiceType[],
    maxConcurrent: number = 3
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
          console.log(`[并发��传] 开始上传: ${fileName}`);

          // 使用多图床上传编排器
          const result = await multiServiceUploader.uploadToMultipleServices(
            filePath,
            enabledServices,
            config,
            (serviceId, percent, step, stepIndex, totalSteps) => {
              // 每个图床独立进度回调，传递步骤信息
              queueManager!.updateServiceProgress(
                itemId,
                serviceId,
                percent,
                step,
                stepIndex,
                totalSteps
              );
            }
          );

          console.log(`[并发上传] ${fileName} 上传完成，主力图床: ${result.primaryService}`);

          // 更新每个服务的链接信息
          result.results.forEach(serviceResult => {
            if (serviceResult.status === 'success' && serviceResult.result) {
              const item = queueManager!.getItem(itemId);
              if (item && item.serviceProgress[serviceResult.serviceId]) {
                // 微博链接需要加前缀
                let link = serviceResult.result.url;
                if (serviceResult.serviceId === 'weibo' && activePrefix.value) {
                  link = activePrefix.value + link;
                }
                queueManager!.updateItem(itemId, {
                  serviceProgress: {
                    ...item.serviceProgress,
                    [serviceResult.serviceId]: {
                      ...item.serviceProgress[serviceResult.serviceId],
                      link: link
                    }
                  }
                });
              }
            }
          });

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
          queueManager!.markItemFailed(itemId, errorMsg);
        }
      };
    }).filter(task => task !== null); // 过滤掉 null 值

    console.log(`[并发上传] 实际需要上传的文件数: ${uploadTasks.length}/${filePaths.length}`);

    // 使用并发限制执行上传任务
    const executing: Promise<void>[] = [];

    for (const task of uploadTasks) {
      const promise = task().finally(() => {
        executing.splice(executing.indexOf(promise), 1);
      });

      executing.push(promise);

      if (executing.length >= maxConcurrent) {
        await Promise.race(executing);
      }
    }

    // 等待所有剩余任务完成
    await Promise.all(executing);

    console.log(`[并发上传] 所有文件处理完成`);
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
    toggleServiceSelection
  };
}
