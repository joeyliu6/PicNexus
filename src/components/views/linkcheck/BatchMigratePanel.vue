<script setup lang="ts">
/**
 * 批量迁移面板
 * 三阶段流程：选目标图床 → 执行迁移 → 完成
 * UI：网格大卡片配置 + 卡片式迁移进度 + 居中完成报告
 */
import { watch, onActivated } from 'vue';
import Select from 'primevue/select';
import { useBatchMigrateManager } from '../../../composables/useBatchMigrate';
import { useServiceHealth } from '../../../composables/useServiceHealth';
import { useConfirm } from '../../../composables/useConfirm';
import { getServiceIcon } from '../../../utils/icons';
import { emit as tauriEmit } from '@tauri-apps/api/event';

const MAX_VISIBLE_FAILURES = 10;

const {
  phase,
  isInitialized,
  isFilterApplied,
  maxSuccessCount,
  showAdvancedFilter,
  configuredServices,
  unconfiguredServices,
  checkedTargets,
  totalPending,
  allBackedUp,
  itemStatuses,
  globalProgress,
  migrateResult,
  cumulativeCounts,
  estimatedTimeRemaining,
  averageSpeed,
  concurrentCount,
  initConfiguring,
  applyFilter,
  startMigrate,
  cancelMigrate,
  retryFailed,
  resetToConfiguring,
} = useBatchMigrateManager();

const { healthStatusMap, healthTooltipMap } = useServiceHealth();
const { confirm } = useConfirm();

initConfiguring();
onActivated(() => { if (phase.value === 'configuring') initConfiguring(); });

// 高级筛选门槛变化时重新查询
watch(maxSuccessCount, () => { if (phase.value === 'configuring') applyFilter(); });

function navigateToSettings() {
  tauriEmit('navigate-to', { view: 'settings', tab: 'hosting' });
}

function canStart(): boolean {
  return totalPending.value > 0 && checkedTargets.value.length > 0;
}

async function confirmAndStart() {
  const confirmed = await confirm(
    `将备份约 ${formatNumber(totalPending.value)} 张图片到 ${checkedNames()}，确定继续？`,
    { header: '确认备份', acceptLabel: '开始备份' },
  );
  if (confirmed) startMigrate();
}

// 图床健康状态（合并查询，避免多次读取同一个 Map）
const healthLabels: Record<string, string> = { verified: '可用', error: '异常', pending: '待验证' };

function getServiceHealthInfo(serviceId: string) {
  const status = healthStatusMap.value[serviceId] ?? 'pending';
  return {
    text: healthLabels[status] ?? '已配置',
    badgeClass: `badge--${status}`,
    disabled: status === 'error',
    tooltip: status === 'error' ? '图床异常，请先检查配置' : undefined,
  };
}

// 格式化函数
function formatTime(ms: number | null): string {
  if (!ms || ms <= 0) return '--';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return '< 1 分钟';
  if (minutes < 60) return `~${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `~${hours}h ${minutes % 60}m`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '--';
  const mb = bytesPerSec / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = bytesPerSec / 1024;
  return `${kb.toFixed(0)} KB/s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function checkedNames(): string {
  return checkedTargets.value.map(s => s.displayName).join('、');
}

// 失败原因映射
const errorTypeMap: Record<string, { label: string; badgeClass: string }> = {
  download: { label: '下载失败', badgeClass: 'done-failure-badge--dl' },
  upload:   { label: '上传失败', badgeClass: 'done-failure-badge--ul' },
};

function getErrorInfo(errorType: string) {
  return errorTypeMap[errorType] ?? errorTypeMap.upload;
}

// 高级筛选下拉选项
const filterThresholds = [
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 999, label: '全部' },
];

</script>

