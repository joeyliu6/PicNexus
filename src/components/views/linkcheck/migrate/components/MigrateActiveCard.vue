<script setup lang="ts">
/**
 * 迁移进行中 — 单张 pipeline 卡
 * 三阶段（下载 → 转换 → 上传），带呼吸动画；仅在 migrating 阶段渲染
 */
import type { MigrateItemStatus } from '../../../../../types/batchMigrate';

/**
 * bypass：格式兼容不需要转换（视觉比 skipped 更中性，不带淡出衰减）
 */
type PipelineState = 'pending' | 'active' | 'complete' | 'failed' | 'skipped' | 'bypass';
interface PipelineStage { key: string; label: string; state: PipelineState }

/** 槽位状态：active 呼吸；complete 停止呼吸并渐弱到静止边框，给用户"完成了"的视觉收尾 */
export type SlotCardState = 'active' | 'complete';

/** 卡片样式变体：slot=活跃槽（有呼吸动画），snapshot=最近完成快照（静止、更紧凑） */
export type CardVariant = 'slot' | 'snapshot';

interface Props {
  item: MigrateItemStatus;
  targetDisplay?: string;
  slotState?: SlotCardState;
  variant?: CardVariant;
}

withDefaults(defineProps<Props>(), { slotState: 'active', variant: 'slot' });

/**
 * 状态 → 三阶段管道映射。
 * 「适配」阶段（stage[1]）在 uploading/success/failed+upload 时，如果 item.convertedFormat 有值表示真转过，
 * 显示 complete；否则显示 bypass（格式兼容，未触发 compress_image）
 */
function buildPipeline(item: MigrateItemStatus): PipelineStage[] {
  const stages: PipelineStage[] = [
    { key: 'download', label: '下载', state: 'pending' },
    { key: 'convert', label: '适配', state: 'pending' },
    { key: 'upload', label: '上传', state: 'pending' },
  ];
  const convertState: PipelineState = item.convertedFormat ? 'complete' : 'bypass';
  switch (item.status) {
    case 'pending':
      return stages;
    case 'downloading':
      stages[0].state = 'active';
      return stages;
    case 'converting':
      stages[0].state = 'complete';
      stages[1].state = 'active';
      return stages;
    case 'uploading':
      stages[0].state = 'complete';
      stages[1].state = convertState;
      stages[2].state = 'active';
      return stages;
    case 'success':
      stages[0].state = 'complete';
      stages[1].state = convertState;
      stages[2].state = 'complete';
      return stages;
    case 'skipped':
      stages.forEach(s => (s.state = 'skipped'));
      return stages;
    case 'failed':
      if (item.errorType === 'download') {
        stages[0].state = 'failed';
        stages[1].state = 'skipped';
        stages[2].state = 'skipped';
      } else {
        stages[0].state = 'complete';
        stages[1].state = convertState;
        stages[2].state = 'failed';
      }
      return stages;
  }
  return stages;
}

function stageLabel(stage: PipelineStage, convertedFormat?: string): string {
  if (stage.state === 'active') return `${stage.label}中`;
  if (stage.state === 'complete') {
    if (stage.key === 'convert' && convertedFormat) return `已转 ${convertedFormat.toUpperCase()}`;
    return `${stage.label}完成`;
  }
  if (stage.state === 'failed') return `${stage.label}失败`;
  if (stage.state === 'bypass') return '格式兼容';
  return `等待${stage.label}`;
}
</script>

