// src/components/views/CloudStorageView/composables/useCloudStorage.ts
// 云存储核心状态管理

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { useConfigManager } from '@/composables/useConfig';
import { StorageManagerFactory } from '@/services/storage';
import type { IStorageManager, StorageObject as BaseStorageObject } from '@/services/storage/IStorageManager';
import {
  SUPPORTED_SERVICES,
  SERVICE_NAMES,
  type CloudServiceType,
  type StorageObject,
  type ServiceStatus,
  type ConnectionStatus,
  type StorageStats,
} from '../types';

export interface CloudStorageReturn {
  /** 当前激活的服务 */
  activeService: Ref<CloudServiceType>;
  /** 服务状态列表 */
  services: ComputedRef<ServiceStatus[]>;
  /** 当前路径 */
  currentPath: Ref<string>;
  /** 对象列表（文件+文件夹） */
  objects: Ref<StorageObject[]>;
  /** 是否加载中 */
  isLoading: Ref<boolean>;
  /** 错误信息 */
  error: Ref<string | null>;
  /** 统计信息 */
  stats: Ref<StorageStats | null>;
  /** 是否有更多数据 */
  hasMore: Ref<boolean>;
  /** 搜索关键词 */
  searchQuery: Ref<string>;
  /** 当前存储管理器 */
  currentManager: ComputedRef<IStorageManager | null>;
  /** 设置当前服务 */
  setActiveService: (serviceId: CloudServiceType) => Promise<void>;
  /** 导航到指定路径 */
  navigateTo: (path: string) => Promise<void>;
  /** 刷新文件列表 */
  refresh: () => Promise<void>;
  /** 加载更多 */
  loadMore: () => Promise<void>;
  /** 搜索文件 */
  search: (query: string) => Promise<void>;
  /** 初始化服务状态 */
  initServiceStatuses: () => Promise<void>;
  /** 获取服务名称 */
  getServiceName: (serviceId: string) => string;
  /** 检查服务是否已配置 */
  isServiceConfigured: (serviceId: string) => boolean;
}