<template>
  <div class="migrate-panel">

    <!-- ====== configuring: 网格大卡片 ====== -->
    <template v-if="phase === 'configuring'">
      <div class="wk-body">
        <!-- 加载中 -->
        <div v-if="!isInitialized || !isFilterApplied" class="migrate-loading">
          <div class="service-grid">
            <div v-for="i in 3" :key="i" class="skeleton-card">
              <div class="skeleton-line skeleton-line--short" />
              <div class="skeleton-line skeleton-line--badge" />
              <div class="skeleton-line skeleton-line--num" />
              <div class="skeleton-line skeleton-line--label" />
            </div>
          </div>
        </div>

        <!-- 空状态：无已配置图床 -->
        <div v-else-if="configuredServices.length === 0" class="migrate-empty">
          <i class="pi pi-cloud migrate-empty-icon" />
          <p>暂无已配置的图床</p>
          <p class="migrate-empty-sub">请先在设置中配置至少一个图床</p>
          <button class="btn-primary btn-lg" @click="navigateToSettings">去设置 →</button>
        </div>

        <!-- 全部已备份 -->
        <div v-else-if="allBackedUp" class="migrate-empty">
          <i class="pi pi-check-circle migrate-empty-icon migrate-empty-icon--success" />
          <p>所有图片已备份完毕</p>
          <p class="migrate-empty-sub">所有图片都已备份到已配置的图床</p>
        </div>

        <!-- 正常配置 -->
        <template v-else>
          <div class="service-grid">
            <label
              v-for="svc in configuredServices"
              :key="svc.serviceId"
              class="service-card"
              :class="{
                'service-card--checked': svc.checked,
                'service-card--disabled': getServiceHealthInfo(svc.serviceId).disabled,
              }"
              v-tooltip.top="getServiceHealthInfo(svc.serviceId).tooltip"
            >
              <div class="service-card-header">
                <span class="service-card-icon" v-html="getServiceIcon(svc.serviceId)" />
                <span class="service-card-name">{{ svc.displayName }}</span>
                <input
                  v-model="svc.checked"
                  type="checkbox"
                  class="service-card-checkbox"
                  :disabled="getServiceHealthInfo(svc.serviceId).disabled"
                />
              </div>
              <span
                class="service-card-badge"
                :class="getServiceHealthInfo(svc.serviceId).badgeClass"
                v-tooltip.top="healthTooltipMap[svc.serviceId]"
              >
                {{ getServiceHealthInfo(svc.serviceId).text }}
              </span>
              <span class="service-card-count" :class="{ 'service-card-count--active': svc.checked }">
                {{ formatNumber(svc.pendingCount) }}
              </span>
              <span class="service-card-label">张待备份</span>
            </label>

            <!-- 未配置入口卡 -->
            <div
              v-if="unconfiguredServices.length > 0"
              class="service-card service-card--unconfigured"
              @click="navigateToSettings"
            >
              <span class="unconfigured-count">+{{ unconfiguredServices.length }}</span>
              <span class="unconfigured-label">未配置</span>
              <span class="unconfigured-link">去设置 →</span>
            </div>
          </div>

          <!-- 高级筛选 -->
          <button class="adv-toggle" @click="showAdvancedFilter = !showAdvancedFilter">
            <i class="pi" :class="showAdvancedFilter ? 'pi-chevron-down' : 'pi-chevron-right'" />
            <span>高级筛选</span>
          </button>
          <div v-if="showAdvancedFilter" class="adv-filter-body">
            <span class="adv-filter-label">仅处理备份不足</span>
            <Select
              v-model="maxSuccessCount"
              :options="filterThresholds"
              optionLabel="label"
              optionValue="value"
              class="adv-filter-select"
            />
            <span class="adv-filter-label">份的图片</span>
          </div>

          <!-- 提示 -->
          <p class="migrate-tip">
            <i class="pi pi-info-circle" />
            已存在的图片会自动跳过
          </p>
        </template>
      </div>

      <!-- 底栏 -->
      <div class="bottom">
        <div class="bottom-main">
          <div class="bottom-left">
            <template v-if="checkedTargets.length > 0">
              <span class="bottom-stat">
                约 <strong class="bottom-stat-num">{{ formatNumber(totalPending) }}</strong>
                张图片将备份到 {{ checkedNames() }}
              </span>
            </template>
            <span v-else class="bottom-stat bottom-stat--hint">勾选图床 → 自动找出未备份的图片</span>
          </div>
          <div class="bottom-actions">
            <button class="btn-primary" :disabled="!canStart()" @click="confirmAndStart">
              <i class="pi pi-play" /> 开始备份
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- ====== migrating: 进度卡片 + 统计卡 ====== -->
    <template v-else-if="phase === 'migrating'">
      <div class="wk-header">
        <span class="wk-title">正在备份 → {{ checkedNames() }}</span>
        <span class="wk-subtitle">{{ formatNumber(globalProgress.current) }} / {{ formatNumber(globalProgress.total) }} ({{ globalProgress.percent }}%)</span>
      </div>

      <div class="wk-progress">
        <div class="wk-progress-fill" :style="{ width: globalProgress.percent + '%' }" />
      </div>

      <div class="wk-body">
        <!-- 累计统计条 -->
        <div class="cumulative-bar" v-if="cumulativeCounts.success + cumulativeCounts.failed + cumulativeCounts.skipped > 0">
          <span class="cumulative-item cumulative-item--success">
            <i class="pi pi-check-circle" /> {{ formatNumber(cumulativeCounts.success) }} 成功
          </span>
          <span v-if="cumulativeCounts.skipped > 0" class="cumulative-item cumulative-item--muted">
            {{ formatNumber(cumulativeCounts.skipped) }} 跳过
          </span>
          <span v-if="cumulativeCounts.failed > 0" class="cumulative-item cumulative-item--error">
            <i class="pi pi-times-circle" /> {{ formatNumber(cumulativeCounts.failed) }} 失败
          </span>
        </div>

        <div class="status-card">
          <div class="status-list">
            <div
              v-for="item in itemStatuses.slice(0, 50)"
              :key="item.historyId"
              class="status-row"
              :class="item.status"
            >
              <i :class="{
                'pi pi-check-circle': item.status === 'success',
                'pi pi-times-circle': item.status === 'failed',
                'pi pi-minus-circle': item.status === 'skipped',
                'pi pi-spinner pi-spin': item.status === 'downloading' || item.status === 'uploading',
                'pi pi-circle': item.status === 'pending',
              }" />
              <span class="status-filename">{{ item.fileName }}</span>
              <span class="status-services">
                <span
                  v-for="(state, sid) in item.serviceResults"
                  :key="sid"
                  class="svc-badge"
                  :class="state"
                >{{ sid }} {{ state === 'success' ? '✓' : state === 'failed' ? '✗' : '...' }}</span>
              </span>
            </div>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <span class="stat-card-label">估计剩余时间</span>
            <span class="stat-card-value">{{ formatTime(estimatedTimeRemaining) }}</span>
          </div>
          <div class="stat-card">
            <span class="stat-card-label">平均上传速度</span>
            <span class="stat-card-value">{{ formatSpeed(averageSpeed) }}</span>
          </div>
          <div class="stat-card">
            <span class="stat-card-label">并发线程</span>
            <span class="stat-card-value">{{ concurrentCount }} 个任务</span>
          </div>
        </div>
      </div>

      <div class="bottom">
        <div class="bottom-main">
          <div class="bottom-left">
            <span class="bottom-stat bottom-stat--phase">
              <i class="pi pi-sync pi-spin" style="font-size: 12px" />
              {{ formatNumber(globalProgress.current) }} / {{ formatNumber(globalProgress.total) }}
            </span>
            <span class="bottom-sep" />
            <span class="bottom-stat">正在备份图片...</span>
          </div>
          <div class="bottom-actions">
            <button class="btn-danger" @click="cancelMigrate">
              <i class="pi pi-times" /> 取消任务
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- ====== done: 居中完成报告 ====== -->
    <template v-else-if="phase === 'done'">
      <div class="wk-body migrate-done-body">
        <div class="done-card" v-if="migrateResult">
          <div class="done-icon">
            <i class="pi pi-check-circle" />
          </div>
          <h2 class="done-title">备份完成</h2>

          <div class="done-stats">
            <span class="done-stat done-stat--success">
              <i class="pi pi-check-circle" />
              成功 <strong>{{ formatNumber(migrateResult.successCount) }}</strong>
            </span>
            <span class="done-stat done-stat--muted">
              — 跳过 <strong>{{ formatNumber(migrateResult.skippedCount) }}</strong>
            </span>
            <span v-if="migrateResult.failedCount > 0" class="done-stat done-stat--error">
              <i class="pi pi-times-circle" />
              失败 <strong>{{ formatNumber(migrateResult.failedCount) }}</strong>
            </span>
          </div>

          <div v-if="migrateResult.failures.length > 0" class="done-failures">
            <p class="done-failures-title">失败原因：</p>
            <div v-for="(f, i) in migrateResult.failures.slice(0, MAX_VISIBLE_FAILURES)" :key="i" class="done-failure-row">
              <i class="pi pi-image done-failure-icon" />
              <span class="done-failure-name">{{ f.fileName }}</span>
              <span class="done-failure-badge" :class="getErrorInfo(f.errorType).badgeClass">
                {{ getErrorInfo(f.errorType).label }}
              </span>
              <span class="done-failure-msg">{{ f.error }}</span>
            </div>
            <p v-if="migrateResult.failures.length > MAX_VISIBLE_FAILURES" class="done-failures-more">
              还有 {{ migrateResult.failures.length - MAX_VISIBLE_FAILURES }} 项未显示
            </p>
          </div>
        </div>
      </div>

      <div class="bottom">
        <div class="bottom-main">
          <div class="bottom-left">
            <template v-if="migrateResult">
              <span class="bottom-stat">
                <span class="bottom-dot bottom-dot--success" /> 成功 {{ formatNumber(migrateResult.successCount) }}
              </span>
              <template v-if="migrateResult.skippedCount > 0">
                <span class="bottom-sep" />
                <span class="bottom-stat">
                  跳过 {{ formatNumber(migrateResult.skippedCount) }}
                </span>
              </template>
              <template v-if="migrateResult.failedCount > 0">
                <span class="bottom-sep" />
                <span class="bottom-stat">
                  <span class="bottom-dot bottom-dot--error" /> 失败 {{ formatNumber(migrateResult.failedCount) }}
                </span>
              </template>
            </template>
          </div>
          <div class="bottom-actions">
            <button v-if="migrateResult?.failedCount" class="btn-ghost" @click="retryFailed">
              重试失败项
            </button>
            <span v-if="migrateResult?.failedCount" class="action-divider" />
            <button class="btn-primary" @click="resetToConfiguring">
              完成
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.migrate-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ============================================================
   通用布局
   ============================================================ */
