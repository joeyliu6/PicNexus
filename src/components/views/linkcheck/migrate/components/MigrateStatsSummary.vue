<script setup lang="ts">
/**
 * 底栏左下角的统计条 —— migrating / done 双态
 *
 * 视觉 chip 化：成功/失败/跳过分色 chip + 总数 chip + 目标服务 chip group。
 * 窄屏保留主进度，隐藏次要信息（速度、目标 chip 组）。
 */
import { computed, inject } from 'vue';
import { MIGRATE_KEY } from '../keys';
import { formatNumber, formatSpeed, formatTime } from '../utils';
import MigrateServiceChipGroup from './chips/MigrateServiceChipGroup.vue';

const ctx = inject(MIGRATE_KEY)!;
const {
  phase, globalProgress, cumulativeCounts, checkedTargets, migrateResult,
} = ctx;

const migratingCompletedCount = computed(() =>
  cumulativeCounts.value.success + cumulativeCounts.value.failed + cumulativeCounts.value.skipped,
);

const migratingTargetServiceIds = computed(() =>
  checkedTargets.value.map(t => t.serviceId),
);

const doneTargetServiceIds = computed(() =>
  migrateResult.value?.targetServiceIds ?? [],
);
</script>

<template>
  <div class="stats-summary">
    <template v-if="phase === 'migrating'">
      <span class="ss-chip ss-chip--progress">
        <b>{{ formatNumber(migratingCompletedCount) }}</b>
        <span class="ss-of">/</span>
        <b>{{ formatNumber(globalProgress.total) }}</b>
      </span>
      <span v-if="cumulativeCounts.success > 0" class="ss-chip ss-chip--success">
        <i class="pi pi-check" /> {{ formatNumber(cumulativeCounts.success) }}
      </span>
      <span v-if="cumulativeCounts.failed > 0" class="ss-chip ss-chip--failed">
        <i class="pi pi-times" /> {{ formatNumber(cumulativeCounts.failed) }}
      </span>
      <span v-if="cumulativeCounts.skipped > 0" class="ss-chip ss-chip--skipped">
        <i class="pi pi-eye-slash" /> {{ formatNumber(cumulativeCounts.skipped) }}
      </span>
      <span v-if="migratingTargetServiceIds.length > 0" class="ss-target ss-minor">
        <i class="pi pi-arrow-right ss-target-icon" />
        <MigrateServiceChipGroup
          :services="migratingTargetServiceIds"
          variant="muted"
        />
      </span>
    </template>
    <template v-else-if="migrateResult">
      <span v-if="migrateResult.pauseReason === 'preload-error'" class="ss-error-hint">
        <i class="pi pi-exclamation-circle" /> 数据加载失败
      </span>
      <span class="ss-chip ss-chip--total">
        共 <b>{{ formatNumber(migrateResult.successCount + migrateResult.failedCount + migrateResult.skippedCount) }}</b> 项
      </span>
      <span v-if="migrateResult.successCount > 0" class="ss-chip ss-chip--success">
        <i class="pi pi-check" /> {{ formatNumber(migrateResult.successCount) }}
      </span>
      <span v-if="migrateResult.failedCount > 0" class="ss-chip ss-chip--failed">
        <i class="pi pi-times" /> {{ formatNumber(migrateResult.failedCount) }}
      </span>
      <span v-if="migrateResult.skippedCount > 0" class="ss-chip ss-chip--skipped">
        <i class="pi pi-eye-slash" /> {{ formatNumber(migrateResult.skippedCount) }}
      </span>
      <span class="ss-plain">用时 {{ formatTime(migrateResult.durationMs) }}</span>
      <span v-if="migrateResult.avgBytesPerSec > 0" class="ss-plain ss-minor">
        · 平均 {{ formatSpeed(migrateResult.avgBytesPerSec) }}
      </span>
      <span v-if="doneTargetServiceIds.length > 0" class="ss-target ss-minor">
        <i class="pi pi-arrow-right ss-target-icon" />
        <MigrateServiceChipGroup
          :services="doneTargetServiceIds"
          variant="muted"
        />
      </span>
    </template>
  </div>
</template>

<style scoped>
.stats-summary {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
  flex-wrap: wrap;
}

.ss-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-xs-sm);
  border-radius: var(--radius-sm-md);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  border: 1px solid transparent;
}
.ss-chip i { font-size: var(--text-2xs); }
.ss-chip b { font-weight: var(--weight-semibold); }

.ss-chip--progress,
.ss-chip--total {
  background: var(--primary-alpha-8);
  color: var(--primary);
  border-color: var(--primary-alpha-10);
}

.ss-chip--success {
  background: var(--success-alpha-10);
  color: var(--success);
}

.ss-chip--failed {
  background: var(--error-alpha-10);
  color: var(--error);
}

.ss-chip--skipped {
  background: var(--warning-alpha-8);
  color: var(--warning);
}

.ss-error-hint {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  color: var(--error);
  white-space: nowrap;
}
.ss-error-hint i { font-size: var(--text-xs); }

.ss-of {
  opacity: 0.6;
  margin: 0 var(--space-2xs);
}

.ss-plain { white-space: nowrap; color: var(--text-muted); }

.ss-target {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}
.ss-target-icon { font-size: var(--text-xs); color: var(--text-tertiary); }

/* 窄屏：隐藏次要项（平均速度、目标图床 chip 组），保留主进度和成功/失败/跳过 chip */
@media (width <= 720px) {
  .ss-minor { display: none; }
}
</style>
