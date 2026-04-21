<script setup lang="ts">
/**
 * 迁移执行面板 — migrating / done 双态统一
 * 结构：正在处理（含最近完成快照）→ 跳过/失败区 → 已完成折叠区 → 底栏（左侧统计 + 右侧操作）
 *
 * 顶部横幅与状态条已移除：
 *   - 横幅的点击失败列表行为已精简（done 态失败区本身即显眼）
 *   - 统计信息下移到 MigrateBottomBar 的左槽位，让主内容区获得更多竖直空间
 */
import { inject, computed } from 'vue';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { createLogger } from '../../../../utils/logger';
import { getServiceDisplayName } from '../../../../constants/serviceNames';
import { formatSpeed, formatTime, getErrorInfo } from './utils';
import { MIGRATE_KEY } from './keys';
import MigrateActiveCard from './components/MigrateActiveCard.vue';
import MigrateSkeletonCard from './components/MigrateSkeletonCard.vue';
import MigrateSkippedSection from './components/MigrateSkippedSection.vue';
import MigrateCompletedSection from './components/MigrateCompletedSection.vue';
import MigrateBottomBar from './components/MigrateBottomBar.vue';

const log = createLogger('MigrateProgressPhase');

const ctx = inject(MIGRATE_KEY)!;
const {
  phase, cumulativeCounts, allItemStatuses, checkedTargets, cancelMigrate,
  migrateResult, resetToConfiguring, retryingIds, retryFailed,
  retrySingleFailed,
  slots, hasAnyActive, recentCompleted,
  isPaused, isPausing, pauseMigrate, resumeMigrate,
} = ctx;

function handleRetryAll() {
  if (!migrateResult.value) return;
  const ids = migrateResult.value.failures.map(f => f.historyId);
  if (ids.length > 0) retryFailed(ids);
}
function handleRetryOne(id: string) { retrySingleFailed(id); }

const MAX_LOG_ROWS = 30;

// migrating 态 —— 已完成列表（最近 30 条）
const migratingCompletedItems = computed(() =>
  allItemStatuses.value
    .filter(s => s.status === 'success' || s.status === 'failed' || s.status === 'skipped')
    .slice(-MAX_LOG_ROWS)
    .reverse(),
);

// done 态 —— 完整快照
const snapshotItems = computed(() => migrateResult.value?.itemsSnapshot ?? []);

// done 态 —— 已完成区仅展示成功项 + 系统跳过（已存在于目标图床），失败项独占上方跳过区
const completedItemsForSection = computed(() =>
  phase.value === 'done'
    ? snapshotItems.value.filter(s => s.status !== 'failed')
    : migratingCompletedItems.value,
);

const migratingFailureCount = computed(() => cumulativeCounts.value.failed);

const targetDisplay = computed(() => {
  const names = checkedTargets.value.map(t => t.displayName);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names[0]} 等 ${names.length} 项`;
});

// done 态跳过/失败区的标题与提示
const doneSkippedTitle = computed(() => {
  const r = migrateResult.value;
  if (!r) return '已跳过';
  return r.failedCount > 0 && r.successCount === 0 ? '失败项' : '已跳过';
});
const doneSkippedHint = computed(() => {
  const r = migrateResult.value;
  if (!r) return '';
  return r.failedCount > 0 && r.successCount === 0
    ? '· 可重试单条或全部重试'
    : '· 已保留原链接，可重新发起迁移';
});

async function handleExport(format: 'csv' | 'txt') {
  const r = migrateResult.value;
  if (!r) return;
  try {
    const filePath = await saveDialog({
      defaultPath: `picnexus-migrate-${Date.now()}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!filePath) return;
    const content = format === 'csv' ? buildCsvReport(r) : buildTxtReport(r);
    await writeTextFile(filePath, content);
  } catch (e) {
    log.error('导出失败', e);
  }
}

function buildCsvReport(r: NonNullable<typeof migrateResult.value>): string {
  const lines = ['文件名,状态,错误类型,错误信息'];
  for (const item of r.itemsSnapshot) {
    const statusText =
      item.status === 'success' ? '成功' :
      item.status === 'skipped' ? '跳过' :
      item.status === 'failed' ? '失败' :
      item.status === 'converting' ? '转换中' :
      item.status;
    const errorTypeText = item.errorType
      ? (item.errorType === 'download' ? '下载失败' : '上传失败')
      : '';
    const escapedError = `"${(item.error || '').replace(/"/g, '""')}"`;
    const escapedName = `"${item.fileName.replace(/"/g, '""')}"`;
    lines.push(`${escapedName},${statusText},${errorTypeText},${escapedError}`);
  }
  lines.push('');
  lines.push(`# 成功: ${r.successCount}，跳过: ${r.skippedCount}，失败: ${r.failedCount}`);
  lines.push(`# 用时: ${formatTime(r.durationMs)}，平均速度: ${formatSpeed(r.avgBytesPerSec)}`);
  return '﻿' + lines.join('\n');
}

