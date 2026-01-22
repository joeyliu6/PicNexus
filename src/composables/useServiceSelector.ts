// 图床服务选择模块 - 管理图床服务的选择状态、配置状态和可用性

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Store } from '../store';
import type { UserConfig, ServiceType } from '../config/types';
import { DEFAULT_CONFIG } from '../config/types';
import { useToast } from './useToast';
import { useServiceAvailability } from './useServiceAvailability';
import { TOAST_MESSAGES } from '../constants';
import { debounceWithError } from '../utils/debounce';

// ==================== 类型定义 ====================

export interface UseServiceSelectorReturn {
  selectedServices: Ref<ServiceType[]>;
  availableServices: Ref<ServiceType[]>;
  serviceConfigStatus: Ref<Record<ServiceType, boolean>>;
  activePrefix: Ref<string | null>;

  isServiceAvailable: ComputedRef<(serviceId: ServiceType) => boolean>;
  isServiceSelected: ComputedRef<(serviceId: ServiceType) => boolean>;

  loadServiceButtonStates(): Promise<void>;
  toggleServiceSelection(serviceId: ServiceType): void;
  saveEnabledServicesToConfig(services: ServiceType[]): void;
  updateServiceConfigStatus(config: UserConfig): Promise<void>;
  setupConfigListener(): Promise<UnlistenFn>;
}

// ==================== 模块级共享状态（单例） ====================

const configStore = new Store('.settings.dat');

const selectedServices = ref<ServiceType[]>([]);
const availableServices = ref<ServiceType[]>([]);
const serviceConfigStatus = ref<Record<ServiceType, boolean>>({
  weibo: false,
  r2: false,
  jd: true,
  nowcoder: false,
  qiyu: false,
  zhihu: false,
  nami: false,
  bilibili: false,
  chaoxing: false,
  smms: false,
  github: false,
  imgur: false,
  tencent: false,
  aliyun: false,
  qiniu: false,
  upyun: false
});
const activePrefix = ref<string | null>(null);

// ==================== 内部辅助函数 ====================

function getActivePrefixFromConfig(config: UserConfig): string | null {
  if (!config.linkPrefixConfig?.enabled) return null;

  const index = config.linkPrefixConfig.selectedIndex;
  const list = config.linkPrefixConfig.prefixList || [];

  if (index >= 0 && index < list.length) {
    return list[index];
  }

  return list[0] || null;
}

// ==================== 主 Composable ====================

/**
 * 图床服务选择 Composable
 *
 * 使用模块级单例模式，所有组件共享同一份状态
 */
