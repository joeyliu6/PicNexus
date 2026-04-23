/**
 * 批量迁移面板 — provide/inject keys
 */
import type { InjectionKey, Ref, ComputedRef } from 'vue';
import type {
  MigratePhase,
  MigrateTargetService,
  MigrateItemStatus,
  MigrateResult,
  MigrateStats,
} from '../../../../types/batchMigrate';

export interface MigrateContext {
  phase: Ref<MigratePhase>;
  isInitialized: Ref<boolean>;
  isFilterApplied: Ref<boolean>;
  /** counts 正在被异步刷新，派生状态（isAllBackedUp 等）在此期间应保持稳定 */
  isRefiltering: Ref<boolean>;
  maxSuccessCount: Ref<number>;
  sourceServiceFilter: Ref<string[]>;
  availableSourceServices: Ref<Array<{ id: string; displayName: string; count: number }>>;
  timestampAfterMs: Ref<number | null>;
  configuredServices: ComputedRef<MigrateTargetService[]>;
  unconfiguredServices: ComputedRef<MigrateTargetService[]>;
  checkedTargets: ComputedRef<MigrateTargetService[]>;
  totalPending: ComputedRef<number>;
  isAllBackedUp: ComputedRef<boolean>;
  itemStatuses: Ref<MigrateItemStatus[]>;
  allItemStatuses: Ref<MigrateItemStatus[]>;
  globalProgress: Ref<{ current: number; total: number; percent: number }>;
  migrateResult: Ref<MigrateResult | null>;
  cumulativeCounts: Ref<{ success: number; failed: number; skipped: number }>;
  /** 当前正在原地重试的 historyId 集合（驱动失败行 spinner） */
  retryingIds: Ref<Set<string>>;
  estimatedTimeRemaining: ComputedRef<number | null>;
  averageSpeed: ComputedRef<number>;
  initError: Ref<string | null>;
  initConfiguring: () => Promise<void>;
  applyFilter: () => Promise<void>;
  startMigrate: () => Promise<void>;
  cancelMigrate: () => void;
  /** 暂停：停止分发新条目，在途条目按保守策略落定（下载中继续下完不上传、上传中完成后不再派发） */
  pauseMigrate: () => void;
  /** 恢复：主循环从阻塞中醒来，继续查询下一批 */
  resumeMigrate: () => void;
  /** 用户已点暂停（主循环阻塞中） */
  isPaused: Ref<boolean>;
  /** "正在暂停..."—— 已点暂停但仍有在途条目未落定 */
  isPausing: Ref<boolean>;
  /** 批量原地重试失败项（done 态专用） */
  retryFailed: (historyIds: string[]) => Promise<void>;
  /** 单条原地重试 */
  retrySingleFailed: (historyId: string) => Promise<void>;
  resetToConfiguring: () => Promise<void>;
  /** 迁移统计信息（耗时、字节数、已处理数等） */
  migrateStats: Ref<MigrateStats>;
  // UI 层状态
  healthStatusMap: Ref<Record<string, string>>;
  healthTooltipMap: Ref<Record<string, string>>;
}

export const MIGRATE_KEY: InjectionKey<MigrateContext> = Symbol('migrate');
