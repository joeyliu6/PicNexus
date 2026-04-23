// 图床健康状态管理 Composable
// 模块级单例，管理所有图床的健康状态（四态：未配置/待验证/已验证/错误）
// 状态持久化到 syncStatusStore，支持上传失败联动

import { ref, computed, triggerRef, type Ref, type ComputedRef } from 'vue';
import type { ServiceType, UserConfig } from '../config/types';
import { isCustomS3Id, getCustomS3ProfileId, makeCustomS3Id } from '../config/types';
import type {
  ServiceHealthStatus,
  ServiceHealthRecord,
  ServiceHealthMap,
  PersistedHealthData,
} from '../types/serviceHealth';
import { AUTH_CONFIG_ERROR_CODES } from '../types/serviceHealth';
import { SERVICE_REQUIRED_FIELDS, NO_CONFIG_SERVICES, CUSTOM_S3_REQUIRED_FIELDS } from '../constants/serviceRequiredFields';
import { syncStatusStore } from '../store/instances';
import type { StructuredError } from '../uploaders/base/ErrorTypes';
import { formatRelativeTime } from '../utils/formatters';
import { createLogger } from '../utils/logger';

const log = createLogger('ServiceHealth');

// ==================== 常量 ====================

const PERSIST_KEY = 'serviceHealth';
const PERSIST_DEBOUNCE_MS = 500;

// ==================== 所有 ServiceType 枚举值 ====================

const ALL_SERVICE_TYPES: ServiceType[] = [
  'weibo', 'r2', 'jd', 'nowcoder', 'qiyu', 'zhihu',
  'nami', 'bilibili', 'chaoxing', 'smms', 'github', 'imgur',
  'tencent', 'aliyun', 'qiniu', 'upyun',
];

// ==================== 模块级共享状态（单例） ====================

const healthMap: Ref<ServiceHealthMap> = ref(createDefaultHealthMap());
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let lastConfigSnapshot: Record<string, string> = {};
let autoLoadPromise: Promise<void> | null = null;

// 模块加载时自动从磁盘恢复健康状态，确保任何页面首次访问都能拿到缓存
function autoLoadFromDisk(): Promise<void> {
  if (!autoLoadPromise) {
    autoLoadPromise = (async () => {
      try {
        const persisted = await syncStatusStore.get<PersistedHealthData>(PERSIST_KEY);
        if (persisted) {
          for (const [key, saved] of Object.entries(persisted)) {
            if (!saved) continue;
            if (!healthMap.value[key]) {
              healthMap.value[key] = createDefaultRecord();
            }
            const record = healthMap.value[key];
            record.status = saved.status;
            record.lastVerifiedAt = saved.lastVerifiedAt;
            record.lastError = saved.lastError;
            record.errorSource = saved.errorSource;
          }
          triggerRef(healthMap);
          log.info('自动加载完成');
        }
      } catch (error) {
        log.error('自动加载失败:', error);
      }

    })();
  }
  return autoLoadPromise;
}

autoLoadFromDisk();

// 模块级 computed，确保所有消费者共享同一个响应式引用
const healthStatusMap: ComputedRef<Record<string, ServiceHealthStatus>> = computed(() => {
  const map = {} as Record<string, ServiceHealthStatus>;
  for (const id of Object.keys(healthMap.value)) {
    map[id] = healthMap.value[id]?.status || 'unconfigured';
  }
  return map;
});

// ==================== Tooltip 文本生成 ====================

function buildTooltipText(record: ServiceHealthRecord): string {
  switch (record.status) {
    case 'unconfigured':
      return '未配置';
    case 'pending':
      return '待验证';
    case 'verified':
      if (record.lastVerifiedAt) return `可用 · ${formatRelativeTime(record.lastVerifiedAt)}`;
      return '可用';
    case 'error':
      if (record.lastError) return `异常 · ${record.lastError}`;
      return '异常';
  }
}

