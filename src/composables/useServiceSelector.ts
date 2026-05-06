// 图床服务选择模块 - 管理图床服务的选择状态、配置状态和可用性

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { configStore } from '../store/instances';
import type { UserConfig } from '../config/types';
import { DEFAULT_CONFIG, isCustomS3Id, makeCustomS3Id } from '../config/types';
import { useToast } from './useToast';
import { TOAST_MESSAGES } from '../constants';
import { CUSTOM_S3_REQUIRED_FIELDS, getRequiredFields, NO_CONFIG_SERVICES } from '../constants/serviceRequiredFields';
import { debounceWithError } from '../utils/debounce';
import { createLogger } from '../utils/logger';

const log = createLogger('ServiceSelector');

// ==================== 类型定义 ====================

export interface UseServiceSelectorReturn {
  selectedServices: Ref<string[]>;
  availableServices: Ref<string[]>;
  serviceConfigStatus: Ref<Record<string, boolean>>;
  activePrefix: Ref<string | null>;

  isServiceAvailable: ComputedRef<(serviceId: string) => boolean>;
  isServiceSelected: ComputedRef<(serviceId: string) => boolean>;

  loadServiceButtonStates(): Promise<void>;
  toggleServiceSelection(serviceId: string): void;
  saveEnabledServicesToConfig(services: string[]): void;
  updateServiceConfigStatus(config: UserConfig): Promise<void>;
  setupConfigListener(): Promise<UnlistenFn>;
}

// ==================== 模块级共享状态（单例） ====================

const selectedServices = ref<string[]>([]);
const availableServices = ref<string[]>([]);
const serviceConfigStatus = ref<Record<string, boolean>>({
  weibo: false,
  r2: false,
  jd: true,
  nowcoder: false,
  qiyu: true,
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
  upyun: false,
});
const activePrefix = ref<string | null>(null);

// ==================== 内部辅助函数 ====================

/**
 * 返回当前选中前缀的模板字符串（供下游 applyPrefixTemplate 使用）
 * 功能禁用或列表为空时返回 null
 */
function getActivePrefixFromConfig(config: UserConfig): string | null {
  if (!config.linkPrefixConfig?.enabled) return null;

  const index = config.linkPrefixConfig.selectedIndex;
  const list = config.linkPrefixConfig.prefixList || [];

  if (index >= 0 && index < list.length) {
    return list[index]?.template ?? null;
  }

  return list[0]?.template ?? null;
}

function hasAllRequiredFields(config: Record<string, unknown> | undefined, fields: string[]): boolean {
  if (fields.length === 0) return true;
  if (!config) return false;
  return fields.every(field => {
    const value = config[field];
    return typeof value === 'string' ? value.trim().length > 0 : !!value;
  });
}

// ==================== 主 Composable ====================

/**
 * 图床服务选择 Composable
 *
 * 使用模块级单例模式，所有组件共享同一份状态
 */
export function useServiceSelector(): UseServiceSelectorReturn {
  const toast = useToast();

  /**
   * 保存启用的服务到配置（防抖版本）
   */
  const saveEnabledServicesToConfigDebounced = debounceWithError(
    async (services: string[]) => {
      try {
        log.info('保存图床选择到配置:', services);

        let config = await configStore.get<UserConfig>('config');
        if (!config) {
          config = DEFAULT_CONFIG;
        }

        const configToSave = JSON.parse(JSON.stringify(config)) as UserConfig;
        configToSave.enabledServices = [...services];

        await configStore.set('config', configToSave);
        await configStore.save();

        log.info('✓ 图床选择已保存');
      } catch (error) {
        log.error('保存失败:', error);
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
  function saveEnabledServicesToConfig(services: string[]): void {
    saveEnabledServicesToConfigDebounced(services);
  }

  /**
   * 更新服务配置状态
   */
  async function updateServiceConfigStatus(config: UserConfig): Promise<void> {
    if (!config.services) {
      config.services = {};
    }

    for (const serviceId of Object.keys(serviceConfigStatus.value)) {
      if (isCustomS3Id(serviceId)) continue;
      serviceConfigStatus.value[serviceId] = (NO_CONFIG_SERVICES as readonly string[]).includes(serviceId)
        || hasAllRequiredFields(
          config.services[serviceId as keyof UserConfig['services']] as Record<string, unknown> | undefined,
          getRequiredFields(serviceId)
        );
    }

    for (const serviceId of Object.keys(serviceConfigStatus.value)) {
      if (isCustomS3Id(serviceId)) delete serviceConfigStatus.value[serviceId];
    }

    // 自定义 S3 profiles
    for (const profile of config.custom_s3_profiles ?? []) {
      const compositeId = makeCustomS3Id(profile.id);
      serviceConfigStatus.value[compositeId] = hasAllRequiredFields(
        profile as unknown as Record<string, unknown>,
        CUSTOM_S3_REQUIRED_FIELDS
      );
    }
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

      const selectedServicesChanged = savedEnabledServices.length !== selectedServices.value.length
        || savedEnabledServices.some((service, index) => service !== selectedServices.value[index]);
      if (selectedServicesChanged) {
        try {
          await saveEnabledServicesToConfigDebounced.immediate([...selectedServices.value]);
        } catch (error) {
          log.warn('初始同步保存失败:', error);
        }
      }

      await updateServiceConfigStatus(config);

      const previousSelected = [...selectedServices.value];
      selectedServices.value = selectedServices.value.filter(
        service => serviceConfigStatus.value[service]
      );

      if (previousSelected.length !== selectedServices.value.length) {
        log.info('自动取消未配置图床的选中状态');
        try {
          await saveEnabledServicesToConfigDebounced.immediate([...selectedServices.value]);
        } catch (error) {
          log.warn('保存选择状态失败:', error);
        }
      }

      activePrefix.value = getActivePrefixFromConfig(config);

      log.info('已加载状态:', selectedServices.value, '(可用:', availableServices.value, ')');
    } catch (error) {
      log.error('加载状态失败:', error);
    }
  }

  /**
   * 切换图床服务选择
   */
  function toggleServiceSelection(serviceId: string): void {
    const index = selectedServices.value.indexOf(serviceId);
    if (index > -1) {
      selectedServices.value.splice(index, 1);
    } else {
      selectedServices.value.push(serviceId);
    }

    log.info('选中的图床:', selectedServices.value);
    saveEnabledServicesToConfig([...selectedServices.value]);
  }

  /**
   * 检查图床是否可用
   */
  const isServiceAvailable = computed(() => (serviceId: string): boolean => {
    return availableServices.value.includes(serviceId) && serviceConfigStatus.value[serviceId];
  });

  /**
   * 检查图床是否选中
   */
  const isServiceSelected = computed(() => (serviceId: string): boolean => {
    return selectedServices.value.includes(serviceId);
  });

  /**
   * 设置配置更新监听器
   */
  async function setupConfigListener(): Promise<UnlistenFn> {
    return await listen('config-updated', async () => {
      log.info('收到配置更新事件，刷新服务按钮状态');
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
    qiyu: true,
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
    upyun: false,
  };
  activePrefix.value = null;
}
