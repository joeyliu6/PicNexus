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
    <div class="confirm-page-header">
      <h2 class="confirm-page-title">批量迁移 — 确认</h2>
      <p class="confirm-page-sub">确认以下迁移详情</p>
    </div>

    <!-- 视觉化图标流 -->
    <div class="confirm-visual">
      <div class="confirm-src-icons">
        <span
          v-for="src in (sourceServiceFilter.length === 0 ? availableSourceServices.slice(0, 4) : availableSourceServices.filter(s => sourceServiceFilter.includes(s.id)))"
          :key="src.id"
          class="confirm-src-icon"
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
      <span class="confirm-tgt-name">{{ checkedNames() }}</span>
    </div>

    <!-- 详情卡片 -->
    <div class="confirm-card">
      <div class="confirm-row">
        <span class="confirm-row-label">迁移数量</span>
        <span class="confirm-row-value">{{ formatNumber(totalPending) }} 张</span>
      </div>
      <div class="confirm-row">
        <span class="confirm-row-label">预计时间</span>
        <span class="confirm-row-value">{{ estimateTime(totalPending) }}</span>
      </div>

      <div v-if="hasPublicTarget" class="confirm-warn">
        <i class="pi pi-exclamation-triangle" />
        <span>公共图床有数量限制，大批量迁移可能耗时较长或部分失败</span>
      </div>

      <div class="confirm-warn confirm-warn--info">
        <i class="pi pi-info-circle" />
        <span>迁移过程中请勿关闭应用，关闭后进度不会保留</span>
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
  align-items: center; padding-right: var(--space-xl);
  overflow-y: auto;
}

.confirm-page-header { width: 100%; margin-bottom: var(--space-lg); }
.confirm-page-title { font-size: var(--text-lg-xl); font-weight: var(--weight-bold); color: var(--text-primary); margin: 0; }
.confirm-page-sub { font-size: var(--text-sm); color: var(--text-muted); margin: var(--space-xs) 0 0; }

/* 视觉化图标流 */
.confirm-visual {
  display: flex; align-items: center; justify-content: center;
  gap: var(--space-lg); padding: var(--space-xl) 0;
}
.confirm-src-icons { display: flex; gap: var(--space-xs-sm); align-items: center; }

.confirm-src-icon {
  width: 32px; height: 32px; border-radius: var(--radius-sm-md);
  background: var(--bg-card); display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary);
}
.confirm-src-icon :deep(svg) { width: 16px; height: 16px; }
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
.confirm-tgt-name { font-size: var(--text-lg); font-weight: var(--weight-semibold); color: var(--text-primary); }

/* 详情卡片 */
.confirm-card {
  width: 100%; max-width: 480px;
  padding: var(--space-lg-xl) var(--space-xl);
  background: var(--bg-card); border-radius: var(--radius-lg);
  display: flex; flex-direction: column; gap: var(--space-md);
}
.confirm-row { display: flex; justify-content: space-between; align-items: center; font-size: var(--text-sm); }
.confirm-row-label { color: var(--text-muted); }
.confirm-row-value { font-weight: var(--weight-semibold); color: var(--text-primary); font-variant-numeric: tabular-nums; }

.confirm-warn {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm-md);
  background: var(--warning-alpha-10); font-size: var(--text-xs); color: var(--warning);
}
.confirm-warn i { font-size: var(--text-base); flex-shrink: 0; }
.confirm-warn--info { background: var(--primary-alpha-8); color: var(--text-secondary); }

.confirm-btn-row { display: flex; justify-content: flex-end; gap: var(--space-sm); margin-top: var(--space-xs); }
</style>