const healthTooltipMap: ComputedRef<Record<string, string>> = computed(() => {
  const map = {} as Record<string, string>;
  for (const id of Object.keys(healthMap.value)) {
    map[id] = buildTooltipText(healthMap.value[id]);
  }
  return map;
});

// ==================== 工具函数 ====================

function createDefaultRecord(): ServiceHealthRecord {
  return {
    status: 'unconfigured',
    lastVerifiedAt: null,
    lastError: null,
    errorSource: null,
    filledCount: 0,
    totalRequired: 0,
  };
}

function createDefaultHealthMap(): Record<string, ServiceHealthRecord> {
  const map = {} as Record<string, ServiceHealthRecord>;
  for (const id of ALL_SERVICE_TYPES) {
    map[id] = createDefaultRecord();
  }
  return map;
}

/**
 * 从 UserConfig 中提取指定图床的配置字段值
 * 用于判断必填字段是否已填写
 */
function getServiceFieldValues(
  serviceId: string,
  config: UserConfig
): Record<string, string> {
  // 自定义 S3 复合 ID：从 custom_s3_profiles 中查找
  if (isCustomS3Id(serviceId)) {
    const profileId = getCustomS3ProfileId(serviceId);
    const profile = config.custom_s3_profiles?.find(p => p.id === profileId);
    if (!profile) return {};

    const values: Record<string, string> = {};
    for (const field of CUSTOM_S3_REQUIRED_FIELDS) {
      const val = (profile as unknown as Record<string, unknown>)[field];
      values[field] = typeof val === 'string' ? val.trim() : '';
    }
    return values;
  }

  const requiredFields = SERVICE_REQUIRED_FIELDS[serviceId as ServiceType];
  if (!requiredFields?.length) return {};

  const serviceConfig = config.services[serviceId as ServiceType] as unknown as Record<string, unknown> | undefined;
  if (!serviceConfig) return {};

  const values: Record<string, string> = {};
  for (const field of requiredFields) {
    const val = serviceConfig[field];
    values[field] = typeof val === 'string' ? val.trim() : '';
  }
  return values;
}

/**
 * 生成配置快照（用于检测配置是否变化）
 */
function buildConfigSnapshot(config: UserConfig): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const serviceId of ALL_SERVICE_TYPES) {
    const values = getServiceFieldValues(serviceId, config);
    snapshot[serviceId] = Object.values(values).join('|');
  }
  // 包含自定义 S3 profiles
  for (const profile of config.custom_s3_profiles ?? []) {
    const compositeId = makeCustomS3Id(profile.id);
    const values = getServiceFieldValues(compositeId, config);
    snapshot[compositeId] = Object.values(values).join('|');
  }
  return snapshot;
}

/**
 * 防抖持久化
 */
function debouncedPersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistHealthStatus();
    persistTimer = null;
  }, PERSIST_DEBOUNCE_MS);
}

async function persistHealthStatus(): Promise<void> {
  try {
    const data: PersistedHealthData = {};
    for (const serviceId of Object.keys(healthMap.value)) {
      const record = healthMap.value[serviceId];
      if (record.status !== 'unconfigured') {
        data[serviceId] = {
          status: record.status,
          lastVerifiedAt: record.lastVerifiedAt,
          lastError: record.lastError,
          errorSource: record.errorSource,
        };
      }
    }
    await syncStatusStore.set(PERSIST_KEY, data);
  } catch (error) {
    log.error('持久化失败:', error);
  }
}

// ==================== 返回值类型 ====================

export interface UseServiceHealthReturn {
  healthMap: Ref<ServiceHealthMap>;
  getHealth: (serviceId: string) => ServiceHealthRecord;
  getStatusClass: (serviceId: string) => string;
  healthStatusMap: ComputedRef<Record<string, ServiceHealthStatus>>;
  healthTooltipMap: ComputedRef<Record<string, string>>;
  loadHealthStatus: () => Promise<void>;
  evaluateConfig: (config: UserConfig) => void;
  markVerified: (serviceId: string) => void;
  markTestFailed: (serviceId: string, error: string) => void;
  markUploadError: (serviceId: string, structuredError: StructuredError) => void;
}

