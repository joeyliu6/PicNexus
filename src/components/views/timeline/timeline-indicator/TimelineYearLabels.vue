<script setup lang="ts">
/**
 * 时间轴 - 年份标签列
 * 展示空间优先过滤后的年份标签，点击冒泡交给父组件；
 * active=true 时跟随父组件的 hover/拖拽状态变亮
 */

/** 年份区段（与父组件结构保持一致，本地复制定义） */
interface YearSection {
  year: number;
  startPosition: number;
  endPosition: number;
  totalCount: number;
  labelPosition: number;
}

defineProps<{
  sections: YearSection[];
  active: boolean;
}>();

const emit = defineEmits<{
  (e: 'year-click', year: number, event: MouseEvent): void;
}>();
</script>

<template>
  <div class="year-labels" :class="{ 'is-active': active }">
    <div
      v-for="section in sections"
      :key="section.year"
      class="year-label"
      :style="{ top: `${section.labelPosition * 100}%` }"
      @click="emit('year-click', section.year, $event)"
    >
      {{ section.year }}
    </div>
  </div>
</template>

<style scoped>
.year-labels {
  position: absolute;
  left: 0;
  top: 24px;
  bottom: 24px;
  width: 36px;
  pointer-events: none;
}

.year-label {
  position: absolute;
  right: 4px;
  transform: translateY(-100%);  /* 标签位于年份底部边界上方 */
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  opacity: 0.6;
  transition: all var(--duration-normal) ease;
  pointer-events: auto;
  cursor: pointer;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1px 为微间距，无 spacing token */
  padding: 1px var(--space-xs-sm);
  border-radius: var(--radius-md);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 半透明白色背景无语义变量 */
  background: rgb(255 255 255 / 60%);
}

.year-label:hover {
  opacity: 1;
  color: var(--primary);
  background: var(--bg-hover);
}

/* 父组件 hover / 拖拽激活态 */
.year-labels.is-active .year-label {
  opacity: 1;
  color: var(--text-primary);
}

/* ==================== 响应式 ==================== */

@media (width <= 1024px) {
  .year-labels {
    width: 28px;
  }

  .year-label {
    font-size: var(--text-2xs);
  }
}

@media (width <= 768px) {
  .year-labels {
    display: none;
  }
}

/* 触摸设备 */
@media (hover: none) {
  .year-label {
    opacity: 0.8;
    font-size: var(--text-2xs);
  }
}

/* ==================== 深色主题适配 ==================== */

:root.dark-theme .year-label,
.dark-theme .year-label {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 深色主题下半透明白色无语义变量 */
  background: rgb(255 255 255 / 15%);
}
</style>