<template>
  <div class="active-card" :data-slot-state="slotState" :data-variant="variant">
    <div class="thumb">
      <i class="pi pi-image" />
    </div>
    <div class="card-body">
      <div class="card-head">
        <span class="card-name">{{ item.fileName }}</span>
        <span v-if="targetDisplay" class="card-target">→ {{ targetDisplay }}</span>
      </div>
      <div class="pipeline">
        <template v-for="(stage, i) in buildPipeline(item)" :key="stage.key">
          <span class="pill" :class="`pill--${stage.state}`">
            <i v-if="stage.state === 'complete'" class="pi pi-check pill-ic" />
            <i v-else-if="stage.state === 'active'" class="pi pi-spin pi-sync pill-ic" />
            <i v-else-if="stage.state === 'failed'" class="pi pi-times pill-ic" />
            <i v-else-if="stage.state === 'bypass'" class="pi pi-forward pill-ic" />
            <i v-else class="pi pi-circle pill-ic" />
            <span class="pill-text">{{ stageLabel(stage, item.convertedFormat) }}</span>
          </span>
          <span v-if="i < 2" class="pill-arrow">→</span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.active-card {
  display: flex; gap: var(--space-md); align-items: center;
  padding: var(--space-md) var(--space-lg);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: 0 0 0 0 var(--primary-alpha-20);
  animation: migrate-breathe var(--duration-breathe) ease-in-out infinite;
  transition:
    box-shadow var(--duration-normal) ease-out,
    border-color var(--duration-normal) ease-out;
}

/* 槽位完成态：停止呼吸、渐弱到静止边框，给"完成了"的视觉收尾（对应 maxStayMs 停留） */
.active-card[data-slot-state="complete"] {
  animation: none;
  box-shadow: 0 0 0 0 transparent;
  border-color: var(--border-subtle);
  opacity: 0.85;
}

/* 快照变体：静止、更紧凑，去掉呼吸，透明度更低，让视觉焦点落在活跃槽 */
.active-card[data-variant="snapshot"] {
  animation: none;
  box-shadow: 0 0 0 0 transparent;
  border-color: var(--border-subtle);
  padding: var(--space-sm) var(--space-md);
  opacity: 0.78;
  transition: opacity var(--duration-fast);
}
.active-card[data-variant="snapshot"]:hover { opacity: 1; }

.active-card[data-variant="snapshot"] .thumb {
  width: 40px; height: 40px;
  font-size: var(--text-sm);
}

@keyframes migrate-breathe {
  0%, 100% { box-shadow: 0 0 0 0 var(--primary-alpha-20); border-color: var(--border-subtle); }
  50% { box-shadow: 0 0 0 4px var(--primary-alpha-8); border-color: var(--primary-alpha-25); }
}

.thumb {
  width: 56px; height: 56px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-input);
  border-radius: var(--radius-sm-md);
  color: var(--text-tertiary);
  font-size: var(--text-lg);
}

.card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-sm); }
.card-head { display: flex; align-items: center; gap: var(--space-sm); min-width: 0; }

.card-name {
  flex: 1; min-width: 0;
  font-family: var(--font-mono, monospace);
  font-size: var(--text-sm);
  color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.card-target { font-size: var(--text-xs); color: var(--text-tertiary); flex-shrink: 0; }

.pipeline { display: flex; align-items: center; gap: var(--space-xs-sm); flex-wrap: wrap; }

.pill {
  display: inline-flex; align-items: center; gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-sm);
  border-radius: var(--radius-full);
  font-size: var(--text-xs); font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  transition: background var(--duration-fast);
}
.pill-ic { font-size: var(--text-2xs); }
.pill-arrow { color: var(--text-tertiary); font-size: var(--text-xs); }

.pill--complete { background: var(--success-alpha-10); color: var(--success); }

.pill--active {
  background: var(--primary-alpha-12); color: var(--primary);
  animation: migrate-pulse var(--duration-breathe) ease-in-out infinite;
}
.pill--pending { background: var(--bg-input); color: var(--text-tertiary); }
.pill--failed { background: var(--error-alpha-10); color: var(--error); }
.pill--skipped { background: var(--bg-input); color: var(--text-tertiary); opacity: 0.6; }

/* 格式兼容：中性灰，不带 opacity 衰减，语义比 skipped 更准 */
.pill--bypass { background: var(--bg-input); color: var(--text-tertiary); }

@keyframes migrate-pulse {
  0%, 100% { background: var(--primary-alpha-12); }
  50% { background: var(--primary-alpha-22); }
}
</style>