export function useServiceSelector(): UseServiceSelectorReturn {
  const toast = useToast();
  const { qiyuAvailable, checkQiyuAvailability } = useServiceAvailability();

  /**
   * 保存启用的服务到配置（防抖版本）
   */
  const saveEnabledServicesToConfigDebounced = debounceWithError(
    async (services: ServiceType[]) => {
      try {
        console.log('[配置保存] 保存图床选择到配置:', services);

        let config = await configStore.get<UserConfig>('config');
        if (!config) {
          config = DEFAULT_CONFIG;
        }

        config.enabledServices = [...services];

        await configStore.set('config', config);
        await configStore.save();

        console.log('[配置保存] ✓ 图床选择已保存');
      } catch (error) {
        console.error('[配置保存] 保存失败:', error);
        throw error;
      }
    },
    500,
    (_error) => {
      toast.showConfig('warn', TOAST_MESSAGES.config.saveFailed('图床选择保存失败，请重试'));
    }
  );

  /**
   * 保存启用的服务到配置
   */
  function saveEnabledServicesToConfig(services: ServiceType[]): void {
    saveEnabledServicesToConfigDebounced(services);
  }

  /**
   * 更新服务配置状态
   */
  async function updateServiceConfigStatus(config: UserConfig): Promise<void> {
    if (!config.services) {
      config.services = {};
    }

    // JD 开箱即用
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

    // 七鱼：复用 useServiceAvailability 的检测结果
    try {
      await checkQiyuAvailability(false);
      serviceConfigStatus.value.qiyu = qiyuAvailable.value;
    } catch (error) {
      console.error('[七鱼] 检测失败:', error);
      serviceConfigStatus.value.qiyu = false;
    }

    // 纳米
    const namiConfig = config.services.nami;
    serviceConfigStatus.value.nami = !!namiConfig?.cookie && namiConfig.cookie.trim().length > 0;

    // 哔哩哔哩
    const bilibiliConfig = config.services.bilibili;
    serviceConfigStatus.value.bilibili = !!bilibiliConfig?.cookie && bilibiliConfig.cookie.trim().length > 0;

    // 超星
    const chaoxingConfig = config.services.chaoxing;
    serviceConfigStatus.value.chaoxing = !!chaoxingConfig?.cookie && chaoxingConfig.cookie.trim().length > 0;

    // SM.MS
    const smmsConfig = config.services.smms;
    serviceConfigStatus.value.smms = !!smmsConfig?.token && smmsConfig.token.trim().length > 0;

    // GitHub
    const githubConfig = config.services.github;
    serviceConfigStatus.value.github = !!(
      githubConfig?.token &&
      githubConfig.owner &&
      githubConfig.repo
    );

    // Imgur
    const imgurConfig = config.services.imgur;
    serviceConfigStatus.value.imgur = !!imgurConfig?.clientId && imgurConfig.clientId.trim().length > 0;

    // 腾讯云 COS
    const tencentConfig = config.services.tencent;
    serviceConfigStatus.value.tencent = !!(
      tencentConfig?.secretId &&
      tencentConfig.secretKey &&
      tencentConfig.bucket &&
      tencentConfig.region
    );

    // 阿里云 OSS
    const aliyunConfig = config.services.aliyun;
    serviceConfigStatus.value.aliyun = !!(
      aliyunConfig?.accessKeyId &&
      aliyunConfig.accessKeySecret &&
      aliyunConfig.bucket &&
      aliyunConfig.region
    );

    // 七牛云
    const qiniuConfig = config.services.qiniu;
    serviceConfigStatus.value.qiniu = !!(
      qiniuConfig?.accessKey &&
      qiniuConfig.secretKey &&
      qiniuConfig.bucket &&
      qiniuConfig.publicDomain
    );

    // 又拍云
    const upyunConfig = config.services.upyun;
    serviceConfigStatus.value.upyun = !!(
      upyunConfig?.operator &&
      upyunConfig.password &&
      upyunConfig.bucket &&
      upyunConfig.publicDomain
    );
  }

  /**
   * 加载服务按钮状态
   */
  async function loadServiceButtonStates(): Promise<void> {
    try {
      const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;

      availableServices.value = config.availableServices || DEFAULT_CONFIG.availableServices || [];

      const savedEnabledServices = config.enabledServices || DEFAULT_CONFIG.enabledServices;
      selectedServices.value = savedEnabledServices.filter(
        service => availableServices.value.includes(service)
      );

      if (selectedServices.value.length > 0) {
        try {
          await saveEnabledServicesToConfigDebounced.immediate([...selectedServices.value]);
        } catch (error) {
          console.warn('[服务按钮] 初始同步保存失败:', error);
        }
      }

      await updateServiceConfigStatus(config);

      const previousSelected = [...selectedServices.value];
      selectedServices.value = selectedServices.value.filter(
        service => serviceConfigStatus.value[service]
      );

      if (previousSelected.length !== selectedServices.value.length) {
        console.log('[服务按钮] 自动取消未配置图床的选中状态');
        try {
          await saveEnabledServicesToConfigDebounced.immediate([...selectedServices.value]);
        } catch (error) {
          console.warn('[服务按钮] 保存选择状态失败:', error);
        }
      }

      activePrefix.value = getActivePrefixFromConfig(config);

      console.log('[服务按钮] 已加载状态:', selectedServices.value, '(可用:', availableServices.value, ')');
    } catch (error) {
      console.error('[服务按钮] 加载状态失败:', error);
    }
  }

  /**
   * 切换图床服务选择
   */
  function toggleServiceSelection(serviceId: ServiceType): void {
    const index = selectedServices.value.indexOf(serviceId);
    if (index > -1) {
      selectedServices.value.splice(index, 1);
    } else {
      selectedServices.value.push(serviceId);
    }

    console.log('[上传] 选中的图床:', selectedServices.value);
    saveEnabledServicesToConfig([...selectedServices.value]);
  }

  /**
   * 检查图床是否可用
   */
  const isServiceAvailable = computed(() => (serviceId: ServiceType): boolean => {
    return availableServices.value.includes(serviceId) && serviceConfigStatus.value[serviceId];
  });

  /**
   * 检查图床是否选中
   */
  const isServiceSelected = computed(() => (serviceId: ServiceType): boolean => {
    return selectedServices.value.includes(serviceId);
  });

  /**
   * 设置配置更新监听器
   */
  async function setupConfigListener(): Promise<UnlistenFn> {
    return await listen('config-updated', async () => {
      console.log('[上传管理] 收到配置更新事件，刷新服务按钮状态');
      await loadServiceButtonStates();
    });
  }

  return {
    selectedServices,
    availableServices,
    serviceConfigStatus,
    activePrefix,

    isServiceAvailable,
    isServiceSelected,

    loadServiceButtonStates,
    toggleServiceSelection,
    saveEnabledServicesToConfig,
    updateServiceConfigStatus,
    setupConfigListener
  };
}

/**
 * 重置服务选择状态（用于单元测试）
 * 将所有模块级状态恢复到初始值
 */
export function resetServiceSelectorState(): void {
  selectedServices.value = [];
  availableServices.value = [];
  serviceConfigStatus.value = {
    weibo: false,
    r2: false,
    jd: true,
    nowcoder: false,
    qiyu: false,
    zhihu: false,
    nami: false,
    bilibili: false,
    chaoxing: false,
    smms: false,
    github: false,
    imgur: false,
    tencent: false,
    aliyun: false,
    qiniu: false,
    upyun: false
  };
  activePrefix.value = null;
}