function buildTxtReport(r: NonNullable<typeof migrateResult.value>): string {
  const header = [
    'PicNexus · 批量迁移报告',
    `导出时间：${new Date().toLocaleString()}`,
    `目标图床：${r.targetServiceIds.map(id => getServiceDisplayName(id)).join('、')}`,
    `用时：${formatTime(r.durationMs)}，平均速度：${formatSpeed(r.avgBytesPerSec)}`,
    `成功 ${r.successCount} · 跳过 ${r.skippedCount} · 失败 ${r.failedCount}`,
    '',
    '─'.repeat(60),
    '',
  ];
  const sections: string[] = [];
  const success = r.itemsSnapshot.filter(s => s.status === 'success');
  const skipped = r.itemsSnapshot.filter(s => s.status === 'skipped');
  const failed = r.itemsSnapshot.filter(s => s.status === 'failed');

  if (failed.length > 0) {
    sections.push(`[失败 ${failed.length}]`);
    for (const f of failed) {
      const info = getErrorInfo(f.errorType);
      sections.push(`  • ${f.fileName}`);
      sections.push(`    [${info.label}] ${f.error ?? ''}`);
    }
    sections.push('');
  }
  if (skipped.length > 0) {
    sections.push(`[跳过 ${skipped.length}] 已在目标图床中，无需迁移`);
    for (const s of skipped) sections.push(`  • ${s.fileName}`);
    sections.push('');
  }
  if (success.length > 0) {
    sections.push(`[成功 ${success.length}]`);
    for (const s of success) sections.push(`  • ${s.fileName}`);
  }
  return header.join('\n') + sections.join('\n');
}

function handlePause() { pauseMigrate(); }
function handleResume() { resumeMigrate(); }
</script>

<template>
  <!-- migrating: 正在处理主区（活跃槽 + 最近完成快照） -->
  <div v-if="phase === 'migrating'" class="focus-area">
    <div class="focus-header">
      <span class="focus-title">正在处理</span>
      <span
        v-if="isPausing"
        class="focus-pause-tag focus-pause-tag--pending"
      >
        <i class="pi pi-spin pi-spinner" /> 正在暂停…
      </span>
      <span
        v-else-if="isPaused"
        class="focus-pause-tag focus-pause-tag--paused"
      >
        <i class="pi pi-pause-circle" /> 已暂停
      </span>
    </div>

    <div v-if="!hasAnyActive" class="active-cards active-cards--skeleton">
      <MigrateSkeletonCard v-for="slot in slots" :key="slot.id" />
    </div>

    <div v-else class="active-cards">
      <template v-for="slot in slots" :key="slot.id">
        <MigrateActiveCard
          v-if="slot.item"
          :item="slot.item"
          :slot-state="slot.state === 'complete' ? 'complete' : 'active'"
          :target-display="targetDisplay"
        />
        <MigrateSkeletonCard v-else />
      </template>
    </div>

    <div v-if="recentCompleted.length > 0" class="recent-section">
      <span class="recent-title">最近完成</span>
      <div class="recent-cards">
        <MigrateActiveCard
          v-for="item in recentCompleted"
          :key="item.historyId"
          :item="item"
          :target-display="targetDisplay"
          variant="snapshot"
          slot-state="complete"
        />
      </div>
    </div>
  </div>

  <!-- done: 跳过/失败折叠区 -->
  <MigrateSkippedSection
    v-else-if="migrateResult && migrateResult.failures.length > 0"
    :items="migrateResult.failures"
    :default-expanded="true"
    :title="doneSkippedTitle"
    :hint="doneSkippedHint"
    :retrying-ids="retryingIds"
    :is-failure-view="true"
    @retry-all="handleRetryAll"
    @retry-one="handleRetryOne"
  />

  <!-- 已完成折叠区（migrating / done 都渲染）。done 态下失败项已独占"已跳过"区，这里徽章不再显示失败计数 -->
  <MigrateCompletedSection
    :items="completedItemsForSection"
    :failure-count="phase === 'done' ? 0 : migratingFailureCount"
    :default-expanded="phase === 'done'"
  />

  <!-- 底栏 -->
  <MigrateBottomBar
    :mode="phase === 'done' ? 'done' : 'migrating'"
    :is-paused="isPaused"
    :is-pausing="isPausing"
    @pause="handlePause"
    @resume="handleResume"
    @cancel="cancelMigrate"
    @done="resetToConfiguring"
    @restart="resetToConfiguring"
    @export="handleExport"
  />
</template>

<style scoped>
@import url('./migrate-shared.css');

.focus-area {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm-md);
  flex-shrink: 0;
}

.focus-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-sm);
}
.focus-title { font-weight: var(--weight-semibold); color: var(--text-primary); }

.focus-pause-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-xs-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-2xs);
  font-weight: var(--weight-medium);
}
.focus-pause-tag i { font-size: var(--text-2xs); }

.focus-pause-tag--pending {
  background: var(--state-warn-bg-soft);
  color: var(--state-warn-text);
}

.focus-pause-tag--paused {
  background: var(--bg-input);
  color: var(--text-muted);
}

.active-cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm-md);
  position: relative;
}
.active-cards--skeleton { opacity: 0.9; }

.recent-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}

.recent-title {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-weight: var(--weight-medium);
}

.recent-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-sm);
}
</style>
