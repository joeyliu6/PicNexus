/**
 * 批量迁移面板 — provide/inject keys
 */
import type { InjectionKey, Ref, ComputedRef } from 'vue';
import type {
  MigratePhase,
  MigrateTargetService,
  MigrateItemStatus,
  MigrateResult,
} from '../../../../types/batchMigrate';

export interface MigrateContext {
  phase: Ref<MigratePhase>;
  isInitialized: Ref<boolean>;
  isFilterApplied: Ref<boolean>;
  maxSuccessCount: Ref<number>;
  sourceServiceFilter: Ref<string[]>;
  availableSourceServices: Ref<Array<{ id: string; displayName: string; count: number }>>;
  showAdvancedFilter: Ref<boolean>;
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
  estimatedTimeRemaining: ComputedRef<number | null>;
  averageSpeed: ComputedRef<number>;
  initError: Ref<string | null>;
  initConfiguring: () => Promise<void>;
  applyFilter: () => Promise<void>;
  startMigrate: () => Promise<void>;
  cancelMigrate: () => void;
  retryFailed: () => Promise<void>;
  resetToConfiguring: () => Promise<void>;
  // UI 层状态
  healthStatusMap: Ref<Record<string, string>>;
  healthTooltipMap: Ref<Record<string, string>>;
}

export const MIGRATE_KEY: InjectionKey<MigrateContext> = Symbol('migrate');
