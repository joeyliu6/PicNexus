<script setup lang="ts">
/**
 * E3 执行阶段 — 进度面板 + 实时文件流
 */
import { inject } from 'vue';
import { formatNumber, formatTime, formatSpeed, MAX_VISIBLE_FILES } from './utils';
import { MIGRATE_KEY } from './keys';

const ctx = inject(MIGRATE_KEY)!;

const {
  globalProgress, cumulativeCounts, estimatedTimeRemaining,
  averageSpeed, itemStatuses, cancelMigrate,
} = ctx;
</script>

<template>
  <div class="progress-bar" role="progressbar" :aria-valuenow="globalProgress.percent">
    <div class="progress-bar-inner">
      <div class="progress-bar-fill" :style="{ width: globalProgress.percent + '%' }" />
    </div>
  </div>

  <div class="migrate-split">
    <!-- 左栏：进度面板 -->
    <div class="progress-panel">
      <span class="progress-count-main">{{ formatNumber(globalProgress.current) }} <span class="progress-count-sep">/</span> {{ formatNumber(globalProgress.total) }}</span>
      <span class="progress-pct">{{ globalProgress.percent }}%</span>

      <svg class="progress-ring" viewBox="0 0 100 100">
        <circle class="progress-ring-bg" cx="50" cy="50" r="42" />
        <circle
          class="progress-ring-fill"
          cx="50" cy="50" r="42"
          :style="{ strokeDashoffset: 264 - (264 * globalProgress.percent / 100) }"
        />
      </svg>

      <div class="progress-stats">
        <div class="progress-stat-row">
          <span class="psl">成功</span>
          <span class="psv psv--success">{{ formatNumber(cumulativeCounts.success) }}</span>
        </div>
        <div class="progress-stat-row">
          <span class="psl" v-tooltip.top="'图片已在目标图床中，无需重复迁移'">跳过</span>
          <span class="psv">{{ formatNumber(cumulativeCounts.skipped) }}</span>
        </div>
        <div class="progress-stat-row">
          <span class="psl">失败</span>
          <span class="psv psv--error">{{ formatNumber(cumulativeCounts.failed) }}</span>
        </div>
        <div class="progress-stat-row">
          <span class="psl">速度</span>
          <span class="psv psv--muted">{{ formatSpeed(averageSpeed) }}</span>
        </div>
        <div class="progress-stat-row">
          <span class="psl">剩余</span>
          <span class="psv psv--muted">{{ formatTime(estimatedTimeRemaining) }}</span>
        </div>
      </div>
    </div>

    <!-- 右栏：实时文件流 -->
    <div class="file-stream">
      <div class="file-stream-header">
        <span class="file-stream-title">实时文件流</span>
        <span v-if="itemStatuses.length > MAX_VISIBLE_FILES" class="file-stream-hint">
          显示最近 {{ MAX_VISIBLE_FILES }} 条
        </span>
      </div>
      <div class="file-list">
        <div
          v-for="item in itemStatuses.slice(0, MAX_VISIBLE_FILES)"
          :key="item.historyId"
          class="file-row"
          :class="item.status"
        >
          <i :class="{
            'pi pi-check-circle': item.status === 'success',
            'pi pi-times-circle': item.status === 'failed',
            'pi pi-minus-circle': item.status === 'skipped',
            'pi pi-spinner pi-spin': item.status === 'downloading' || item.status === 'uploading',
            'pi pi-circle': item.status === 'pending',
          }" />
          <span class="file-name">{{ item.fileName }}</span>
          <span class="file-services">
            <span
              v-for="(state, sid) in item.serviceResults"
              :key="sid"
              class="svc-tag"
              :class="state"
            >{{ sid }} {{ state === 'success' ? '✓' : state === 'failed' ? '✗' : '...' }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>

  <div class="bottom">
    <div class="bottom-main">
      <div class="bottom-left">
        <i class="pi pi-sync pi-spin bottom-spin" />
        <span class="bottom-stat">正在处理... {{ formatNumber(globalProgress.current) }} / {{ formatNumber(globalProgress.total) }}</span>
      </div>
      <div class="bottom-actions">
        <button class="btn-danger" @click="cancelMigrate">
          <i class="pi pi-times" /> 取消
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('./migrate-shared.css');

/* 进度条 */
.progress-bar { width: 100%; flex-shrink: 0; padding: var(--space-xs) 0; }
.progress-bar-inner { width: 100%; height: 3px; background: var(--bg-input); overflow: hidden; }
.progress-bar-fill { height: 100%; background: var(--primary-gradient, var(--primary)); transition: width var(--duration-slower) ease; }

.migrate-split { display: flex; flex: 1; min-height: 0; overflow: hidden; }

/* 左栏：进度面板 */
.progress-panel {
  width: 260px; flex-shrink: 0; padding: var(--space-xl) var(--space-lg-xl);
  background: var(--bg-card);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-md);
}

