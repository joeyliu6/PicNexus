<script setup lang="ts">
/**
 * 时间轴 - 轨道视觉层
 * 纯展示：背景轨道 + Google Photos 风格的月份点 + 年份分隔线；
 * 父组件 hover 时通过 hovered prop 点亮月份点
 */
import type { FilteredPoint } from '../../../../utils/timelineFilter';

/** 年份区段（与父组件结构保持一致，本地复制定义） */
interface YearSection {
  year: number;
  startPosition: number;
  endPosition: number;
  totalCount: number;
  labelPosition: number;
}

defineProps<{
  filteredDots: FilteredPoint[];
  yearSections: YearSection[];
  hovered: boolean;
}>();
</script>

<template>
  <div class="timeline-track" :class="{ 'is-hovered': hovered }">
    <!-- 轨道背景 -->
    <div class="track-background"></div>

    <!-- 月份点（Google Photos 风格：统一灰色圆点，智能过滤） -->
    <div
      v-for="dot in filteredDots"
      :key="dot.id"
      class="month-dot"
      :style="{ top: `${dot.position * 100}%` }"
      v-tooltip.top="`${dot.label} (${dot.count}张)`"
    />

    <!-- 年份分隔线 -->
    <div
      v-for="section in yearSections"
      :key="`sep-${section.year}`"
      class="year-separator"
      :style="{ top: `${section.startPosition * 100}%` }"
    />
  </div>
</template>

<style scoped>
.timeline-track {
  position: absolute;
  right: 16px;
  top: 24px;
  bottom: 24px;
  width: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.track-background {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--border-color);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1px 无精确 radius token */
  border-radius: 1px;
  opacity: 0.3;
}

/* 月份点（Google Photos 风格：统一灰色圆点，更小更密集） */
.month-dot {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-secondary);
  opacity: 0.25;
  transform: translateY(-50%);
  transition: opacity var(--duration-normal);
  pointer-events: none;
}

/* 父组件 hover 态 */
.timeline-track.is-hovered .month-dot {
  opacity: 0.4;
}

/* 年份分隔线 */
.year-separator {
  position: absolute;
  right: -4px;
  width: 16px;
  height: 1px;
  background: var(--border-color);
  opacity: 0.5;
}

/* ==================== 响应式 ==================== */

@media (width <= 768px) {
  .timeline-track {
    right: 12px;
  }
}

/* ==================== 深色主题适配 ==================== */

:root.dark-theme .year-separator,
.dark-theme .year-separator {
  opacity: 0.3;
}
</style>
