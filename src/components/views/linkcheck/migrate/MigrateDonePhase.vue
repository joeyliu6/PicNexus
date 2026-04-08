<script setup lang="ts">
/**
 * E4 完成阶段 — 摘要统计 + 失败详情
 */
import { inject } from 'vue';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { createLogger } from '../../../../utils/logger';
import { formatNumber, getErrorInfo } from './utils';
import { MIGRATE_KEY } from './keys';

const log = createLogger('MigrateDonePhase');

const ctx = inject(MIGRATE_KEY)!;
const { migrateResult, retryFailed, resetToConfiguring } = ctx;

async function exportResult() {
  if (!migrateResult.value) return;
  const result = migrateResult.value;

  const lines = ['文件名,状态,错误类型,错误信息'];
  if (result.failures.length > 0) {
    for (const f of result.failures) {
      const errorType = f.errorType === 'download' ? '下载失败' : '上传失败';
      const escapedError = `"${(f.error || '').replace(/"/g, '""')}"`;
      const escapedName = `"${f.fileName.replace(/"/g, '""')}"`;
      lines.push(`${escapedName},失败,${errorType},${escapedError}`);
    }
  }
  lines.push('');
  lines.push(`# 成功: ${result.successCount}，跳过: ${result.skippedCount}，失败: ${result.failedCount}`);

  const csvContent = '\uFEFF' + lines.join('\n');
  try {
    const filePath = await saveDialog({
      defaultPath: `picnexus-migrate-${Date.now()}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!filePath) return;
    await writeTextFile(filePath, csvContent);
  } catch (e) {
    log.error('导出失败', e);
  }
}
</script>

<template>
  <div :class="migrateResult && migrateResult.failedCount > 0 ? 'done-split' : 'done-center'" v-if="migrateResult">
    <div class="done-summary">
      <div class="done-icon">
        <i class="pi pi-check-circle" />
      </div>
      <h2 class="done-title">备份完成</h2>
      <div class="done-stats">
        <div class="done-stat-row">
          <span class="dsl">成功</span>
          <span class="dsv dsv--success">{{ formatNumber(migrateResult.successCount) }}</span>
        </div>
        <div class="done-stat-row">
          <span class="dsl" v-tooltip.top="'图片已在目标图床中，无需重复迁移'">跳过</span>
          <span class="dsv">{{ formatNumber(migrateResult.skippedCount) }}</span>
        </div>
        <div v-if="migrateResult.failedCount > 0" class="done-stat-row">
          <span class="dsl">失败</span>
          <span class="dsv dsv--error">{{ formatNumber(migrateResult.failedCount) }}</span>
        </div>
      </div>
    </div>

    <div v-if="migrateResult.failedCount > 0" class="done-detail">
      <span class="done-detail-title">失败详情</span>
      <div class="done-fail-list">
        <div
          v-for="(f, i) in migrateResult.failures"
          :key="i"
          class="done-fail-row"
        >
          <i class="pi pi-image" />
          <span class="done-fail-name">{{ f.fileName }}</span>
          <span class="done-fail-badge" :class="getErrorInfo(f.errorType).badgeClass">
            {{ getErrorInfo(f.errorType).label }}
          </span>
          <span class="done-fail-msg">{{ f.error }}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="bottom">
    <div class="bottom-main">
      <div class="bottom-left" v-if="migrateResult">
        <span class="bottom-stat">
          <span class="bottom-dot bottom-dot--success" /> 成功 {{ formatNumber(migrateResult.successCount) }}
        </span>
        <span v-if="migrateResult.skippedCount > 0" class="bottom-stat" v-tooltip.top="'图片已在目标图床中，无需重复迁移'">
          跳过 {{ formatNumber(migrateResult.skippedCount) }}
        </span>
        <span v-if="migrateResult.failedCount > 0" class="bottom-stat">
          <span class="bottom-dot bottom-dot--error" /> 失败 {{ formatNumber(migrateResult.failedCount) }}
        </span>
      </div>
      <div class="bottom-actions">
        <button v-if="migrateResult?.failedCount" class="btn-ghost" @click="retryFailed">
          重试失败项
        </button>
        <button class="btn-ghost" @click="exportResult">导出</button>
        <span class="action-divider" />
        <button class="btn-primary" @click="resetToConfiguring">完成</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import './migrate-shared.css';

/* 完成阶段 */
.done-split { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.done-center { display: flex; flex: 1; min-height: 0; align-items: center; justify-content: center; }
.done-center .done-summary { width: auto; min-width: 300px; padding: var(--space-3xl) var(--space-4xl); background: var(--bg-card); border-radius: var(--radius-lg); }

.done-summary {
  width: 260px; flex-shrink: 0; padding: var(--space-xl) var(--space-lg-xl);
  background: var(--bg-card);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-md-lg);
}

.done-icon i { font-size: 48px; color: var(--success); }
.done-title { font-size: var(--text-xl); font-weight: 700; color: var(--text-primary); margin: 0; }

.done-stats { width: 100%; display: flex; flex-direction: column; gap: var(--space-sm); margin-top: var(--space-sm); }
.done-stat-row { display: flex; justify-content: space-between; align-items: center; font-size: var(--text-sm); }
.dsl { color: var(--text-muted); }
.dsv { font-weight: 700; font-size: var(--text-lg-xl); color: var(--text-primary); font-variant-numeric: tabular-nums; }
.dsv--success { color: var(--success); }
.dsv--error { color: var(--error); }

.done-detail { flex: 1; min-width: 0; padding: var(--space-xl) var(--space-lg-xl); display: flex; flex-direction: column; overflow: hidden; }
.done-detail-title { font-size: var(--text-sm); font-weight: 600; color: var(--text-muted); margin-bottom: var(--space-sm-md); flex-shrink: 0; }

.done-fail-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-xs-sm); }
.done-fail-row { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); background: var(--bg-card); border-radius: var(--radius-sm-md); font-size: var(--text-xs); }
.done-fail-row i { font-size: var(--text-base); color: var(--text-tertiary); flex-shrink: 0; }
.done-fail-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--text-primary); font-family: var(--font-mono, monospace); font-size: var(--text-xs); }
.done-fail-badge { font-size: var(--text-2xs); font-weight: 500; padding: var(--space-2xs) var(--space-xs-sm); border-radius: var(--radius-sm); flex-shrink: 0; }
.fail-badge--dl { background: var(--error-alpha-10); color: var(--error); }
.fail-badge--ul { background: var(--error-alpha-10); color: var(--error); }
.done-fail-msg { font-size: var(--text-xs); color: var(--text-muted); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 底栏追加 */
.bottom-dot { width: 6px; height: 6px; border-radius: var(--radius-full); flex-shrink: 0; }
.bottom-dot--success { background: var(--success); }
.bottom-dot--error { background: var(--error); }
.action-divider { width: 1px; height: 16px; background: var(--border-subtle); flex-shrink: 0; }
</style>
