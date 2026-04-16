<script setup lang="ts">
/**
 * E2 确认视图 — 视觉化图标流 + 详情卡片
 */
import { computed, inject } from 'vue';
import { getServiceIcon } from '../../../../utils/icons';
import { PUBLIC_SERVICES } from '../../../../config/types';
import type { ServiceType } from '../../../../config/types';
import { formatNumber, estimateTime } from './utils';
import { MIGRATE_KEY } from './keys';

const ctx = inject(MIGRATE_KEY)!;

const {
  sourceServiceFilter, availableSourceServices,
  checkedTargets, totalPending,
} = ctx;

const emit = defineEmits<{ confirm: []; cancel: [] }>();

const hasPublicTarget = computed(() =>
  checkedTargets.value.some(s => PUBLIC_SERVICES.includes(s.serviceId as ServiceType)),
);

function checkedNames(): string {
  return checkedTargets.value.map(s => s.displayName).join('、');
}
</script>

<template>
  <div class="confirm-page">
    <div class="confirm-card">
      <!-- 视觉焦点区：图标流 + 目标名称 -->
      <div class="confirm-visual">
        <div class="confirm-flow">
          <div class="confirm-src-icons">
            <span
              v-for="src in (sourceServiceFilter.length === 0 ? availableSourceServices.slice(0, 4) : availableSourceServices.filter(s => sourceServiceFilter.includes(s.id)))"
              :key="src.id"
              class="confirm-src-icon"
              v-tooltip.top="src.displayName"
              v-html="getServiceIcon(src.id)"
            />
          </div>
          <i class="pi pi-arrow-right confirm-flow-arrow" />
          <div class="confirm-tgt-icon-wrap">
            <span
              v-for="svc in checkedTargets"
              :key="svc.serviceId"
              class="confirm-tgt-icon"
              v-html="getServiceIcon(svc.serviceId)"
            />
          </div>
        </div>
        <span class="confirm-tgt-name">{{ checkedNames() }}</span>
      </div>

      <!-- 两列统计卡片 -->
      <div class="confirm-stats">
        <div class="confirm-stat">
          <span class="confirm-stat-value">{{ formatNumber(totalPending) }} 张</span>
          <span class="confirm-stat-label">迁移数量</span>
        </div>
        <div class="confirm-stat">
          <span class="confirm-stat-value">{{ estimateTime(totalPending) }}</span>
          <span class="confirm-stat-label">预计时间</span>
        </div>
      </div>

      <!-- 警告提示 -->
      <div class="confirm-warns">
        <div v-if="hasPublicTarget" class="confirm-warn">
          <i class="pi pi-exclamation-triangle" />
          <span>公共图床短时间内上传图片有数量限制，不适合大批量迁移</span>
        </div>
        <div class="confirm-warn confirm-warn--info">
          <i class="pi pi-info-circle" />
          <span>迁移过程中请勿关闭应用，关闭后进度不会保留</span>
        </div>
      </div>

      <div class="confirm-btn-row">
        <button class="btn-ghost btn-md" @click="emit('cancel')">← 返回</button>
        <button class="btn-primary btn-md" @click="emit('confirm')">确认开始</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('./migrate-shared.css');

.confirm-page {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: var(--space-xl);
  overflow-y: auto;
}

/* ── 卡片容器 ── */
.confirm-card {
  width: 100%; max-width: 540px;
  padding: var(--space-xl) var(--space-2xl);
  background: var(--bg-card); border-radius: var(--radius-lg);
  display: flex; flex-direction: column; gap: var(--space-lg);
}

/* ── 视觉焦点区 ── */
.confirm-visual {
  display: flex; flex-direction: column; align-items: center;
  gap: var(--space-md);
  padding: var(--space-md) 0 var(--space-xl);
  border-bottom: 1px solid var(--border-subtle);
}

.confirm-flow {
  display: flex; align-items: center; justify-content: center;
  gap: var(--space-lg);
}

.confirm-src-icons { display: flex; gap: var(--space-xs-sm); align-items: center; flex-wrap: wrap; justify-content: center; }

.confirm-src-icon {
  width: 40px; height: 40px; border-radius: var(--radius-sm-md);
  background: var(--bg-card); display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary);
}

.confirm-src-icon :deep(svg) { width: 20px; height: 20px; }

.confirm-flow-arrow { font-size: var(--text-lg-xl); color: var(--primary); }

.confirm-tgt-icon-wrap { display: flex; gap: var(--space-xs); }

.confirm-tgt-icon {
  width: 48px; height: 48px; border-radius: var(--radius-sm-md);
  background: var(--primary-alpha-8);
  border: 2px solid var(--primary);
  display: flex; align-items: center; justify-content: center;
  color: var(--primary);
}

.confirm-tgt-icon :deep(svg) { width: 24px; height: 24px; }

.confirm-tgt-name {
  font-size: var(--text-lg); font-weight: var(--weight-semibold);
  color: var(--text-primary); text-align: center; overflow-wrap: break-word;
}

/* ── 两列统计卡片 ── */
.confirm-stats { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); }

.confirm-stat {
  display: flex; flex-direction: column; align-items: center;
  gap: var(--space-xs);
  padding: var(--space-lg) var(--space-md);
  background: var(--bg-input); border-radius: var(--radius-sm-md);
}

.confirm-stat-value {
  font-size: var(--text-xl); font-weight: var(--weight-bold);
  color: var(--text-primary); font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
}

.confirm-stat-label { font-size: var(--text-xs); color: var(--text-muted); }

/* ── 警告提示 ── */
.confirm-warns { display: flex; flex-direction: column; gap: var(--space-xs); }

.confirm-warn {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-xs-sm) var(--space-md); border-radius: var(--radius-sm-md);
  background: var(--warning-alpha-10); font-size: var(--text-xs); color: var(--warning);
}

.confirm-warn i { font-size: var(--text-base); flex-shrink: 0; }

.confirm-warn--info { background: var(--primary-alpha-8); color: var(--text-secondary); }

.confirm-btn-row { display: flex; justify-content: flex-end; gap: var(--space-sm); margin-top: var(--space-xs); }
</style>