.wk-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; height: 48px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0;
  background: var(--bg-card);
}

.wk-title { font-size: 14px; font-weight: 600; color: var(--text-main); }
.wk-subtitle { font-size: 12px; color: var(--text-tertiary); }

.wk-progress { height: 4px; background: var(--border-subtle); flex-shrink: 0; }
.wk-progress-fill { height: 100%; background: var(--primary); transition: width var(--duration-slow) ease; border-radius: 0 2px 2px 0; }

.wk-body {
  flex: 1; overflow-y: auto; padding: 20px;
  display: flex; flex-direction: column; gap: 16px;
}

/* ============================================================
   加载态 skeleton
   ============================================================ */
.migrate-loading {
  flex: 1;
}

.skeleton-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 16px; border-radius: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
}

.skeleton-line {
  border-radius: 4px;
  background: var(--border-subtle);
  animation: k-shimmer var(--duration-shimmer) infinite;
}

.skeleton-line--short { width: 60%; height: 14px; }
.skeleton-line--badge { width: 48px; height: 16px; border-radius: 9999px; }
.skeleton-line--num { width: 40%; height: 20px; }
.skeleton-line--label { width: 50%; height: 12px; }

/* ============================================================
   空状态
   ============================================================ */
.migrate-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; gap: 8px; text-align: center;
}