.progress-count-main { font-size: var(--text-4xl); font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1; }
.progress-count-sep { color: var(--text-tertiary); font-weight: 400; }
.progress-pct { font-size: var(--text-lg); font-weight: 600; color: var(--text-muted); font-variant-numeric: tabular-nums; }

.progress-ring { width: 88px; height: 88px; }
.progress-ring-bg { fill: none; stroke: var(--bg-input); stroke-width: 5; }

.progress-ring-fill {
  fill: none; stroke: var(--primary); stroke-width: 5; stroke-linecap: round;
  stroke-dasharray: 264; transform: rotate(-90deg); transform-origin: 50% 50%;
  transition: stroke-dashoffset var(--duration-slower) ease;
}

.progress-stats { width: 100%; display: flex; flex-direction: column; gap: var(--space-xs-sm); margin-top: var(--space-sm); }
.progress-stat-row { display: flex; justify-content: space-between; align-items: center; font-size: var(--text-xs); }
.psl { color: var(--text-muted); }
.psv { font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.psv--success { color: var(--success); }
.psv--error { color: var(--error); }
.psv--muted { color: var(--text-tertiary); font-weight: 500; }

/* 右栏：文件流 */
.file-stream { flex: 1; min-width: 0; padding: var(--space-lg) var(--space-lg-xl); display: flex; flex-direction: column; overflow: hidden; }
.file-stream-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-sm-md); flex-shrink: 0; }
.file-stream-title { font-size: var(--text-sm); font-weight: 600; color: var(--text-muted); }
.file-stream-hint { font-size: var(--text-xs); color: var(--text-tertiary); }
.file-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-2xs); }

.file-row { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs-sm) var(--space-sm-md); border-radius: var(--radius-sm); font-size: var(--text-xs); }
.file-row:nth-child(odd) { background: var(--bg-card); }
.file-row i { font-size: var(--text-xs); flex-shrink: 0; }
.file-row.success i { color: var(--success); }
.file-row.failed i { color: var(--error); }
.file-row.skipped i { color: var(--text-muted); }
.file-row.downloading i, .file-row.uploading i { color: var(--primary); }
.file-row.pending i { color: var(--text-tertiary); }

.file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-family: var(--font-mono, monospace); font-size: var(--text-xs); }
.file-row.skipped .file-name, .file-row.pending .file-name { color: var(--text-muted); }

.file-services { display: flex; gap: var(--space-xs); flex-shrink: 0; }
.svc-tag { font-size: var(--text-2xs); padding: var(--space-2xs) var(--space-xs-sm); border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-muted); font-weight: 500; }
.svc-tag.success { background: var(--success-alpha-10); color: var(--success); }
.svc-tag.failed { background: var(--error-alpha-10); color: var(--error); }

/* 底栏追加 */
.bottom-spin { font-size: var(--text-xs); color: var(--primary); }
</style>
