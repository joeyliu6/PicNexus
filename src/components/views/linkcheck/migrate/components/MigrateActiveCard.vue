<script setup lang="ts">
/**
 * 迁移进行中 — 单张行（两行紧凑布局）
 *
 * 视觉向链接监控 chip 体系对齐：
 * - 第一行：缩略图 + 文件名 + 单个状态 chip
 * - 第二行：源服务 chips → 目标服务 chips
 *
 * 根节点保留 data-slot-state / data-variant 两个属性，
 * 以便 useActiveSlots 的 fade/snapshot 语义照常生效。
 */
import type { MigrateItemStatus } from '../../../../../types/batchMigrate';
import MigrateStatusChip from './chips/MigrateStatusChip.vue';
import MigrateServiceChipGroup from './chips/MigrateServiceChipGroup.vue';

/** 槽位状态：active 呼吸；complete 停止呼吸并渐弱到静止边框 */
export type SlotCardState = 'active' | 'complete';

/** 卡片样式变体：slot=活跃槽，snapshot=最近完成快照（更淡） */
export type CardVariant = 'slot' | 'snapshot';

interface Props {
  item: MigrateItemStatus;
  sourceServiceIds?: string[];
  targetServiceIds?: string[];
  slotState?: SlotCardState;
  variant?: CardVariant;
}

withDefaults(defineProps<Props>(), {
  slotState: 'active',
  variant: 'slot',
  sourceServiceIds: () => [],
  targetServiceIds: () => [],
});
</script>

<template>
  <div class="active-card" :data-slot-state="slotState" :data-variant="variant">
    <div class="ac-thumb">
      <i class="pi pi-image" />
    </div>
    <div class="ac-body">
      <div class="ac-line ac-line--head">
        <span class="ac-name">{{ item.fileName }}</span>
        <MigrateStatusChip :item="item" />
      </div>
      <div class="ac-line ac-line--services">
        <MigrateServiceChipGroup
          v-if="sourceServiceIds.length > 0"
          :services="sourceServiceIds"
          variant="source"
        />
        <i
          v-if="sourceServiceIds.length > 0 && targetServiceIds.length > 0"
          class="pi pi-arrow-right ac-arrow"
          aria-hidden="true"
        />
        <MigrateServiceChipGroup
          v-if="targetServiceIds.length > 0"
          :services="targetServiceIds"
          variant="target"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.active-card {
  display: flex;
  gap: var(--space-md);
  align-items: center;
  padding: var(--space-sm-md) var(--space-md);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  transition:
    box-shadow var(--duration-normal) ease-out,
    border-color var(--duration-normal) ease-out,
    opacity var(--duration-normal) ease-out;
}

/* 槽位完成态：渐弱到静止边框，给"完成了"的视觉收尾 */
.active-card[data-slot-state="complete"] {
  opacity: 0.85;
}

/* 快照变体：静止、更紧凑，透明度更低 */
.active-card[data-variant="snapshot"] {
  opacity: 0.78;
  padding: var(--space-xs-sm) var(--space-md);
  transition: opacity var(--duration-fast);
}
.active-card[data-variant="snapshot"]:hover { opacity: 1; }

.active-card[data-variant="snapshot"] .ac-thumb {
  width: 32px; height: 32px;
  font-size: var(--text-sm);
}

.ac-thumb {
  width: 40px; height: 40px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-input);
  border-radius: var(--radius-sm-md);
  color: var(--text-tertiary);
  font-size: var(--text-md, var(--text-sm));
}

.ac-body {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  gap: var(--space-2xs);
}

.ac-line {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}

.ac-line--head {
  gap: var(--space-sm-md);
}

.ac-name {
  flex: 1; min-width: 0;
  font-family: var(--font-mono, monospace);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.ac-line--services {
  font-size: var(--text-xs);
  color: var(--text-muted);
  flex-wrap: wrap;
}

.ac-arrow {
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
}
</style>