.migrate-empty p { margin: 0; font-size: 14px; font-weight: 500; color: var(--text-secondary); }
.migrate-empty-sub { font-size: 13px !important; color: var(--text-tertiary) !important; font-weight: 400 !important; }
.migrate-empty-icon { font-size: 36px; color: var(--text-tertiary); margin-bottom: 4px; }
.migrate-empty-icon--success { color: var(--success); }

/* ============================================================
   configuring: 服务网格大卡片
   ============================================================ */
.service-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.service-card {
  display: flex; flex-direction: column;
  padding: 16px; border-radius: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  cursor: pointer; transition: all var(--duration-fast);
  gap: 6px;
}

.service-card:hover { border-color: var(--primary-alpha-40); }

.service-card--checked {
  border: 2px solid var(--primary);
  background: var(--primary-alpha-5);
}

.service-card--disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: auto;
}

.service-card--disabled:hover { border-color: var(--border-subtle); }
.service-card--disabled .service-card-checkbox { cursor: not-allowed; }

.service-card--unconfigured {
  border: 2px dashed var(--border-subtle);
  background: var(--bg-app);
  cursor: pointer;
  align-items: center; justify-content: center;
  min-height: 140px;
}

.service-card-header {
  display: flex; align-items: center; gap: 8px;
}

.service-card-icon {
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary);
}

