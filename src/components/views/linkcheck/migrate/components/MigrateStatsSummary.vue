<script setup lang="ts">
/**
 * 底栏左下角的统计条 —— migrating / done 双态
 * 单行·点分隔，过长时省略次要项（剩余时间、目标）
 */
import { computed, inject } from 'vue';
import { getServiceDisplayName } from '../../../../../constants/serviceNames';
import { MIGRATE_KEY } from '../keys';
import { formatNumber, formatSpeed, formatTime } from '../utils';

const ctx = inject(MIGRATE_KEY)!;
const {
  phase, globalProgress, cumulativeCounts, averageSpeed,
  estimatedTimeRemaining, checkedTargets, migrateResult,
} = ctx;

const migratingCompletedCount = computed(() =>
  cumulativeCounts.value.success + cumulativeCounts.value.failed + cumulativeCounts.value.skipped,
);

const migratingTargetDisplay = computed(() => {
  const names = checkedTargets.value.map(t => t.displayName);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names[0]} 等 ${names.length} 项`;
});

const doneTargetDisplay = computed(() => {
  const ids = migrateResult.value?.targetServiceIds ?? [];
  if (ids.length === 0) return '';
  const names = ids.map(id => getServiceDisplayName(id));
  if (names.length === 1) return names[0];
  return `${names[0]} 等 ${names.length} 项`;
});
</script>

<template>
  <div class="stats-summary">
    <template v-if="phase === 'migrating'">
      <span class="ss-item">
        已完成 <b>{{ formatNumber(migratingCompletedCount) }}</b>
        <span class="ss-of">/</span>
        <b>{{ formatNumber(globalProgress.total) }}</b>
      </span>
      <span class="ss-sep">·</span>
      <span class="ss-item">{{ formatSpeed(averageSpeed) }}</span>
      <span class="ss-sep ss-minor">·</span>
      <span class="ss-item ss-minor">剩余 {{ formatTime(estimatedTimeRemaining) }}</span>
      <template v-if="migratingTargetDisplay">
        <span class="ss-sep ss-minor">·</span>
        <span class="ss-item ss-target ss-minor">
          <i class="pi pi-arrow-right ss-target-icon" />
          {{ migratingTargetDisplay }}
        </span>
      </template>
    </template>
    <template v-else-if="migrateResult">
      <span class="ss-item">共 <b>{{ formatNumber(migrateResult.successCount + migrateResult.failedCount + migrateResult.skippedCount) }}</b> 项</span>
      <span class="ss-sep">·</span>
      <span class="ss-item">用时 {{ formatTime(migrateResult.durationMs) }}</span>
      <template v-if="migrateResult.avgBytesPerSec > 0">
        <span class="ss-sep ss-minor">·</span>
        <span class="ss-item ss-minor">平均 {{ formatSpeed(migrateResult.avgBytesPerSec) }}</span>
      </template>
      <template v-if="doneTargetDisplay">
        <span class="ss-sep ss-minor">·</span>
        <span class="ss-item ss-target ss-minor">
          <i class="pi pi-arrow-right ss-target-icon" />
          {{ doneTargetDisplay }}
        </span>
      </template>
    </template>
  </div>
</template>

<style scoped>
.stats-summary {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
  flex-wrap: wrap;
}

.ss-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  white-space: nowrap;
}

.ss-item b {
  color: var(--text-muted);
  font-weight: var(--weight-semibold);
}

.ss-of {
  opacity: 0.6;
  margin: 0 var(--space-2xs);
}

.ss-sep {
  color: var(--text-tertiary);
  opacity: 0.5;
}

.ss-target {
  color: var(--primary);
  font-weight: var(--weight-medium);
}

.ss-target-icon { font-size: var(--text-xs); }

/* 窄屏：隐藏次要项（剩余时间、目标图床），保留主进度 */
@media (width <= 720px) {
  .ss-minor { display: none; }
}
</style>