// ==================== 配置评估（模块级） ====================

function evaluateConfigInternal(config: UserConfig): void {
  const newSnapshot = buildConfigSnapshot(config);

  // 评估单个服务的健康状态
  function evaluateService(serviceId: string, totalRequired: number): void {
    if (!healthMap.value[serviceId]) {
      healthMap.value[serviceId] = createDefaultRecord();
    }
    const record = healthMap.value[serviceId];
    const fieldValues = getServiceFieldValues(serviceId, config);
    const filledCount = Object.values(fieldValues).filter(v => v.length > 0).length;

    record.filledCount = filledCount;
    record.totalRequired = totalRequired;

    if (filledCount < totalRequired) {
      record.status = 'unconfigured';
      record.lastError = null;
      record.errorSource = null;
    } else if (record.status === 'unconfigured') {
      record.status = 'pending';
    } else if (
      (record.status === 'verified' || record.status === 'error') &&
      lastConfigSnapshot[serviceId] !== undefined &&
      lastConfigSnapshot[serviceId] !== newSnapshot[serviceId]
    ) {
      record.status = 'pending';
      record.lastError = null;
      record.errorSource = null;
    }
  }

  for (const serviceId of ALL_SERVICE_TYPES) {
    // 无需配置的图床：如果尚未通过运行时检测，标记为 pending
    if (NO_CONFIG_SERVICES.includes(serviceId)) {
      const record = healthMap.value[serviceId];
      if (record.status === 'unconfigured') {
        record.status = 'pending';
      }
      record.filledCount = 0;
      record.totalRequired = 0;
      continue;
    }
    evaluateService(serviceId, SERVICE_REQUIRED_FIELDS[serviceId].length);
  }

  for (const profile of config.custom_s3_profiles ?? []) {
    evaluateService(makeCustomS3Id(profile.id), CUSTOM_S3_REQUIRED_FIELDS.length);
  }

  // 清理已删除的 custom_s3 profiles
  for (const key of Object.keys(healthMap.value)) {
    if (isCustomS3Id(key)) {
      const profileId = getCustomS3ProfileId(key);
      const exists = config.custom_s3_profiles?.some(p => p.id === profileId);
      if (!exists) {
        delete healthMap.value[key];
      }
    }
  }

  lastConfigSnapshot = newSnapshot;
  triggerRef(healthMap);
  debouncedPersist();
}

// ==================== Composable ====================

export function useServiceHealth(): UseServiceHealthReturn {
  function getHealth(serviceId: string): ServiceHealthRecord {
    return healthMap.value[serviceId] || createDefaultRecord();
  }

  function getStatusClass(serviceId: string): string {
    return `status-dot ${healthMap.value[serviceId]?.status || 'unconfigured'}`;
  }

  async function loadHealthStatus(): Promise<void> {
    await autoLoadFromDisk();
  }

  function updateRecord(serviceId: string, updates: Partial<ServiceHealthRecord>): void {
    const record = healthMap.value[serviceId];
    if (!record) return;
    Object.assign(record, updates);
    triggerRef(healthMap);
    debouncedPersist();
  }

  function markVerified(serviceId: string): void {
    updateRecord(serviceId, { status: 'verified', lastVerifiedAt: Date.now(), lastError: null, errorSource: null });
  }

  function markTestFailed(serviceId: string, error: string): void {
    updateRecord(serviceId, { status: 'error', lastError: error, errorSource: 'test' });
  }

  function markUploadError(serviceId: string, structuredError: StructuredError): void {
    if (!(AUTH_CONFIG_ERROR_CODES as readonly string[]).includes(structuredError.code)) return;
    updateRecord(serviceId, { status: 'error', lastError: structuredError.message, errorSource: 'upload' });
  }

  return {
    healthMap,
    getHealth,
    getStatusClass,
    healthStatusMap,
    healthTooltipMap,
    loadHealthStatus,
    evaluateConfig: evaluateConfigInternal,
    markVerified,
    markTestFailed,
    markUploadError,
  };
}