.service-card-icon :deep(svg) { width: 24px; height: 24px; }

.service-card-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }

.service-card-checkbox {
  margin-left: auto;
  accent-color: var(--primary);
  width: 16px; height: 16px;
}

.service-card-badge {
  font-size: 10px; font-weight: 500;
  padding: 2px 8px; border-radius: 9999px;
  width: fit-content;
}

.badge--verified { color: var(--success); background: var(--success-alpha-10); }
.badge--pending { color: var(--warning); background: var(--warning-alpha-10); }
.badge--error { color: var(--error); background: var(--error-alpha-10); }
.badge--unconfigured { color: var(--text-muted); background: var(--bg-input); }

.service-card-count {
  font-size: 20px; font-weight: 600;
  color: var(--text-tertiary);
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}

.service-card-count--active { color: var(--primary); }

.service-card-label {
  font-size: 12px; color: var(--text-muted);
}

.unconfigured-count { font-size: 24px; font-weight: 600; color: var(--text-tertiary); }
.unconfigured-label { font-size: 12px; color: var(--text-tertiary); margin-bottom: 4px; }
.unconfigured-link {
  font-size: 13px; font-weight: 500; color: var(--primary);
  transition: opacity var(--duration-fast);
}

.service-card--unconfigured:hover .unconfigured-link { opacity: 0.8; }

/* 高级筛选 */
.adv-toggle {
  display: flex; align-items: center; gap: 6px;
  background: none; border: none; cursor: pointer;
  font-size: 12px; font-weight: 500; color: var(--text-muted);
  padding: 6px 0; font-family: inherit;
  transition: color var(--duration-fast);
}

.adv-toggle:hover { color: var(--text-secondary); }
.adv-toggle i { font-size: 10px; }

.adv-filter-body {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 8px;
  background: var(--bg-input); font-size: 13px; color: var(--text-secondary);
}

.adv-filter-label { white-space: nowrap; }

:deep(.adv-filter-select.p-select) {
  height: 28px; min-width: 60px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  font-size: 13px;
}

:deep(.adv-filter-select .p-select-label) {
  padding: 4px 8px; font-size: 13px;
}

/* 提示 */
.migrate-tip {
  font-size: 12px; color: var(--text-muted); margin: 0;
  display: flex; align-items: center; gap: 4px;
}

.migrate-tip i { font-size: 11px; color: var(--primary); }

/* 累计统计条 */
.cumulative-bar {
  display: flex; align-items: center; gap: 16px;
  padding: 8px 14px; border-radius: 8px;
  background: var(--bg-card); flex-shrink: 0;
  font-size: 13px; font-weight: 500;
}

.cumulative-item {
  display: inline-flex; align-items: center; gap: 4px;
}

.cumulative-item i { font-size: 12px; }
.cumulative-item--success { color: var(--success); }
.cumulative-item--muted { color: var(--text-muted); }
.cumulative-item--error { color: var(--error); }

/* ============================================================
   migrating: 状态卡片 + 统计卡
   ============================================================ */
.status-card {
  background: var(--bg-card);
  border-radius: 10px;
  overflow: hidden;
  flex: 1; min-height: 0;
}

.status-list {
  display: flex; flex-direction: column; gap: 1px;
  max-height: 100%; overflow-y: auto;
  padding: 4px;
}

.status-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 6px; font-size: 13px;
}

.status-row i { font-size: 14px; }
.status-row.success i { color: var(--success); }
.status-row.failed i { color: var(--error); }
.status-row.skipped i { color: var(--text-muted); }
.status-row.downloading i, .status-row.uploading i { color: var(--primary); }
.status-row.pending i { color: var(--text-tertiary); }
.status-row.downloading, .status-row.uploading { background: var(--warning-alpha-8); }

