// 图床健康状态管理 Composable
// 模块级单例，管理所有图床的健康状态（四态：未配置/待验证/已验证/错误）
// 状态持久化到 syncStatusStore，支持上传失败联动

import { ref, computed, triggerRef, type Ref, type ComputedRef } from 'vue';
import type { ServiceType, UserConfig } from '../config/types';
import type {
  ServiceHealthStatus,
  ServiceHealthRecord,
  ServiceHealthMap,
  PersistedHealthData,
} from '../types/serviceHealth';
import { AUTH_CONFIG_ERROR_CODES } from '../types/serviceHealth';
import { SERVICE_REQUIRED_FIELDS, NO_CONFIG_SERVICES } from '../constants/serviceRequiredFields';
import { syncStatusStore } from '../store/instances';
import type { StructuredError } from '../uploaders/base/ErrorTypes';
import { formatRelativeTime } from '../utils/formatters';

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
          for (const serviceId of ALL_SERVICE_TYPES) {
            const saved = persisted[serviceId];
            if (saved) {
              const record = healthMap.value[serviceId];
              record.status = saved.status;
              record.lastVerifiedAt = saved.lastVerifiedAt;
              record.lastError = saved.lastError;
              record.errorSource = saved.errorSource;
            }
          }
          triggerRef(healthMap);
          console.log('[健康状态] 自动加载完成');
        }
      } catch (error) {
        console.error('[健康状态] 自动加载失败:', error);
      }

    })();
  }
  return autoLoadPromise;
}

autoLoadFromDisk();

// 模块级 computed，确保所有消费者共享同一个响应式引用
const healthStatusMap: ComputedRef<Record<ServiceType, ServiceHealthStatus>> = computed(() => {
  const map = {} as Record<ServiceType, ServiceHealthStatus>;
  for (const id of ALL_SERVICE_TYPES) {
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
      return '异常';
  }
}

const healthTooltipMap: ComputedRef<Record<ServiceType, string>> = computed(() => {
  const map = {} as Record<ServiceType, string>;
  for (const id of ALL_SERVICE_TYPES) {
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

function createDefaultHealthMap(): ServiceHealthMap {
  const map = {} as ServiceHealthMap;
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
  serviceId: ServiceType,
  config: UserConfig
): Record<string, string> {
  const requiredFields = SERVICE_REQUIRED_FIELDS[serviceId];
  if (!requiredFields.length) return {};

  const serviceConfig = config.services[serviceId] as unknown as Record<string, unknown> | undefined;
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
    for (const serviceId of ALL_SERVICE_TYPES) {
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
    console.error('[健康状态] 持久化失败:', error);
  }
}

// ==================== 返回值类型 ====================

export interface UseServiceHealthReturn {
  healthMap: Ref<ServiceHealthMap>;
  getHealth: (serviceId: ServiceType) => ServiceHealthRecord;
  getStatusClass: (serviceId: ServiceType) => string;
  healthStatusMap: ComputedRef<Record<ServiceType, ServiceHealthStatus>>;
  healthTooltipMap: ComputedRef<Record<ServiceType, string>>;
  loadHealthStatus: () => Promise<void>;
  evaluateConfig: (config: UserConfig) => void;
  markVerified: (serviceId: ServiceType) => void;
  markTestFailed: (serviceId: ServiceType, error: string) => void;
  markUploadError: (serviceId: ServiceType, structuredError: StructuredError) => void;
}

// ==================== 配置评估（模块级） ====================

function evaluateConfigInternal(config: UserConfig): void {
  const newSnapshot = buildConfigSnapshot(config);

  for (const serviceId of ALL_SERVICE_TYPES) {
    const record = healthMap.value[serviceId];
    const requiredFields = SERVICE_REQUIRED_FIELDS[serviceId];

    // 无需配置的图床：如果尚未通过运行时检测，标记为 pending
    if (NO_CONFIG_SERVICES.includes(serviceId)) {
      if (record.status === 'unconfigured') {
        record.status = 'pending';
      }
      record.filledCount = 0;
      record.totalRequired = 0;
      continue;
    }

    // 计算字段完成度
    const fieldValues = getServiceFieldValues(serviceId, config);
    const filledCount = Object.values(fieldValues).filter(v => v.length > 0).length;
    const totalRequired = requiredFields.length;

    record.filledCount = filledCount;
    record.totalRequired = totalRequired;

    const allFilled = filledCount >= totalRequired;

    if (!allFilled) {
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

  lastConfigSnapshot = newSnapshot;
  triggerRef(healthMap);
  debouncedPersist();
}

// ==================== Composable ====================

export function useServiceHealth(): UseServiceHealthReturn {
  function getHealth(serviceId: ServiceType): ServiceHealthRecord {
    return healthMap.value[serviceId] || createDefaultRecord();
  }

  function getStatusClass(serviceId: ServiceType): string {
    return `status-dot ${healthMap.value[serviceId]?.status || 'unconfigured'}`;
  }

  async function loadHealthStatus(): Promise<void> {
    await autoLoadFromDisk();
  }

  function updateRecord(serviceId: ServiceType, updates: Partial<ServiceHealthRecord>): void {
    const record = healthMap.value[serviceId];
    if (!record) return;
    Object.assign(record, updates);
    triggerRef(healthMap);
    debouncedPersist();
  }

  function markVerified(serviceId: ServiceType): void {
    updateRecord(serviceId, { status: 'verified', lastVerifiedAt: Date.now(), lastError: null, errorSource: null });
  }

  function markTestFailed(serviceId: ServiceType, error: string): void {
    updateRecord(serviceId, { status: 'error', lastError: error, errorSource: 'test' });
  }

  function markUploadError(serviceId: ServiceType, structuredError: StructuredError): void {
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