export function useCloudStorage(): CloudStorageReturn {
  const configManager = useConfigManager();

  // 状态
  const activeService = ref<CloudServiceType>('r2');
  const currentPath = ref<string>('');
  const objects = ref<StorageObject[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const stats = ref<StorageStats | null>(null);
  const serviceStatuses = ref<Map<string, ServiceStatus>>(new Map());

  // 分页状态
  const continuationToken = ref<string | null>(null);
  const hasMore = ref(false);

  // 搜索状态
  const searchQuery = ref('');

  // 检查服务是否已配置
  function isServiceConfigured(serviceId: string): boolean {
    const config = configManager.config.value.services?.[serviceId as CloudServiceType] as Record<string, unknown> | undefined;
    if (!config?.enabled) return false;

    switch (serviceId) {
      case 'r2':
        return !!(
          config.accountId &&
          config.accessKeyId &&
          config.secretAccessKey &&
          config.bucketName
        );
      case 'tencent':
        return !!(config.secretId && config.secretKey && config.region && config.bucket);
      case 'aliyun':
        return !!(
          config.accessKeyId &&
          config.accessKeySecret &&
          config.region &&
          config.bucket
        );
      case 'qiniu':
        return !!(config.accessKey && config.secretKey && config.bucket && config.domain);
      case 'upyun':
        return !!(config.operator && config.password && config.bucket && config.domain);
      default:
        return false;
    }
  }

  // 获取服务名称
  function getServiceName(serviceId: string): string {
    return SERVICE_NAMES[serviceId as CloudServiceType] || serviceId;
  }

  // 当前存储管理器
  const currentManager = computed<IStorageManager | null>(() => {
    const config = configManager.config.value.services?.[activeService.value];
    if (!config) return null;

    try {
      return StorageManagerFactory.create(activeService.value, config);
    } catch {
      return null;
    }
  });

  // 服务列表（带状态）
  const services = computed<ServiceStatus[]>(() => {
    return SUPPORTED_SERVICES.map((serviceId) => {
      const cached = serviceStatuses.value.get(serviceId);
      if (cached) return cached;

      const isConfigured = isServiceConfigured(serviceId);

      return {
        serviceId,
        serviceName: getServiceName(serviceId),
        status: isConfigured ? 'disconnected' : 'unconfigured',
      };
    });
  });

  // 设置当前服务
  async function setActiveService(serviceId: CloudServiceType) {
    activeService.value = serviceId;
    currentPath.value = '';
    objects.value = [];
    error.value = null;
    continuationToken.value = null;
    searchQuery.value = '';
    await refresh();
  }

  // 导航到指定路径
  async function navigateTo(path: string) {
    currentPath.value = path;
    continuationToken.value = null;
    searchQuery.value = '';
    await refresh();
  }

  // 刷新文件列表
  async function refresh() {
    const manager = currentManager.value;
    if (!manager) {
      error.value = '请先在"设置"中配置存储服务';
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      // 测试连接
      const connectionResult = await manager.testConnection();
      updateServiceStatus(
        activeService.value,
        connectionResult.success ? 'connected' : 'error',
        connectionResult.error
      );

      if (!connectionResult.success) {
        error.value = connectionResult.error || '连接失败';
        return;
      }

      // 列出对象
      const result = await manager.listObjects({
        prefix: currentPath.value,
        delimiter: '/',
        maxKeys: 100,
      });

      // 处理文件夹（从 prefixes 生成）
      const folders: StorageObject[] = result.prefixes.map((prefix: string) => ({
        key: prefix,
        name: prefix.replace(currentPath.value, '').replace(/\/$/, ''),
        type: 'folder' as const,
        size: 0,
        lastModified: new Date(),
        isDirectory: true,
      }));

      // 处理文件
      const files: StorageObject[] = result.objects.map((obj: BaseStorageObject) => ({
        ...obj,
        type: 'file' as const,
        name: obj.key.replace(currentPath.value, ''),
      }));

      // 合并文件夹和文件
      objects.value = [...folders, ...files];
      hasMore.value = result.isTruncated;
      continuationToken.value = result.continuationToken || null;

      // 更新统计信息
      await refreshStats();
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载失败';
      updateServiceStatus(activeService.value, 'error', error.value);
    } finally {
      isLoading.value = false;
    }
  }

  // 加载更多
  async function loadMore() {
    if (!hasMore.value || !continuationToken.value) return;

    const manager = currentManager.value;
    if (!manager) return;

    try {
      const result = await manager.listObjects({
        prefix: currentPath.value,
        delimiter: '/',
        maxKeys: 100,
        continuationToken: continuationToken.value,
      });

      // 处理文件
      const files: StorageObject[] = result.objects.map((obj: BaseStorageObject) => ({
        ...obj,
        type: 'file' as const,
        name: obj.key.replace(currentPath.value, ''),
      }));

      objects.value = [...objects.value, ...files];
      hasMore.value = result.isTruncated;
      continuationToken.value = result.continuationToken || null;
    } catch (e) {
      console.error('加载更多失败:', e);
    }
  }

  // 刷新统计信息
  async function refreshStats() {
    // 从当前加载的对象计算基础统计
    const totalSize = objects.value
      .filter((obj) => obj.type === 'file')
      .reduce((sum, obj) => sum + obj.size, 0);

    const config = configManager.config.value.services?.[activeService.value] as Record<string, unknown> | undefined;
    const bucketName = (config?.bucketName || config?.bucket || '') as string;

    stats.value = {
      objectCount: objects.value.filter((obj) => obj.type === 'file').length,
      totalSize,
      bucketName,
    };
  }

  // 更新服务状态
  function updateServiceStatus(
    serviceId: string,
    status: ConnectionStatus,
    errorMsg?: string
  ) {
    serviceStatuses.value.set(serviceId, {
      serviceId: serviceId as CloudServiceType,
      serviceName: getServiceName(serviceId),
      status,
      error: errorMsg,
      lastChecked: new Date(),
    });
    // 触发响应式更新
    serviceStatuses.value = new Map(serviceStatuses.value);
  }

  // 搜索文件
  async function search(query: string) {
    searchQuery.value = query;

    if (!query) {
      await refresh();
      return;
    }

    const manager = currentManager.value;
    if (!manager) return;

    isLoading.value = true;

    try {
      // 搜索时不使用 delimiter，获取所有对象
      const result = await manager.listObjects({
        prefix: currentPath.value,
        maxKeys: 1000,
      });

      // 前端过滤
      const filtered = result.objects.filter((obj: BaseStorageObject) =>
        obj.name.toLowerCase().includes(query.toLowerCase())
      );

      objects.value = filtered.map((obj: BaseStorageObject) => ({
        ...obj,
        type: 'file' as const,
        name: obj.key.replace(currentPath.value, ''),
      }));
    } catch (e) {
      error.value = e instanceof Error ? e.message : '搜索失败';
    } finally {
      isLoading.value = false;
    }
  }

  // 初始化时检查所有服务状态
  async function initServiceStatuses() {
    // 首先标记所有已配置的服务为 connecting
    for (const serviceId of SUPPORTED_SERVICES) {
      if (isServiceConfigured(serviceId)) {
        updateServiceStatus(serviceId, 'connecting');
      } else {
        updateServiceStatus(serviceId, 'unconfigured');
      }
    }

    // 然后逐个测试连接
    for (const serviceId of SUPPORTED_SERVICES) {
      if (!isServiceConfigured(serviceId)) continue;

      try {
        const config = configManager.config.value.services?.[serviceId];
        if (!config) continue;

        const manager = StorageManagerFactory.create(serviceId, config);
        const result = await manager.testConnection();

        updateServiceStatus(
          serviceId,
          result.success ? 'connected' : 'error',
          result.error
        );
      } catch (e) {
        updateServiceStatus(
          serviceId,
          'error',
          e instanceof Error ? e.message : '初始化失败'
        );
      }
    }
  }

  return {
    activeService,
    services,
    currentPath,
    objects,
    isLoading,
    error,
    stats,
    hasMore,
    searchQuery,
    currentManager,
    setActiveService,
    navigateTo,
    refresh,
    loadMore,
    search,
    initServiceStatuses,
    getServiceName,
    isServiceConfigured,
  };
}