.status-filename {
  color: var(--text-primary); flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.status-services { display: flex; gap: 4px; flex-shrink: 0; }

.svc-badge {
  font-size: 11px; padding: 2px 8px; border-radius: 9999px;
  background: var(--bg-input); color: var(--text-muted); font-weight: 500;
}

.svc-badge.success { background: var(--success-alpha-10); color: var(--success); }
.svc-badge.failed { background: var(--error-alpha-10); color: var(--error); }

/* 三个统计小卡片 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px; flex-shrink: 0;
}

.stat-card {
  display: flex; flex-direction: column; gap: 4px;
  padding: 14px 16px; border-radius: 8px;
  background: var(--bg-card);
}

.stat-card-label { font-size: 11px; font-weight: 500; color: var(--text-muted); }
.stat-card-value { font-size: 18px; font-weight: 700; color: var(--text-primary); }

/* ============================================================
   done: 居中大卡片
   ============================================================ */
.migrate-done-body {
  align-items: center; justify-content: center;
}

.done-card {
  display: flex; flex-direction: column;
  align-items: center;
  max-width: 600px; width: 100%;
  padding: 40px 32px;
  background: var(--bg-card);
  border-radius: 12px;
  gap: 16px;
}

.done-icon i { font-size: 48px; color: var(--success); }
.done-title { font-size: 20px; font-weight: 600; color: var(--text-primary); margin: 0; }

.done-stats { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; justify-content: center; }

.done-stat {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 14px; font-weight: 500;
}

.done-stat i { font-size: 16px; }
.done-stat strong { font-weight: 700; }
.done-stat--success { color: var(--success); }
.done-stat--muted { color: var(--text-muted); }
.done-stat--error { color: var(--error); }

.done-failures {
  width: 100%; text-align: left;
  padding: 16px; border-radius: 8px;
  background: var(--bg-app);
}

.done-failures-title {
  font-size: 13px; font-weight: 600; color: var(--text-secondary);
  margin: 0 0 12px;
}

.done-failure-row {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: 6px;
  background: var(--bg-card);
  margin-bottom: 6px; font-size: 13px;
}

.done-failure-icon { font-size: 14px; color: var(--text-tertiary); flex-shrink: 0; }

.done-failure-name {
  font-weight: 500; color: var(--text-primary);
  max-width: 280px; min-width: 0; flex-shrink: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.done-failure-badge {
  font-size: 10px; font-weight: 500; padding: 2px 8px;
  border-radius: 4px; flex-shrink: 0;
}

.done-failure-badge--dl { background: var(--error-alpha-10); color: var(--error); }
.done-failure-badge--ul { background: var(--error-alpha-10); color: var(--error); }

.done-failure-msg {
  font-size: 12px; color: var(--text-muted);
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.done-failures-more {
  font-size: 12px; color: var(--text-tertiary); text-align: center;
  margin: 8px 0 0; font-style: italic;
}

/* ============================================================
   底栏（对齐链接监控设计）
   ============================================================ */
.bottom {
  display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;
  padding: 10px 16px 14px;
}

.bottom-main {
  display: flex; align-items: center; justify-content: space-between;
}

.bottom-left {
  display: flex; align-items: center; gap: 0; flex-wrap: wrap;
}

.bottom-stat {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 500; color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.bottom-stat-num { color: var(--primary); font-weight: 700; }
.bottom-stat--hint { color: var(--text-tertiary); }
.bottom-stat--phase { color: var(--primary); }

.bottom-sep {
  width: 1px; height: 12px; background: var(--border-subtle);
  margin: 0 10px; flex-shrink: 0;
}

.bottom-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}

.bottom-dot--success { background: var(--success); }
.bottom-dot--error { background: var(--error); }

.bottom-actions {
  display: flex; align-items: center; gap: 8px; margin-left: auto;
}

.action-divider {
  width: 1px; height: 16px;
  background: var(--border-subtle);
  flex-shrink: 0;
}

/* ============================================================
   按钮
   ============================================================ */
.btn-primary, .btn-danger {
  display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 12px;
  border-radius: 7px; font-size: 13px; font-weight: 500; cursor: pointer;
  white-space: nowrap; transition: background var(--duration-fast), opacity var(--duration-fast); border: none;
  font-family: inherit;
}

.btn-primary i, .btn-danger i { font-size: 11px; }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover:not(:disabled) { opacity: 0.9; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-danger { background: var(--error); color: #fff; }
.btn-danger:hover { opacity: 0.9; }

.btn-lg { height: 36px; padding: 0 18px; font-size: 14px; border-radius: 8px; }

.btn-ghost {
  display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px;
  border-radius: 7px; font-size: 13px; font-weight: 500; cursor: pointer;
  white-space: nowrap; border: none; font-family: inherit;
  background: var(--bg-input); color: var(--text-secondary);
  transition: background var(--duration-fast), color var(--duration-fast);
}

.btn-ghost:hover { background: var(--hover-overlay); color: var(--text-primary); }
</style>
