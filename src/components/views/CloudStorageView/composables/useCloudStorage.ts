// src/components/views/CloudStorageView/composables/useCloudStorage.ts
// 云存储核心状态管理

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { useConfigManager } from '@/composables/useConfig';
import { StorageManagerFactory } from '@/services/storage';
import type { IStorageManager, StorageObject as BaseStorageObject } from '@/services/storage/IStorageManager';
import { usePagination, type UsePaginationReturn } from './usePagination';
import { cloudStorageCache } from './useCloudStorageCache';
import {
  SUPPORTED_SERVICES,
  SERVICE_NAMES,
  type CloudServiceType,
  type StorageObject,
  type ServiceStatus,
  type ConnectionStatus,
  type StorageStats,
} from '../types';

// 服务商状态缓存有效期（10 分钟）
const SERVICE_STATUS_CACHE_TTL = 10 * 60 * 1000;

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
  /** 服务商初始化加载中（用于侧边栏 Spinner） */
  isServiceLoading: Ref<boolean>;
  /** 错误信息 */
  error: Ref<string | null>;
  /** 统计信息 */
  stats: ComputedRef<StorageStats | null>;
  /** 存储桶名称（直接从配置读取，不依赖 objects） */
  bucketName: ComputedRef<string>;
  /** 搜索关键词 */
  searchQuery: Ref<string>;
  /** 当前存储管理器 */
  currentManager: ComputedRef<IStorageManager | null>;
  /** 分页状态 */
  pagination: UsePaginationReturn;
  /** 设置当前服务 */
  setActiveService: (serviceId: CloudServiceType) => Promise<void>;
  /** 导航到指定路径 */
  navigateTo: (path: string) => Promise<void>;
  /** 刷新文件列表 */
  refresh: () => Promise<void>;
  /** 跳转到指定页 */
  goToPage: (page: number) => Promise<void>;
  /** 修改每页条数 */
  changePageSize: (size: number) => Promise<void>;
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
  const isServiceLoading = ref(false);
  const error = ref<string | null>(null);
  const serviceStatuses = ref<Map<string, ServiceStatus>>(new Map());

  // 分页状态
  const pagination = usePagination({ defaultPageSize: 50 });

  // 搜索状态
  const searchQuery = ref('');

  // 统计信息（computed 自动响应式更新，无需手动调用 refreshStats）
  const stats = computed<StorageStats | null>(() => {
    if (objects.value.length === 0) return null;

    const files = objects.value.filter((obj) => obj.type === 'file');
    const config = configManager.config.value.services?.[activeService.value] as Record<string, unknown> | undefined;

    return {
      objectCount: files.length,
      totalSize: files.reduce((sum, obj) => sum + obj.size, 0),
      bucketName: (config?.bucketName || config?.bucket || '') as string,
    };
  });

  // 存储桶名称（直接从配置读取，不依赖 objects，避免切换时闪烁"根目录"）
  const bucketName = computed<string>(() => {
    const config = configManager.config.value.services?.[activeService.value] as Record<string, unknown> | undefined;
    return (config?.bucketName || config?.bucket || '') as string;
  });

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
        return !!(config.accessKey && config.secretKey && config.bucket && config.publicDomain);
      case 'upyun':
        return !!(config.operator && config.password && config.bucket && config.publicDomain);
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
    error.value = null;
    searchQuery.value = '';
    pagination.reset();

    // 尝试从缓存获取数据
    const cacheKey = {
      serviceId,
      path: '',
      page: 1,
      pageSize: pagination.pageSize.value,
    };
    const { entry: cached, isStale } = cloudStorageCache.get(cacheKey);

    if (cached) {
      // 有缓存：立即显示缓存数据
      objects.value = cached.objects;
      pagination.setHasMore(cached.hasMore);

      // 如果数据过期，后台静默刷新
      if (isStale) {
        refreshInBackground();
      }
    } else {
      // 无缓存：清空数据，显示骨架屏
      objects.value = [];
      await refresh();
    }
  }

  // 后台静默刷新（不显示 loading 状态）
  async function refreshInBackground() {
    try {
      const manager = currentManager.value;
      if (!manager) return;

      const result = await manager.listObjects({
        prefix: currentPath.value,
        delimiter: '/',
        maxKeys: pagination.pageSize.value,
      });

      // 处理文件夹
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

      const newObjects = [...folders, ...files];

      // 缓存新数据
      cloudStorageCache.set(
        {
          serviceId: activeService.value,
          path: currentPath.value,
          page: pagination.currentPage.value,
          pageSize: pagination.pageSize.value,
        },
        {
          objects: newObjects,
          hasMore: result.isTruncated,
          nextToken: result.continuationToken || null,
        }
      );

      // 平滑替换（如果用户还在同一位置）
      if (currentPath.value === '' && pagination.currentPage.value === 1) {
        objects.value = newObjects;
        pagination.setHasMore(result.isTruncated);
      }
    } catch (e) {
      console.warn('[CloudStorage] 后台刷新失败:', e);
    }
  }

  // 导航到指定路径
  async function navigateTo(path: string) {
    currentPath.value = path;
    searchQuery.value = '';
    pagination.reset();

    // 尝试从缓存获取数据
    const cacheKey = {
      serviceId: activeService.value,
      path,
      page: 1,
      pageSize: pagination.pageSize.value,
    };
    const { entry: cached, isStale } = cloudStorageCache.get(cacheKey);

    if (cached) {
      objects.value = cached.objects;
      pagination.setHasMore(cached.hasMore);

      if (isStale) {
        refreshInBackground();
      }
    } else {
      objects.value = [];
      await refresh();
    }
  }

  // 内部：获取指定页的数据
  async function fetchPage(page: number, updateUI: boolean = true): Promise<string | null> {
    const manager = currentManager.value;
    if (!manager) {
      error.value = '请先在"设置"中配置存储服务';
      return null;
    }

    const token = pagination.getToken(page);

    // 如果 token 是 undefined，说明该页未被缓存，提前返回错误
    if (token === undefined && page > 1) {
      error.value = `无法加载第 ${page} 页：缺少分页凭证，请返回第 1 页重新加载`;
      return null;
    }

    const result = await manager.listObjects({
      prefix: currentPath.value,
      delimiter: '/',
      maxKeys: pagination.pageSize.value,
      continuationToken: token ?? undefined,
    });

    // 缓存下一页的 token
    if (result.isTruncated && result.continuationToken) {
      pagination.cacheToken(page + 1, result.continuationToken);
    }

    if (updateUI) {
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
      pagination.setPage(page);
      pagination.setHasMore(result.isTruncated);
    }

    return result.continuationToken || null;
  }

  // 刷新文件列表（加载当前页）
  async function refresh() {
    const manager = currentManager.value;
    if (!manager) {
      error.value = '请先在"设置"中配置存储服务';
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      // 仅在未连接、状态为错误或缓存过期时测试连接
      const cachedStatus = serviceStatuses.value.get(activeService.value);
      const isStatusExpired = cachedStatus?.lastChecked
        ? Date.now() - cachedStatus.lastChecked.getTime() > SERVICE_STATUS_CACHE_TTL
        : true;
      const needsConnectionTest =
        !cachedStatus || cachedStatus.status !== 'connected' || isStatusExpired;

      if (needsConnectionTest) {
        isServiceLoading.value = true;
        const connectionResult = await manager.testConnection();
        updateServiceStatus(
          activeService.value,
          connectionResult.success ? 'connected' : 'error',
          connectionResult.error
        );
        isServiceLoading.value = false;

        if (!connectionResult.success) {
          error.value = connectionResult.error || '连接失败';
          return;
        }
      }

      // 获取当前页数据
      await fetchPage(pagination.currentPage.value, true);
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载失败';
      updateServiceStatus(activeService.value, 'error', error.value);
    } finally {
      isLoading.value = false;
      isServiceLoading.value = false;
    }
  }

  // 跳转到指定页
  async function goToPage(page: number) {
    if (page < 1 || page === pagination.currentPage.value) {
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      const hasToken = pagination.hasToken(page);

      // 如果目标页的 token 已缓存，直接请求
      if (hasToken) {
        await fetchPage(page, true);
        return;
      }

      // 否则，从最近的已知页快速遍历获取 token
      const nearestPage = pagination.findNearestCachedPage(page);

      for (let p = nearestPage; p < page; p++) {
        // 仅获取 token，不更新 UI
        await fetchPage(p, false);
      }

      // 最后加载目标页并更新 UI
      await fetchPage(page, true);
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载失败';
    } finally {
      isLoading.value = false;
    }
  }

  // 修改每页条数
  async function changePageSize(size: number) {
    pagination.changePageSize(size);
    await refresh();
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
      pagination.reset();
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

      // 搜索模式下禁用分页
      pagination.setHasMore(false);
    } catch (e) {
      error.value = e instanceof Error ? e.message : '搜索失败';
    } finally {
      isLoading.value = false;
    }
  }

  // 初始化时检查所有服务状态（并行测试提升性能）
  async function initServiceStatuses() {
    await configManager.loadConfig();

    // 首先标记所有服务状态
    for (const serviceId of SUPPORTED_SERVICES) {
      updateServiceStatus(
        serviceId,
        isServiceConfigured(serviceId) ? 'connecting' : 'unconfigured'
      );
    }

    // 并行测试所有已配置的服务
    const configuredServices = SUPPORTED_SERVICES.filter(isServiceConfigured);

    const testPromises = configuredServices.map(async (serviceId) => {
      try {
        const config = configManager.config.value.services?.[serviceId];
        if (!config) {
          return { serviceId, success: false, error: '配置不存在' };
        }

        const manager = StorageManagerFactory.create(serviceId, config);
        const result = await manager.testConnection();
        return { serviceId, success: result.success, error: result.error };
      } catch (e) {
        return {
          serviceId,
          success: false,
          error: e instanceof Error ? e.message : '初始化失败',
        };
      }
    });

    const results = await Promise.allSettled(testPromises);

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        const { serviceId, success, error } = result.value;
        updateServiceStatus(serviceId, success ? 'connected' : 'error', error);
      }
    });
  }

  return {
    activeService,
    services,
    currentPath,
    objects,
    isLoading,
    isServiceLoading,
    error,
    stats,
    bucketName,
    searchQuery,
    currentManager,
    pagination,
    setActiveService,
    navigateTo,
    refresh,
    goToPage,
    changePageSize,
    search,
    initServiceStatuses,
    getServiceName,
    isServiceConfigured,
  };
}
