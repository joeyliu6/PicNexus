<script setup lang="ts">
// 服务启用芯片网格子组件
// 展示服务列表的芯片 UI，支持启用/禁用切换、健康状态着色、批量检测动画、筛选

import { computed } from 'vue';
import type { ServiceType } from '../../config/types';
import type { ServiceHealthStatus } from '../../types/serviceHealth';

const props = defineProps<{
  /** 服务 ID 列表 */
  services: ServiceType[];
  /** 分组标题 */
  groupTitle: string;
  /** 各服务的健康状态映射 */
  healthStatusMap: Record<string, ServiceHealthStatus>;
  /** 各服务的 tooltip 映射 */
  healthTooltipMap: Record<string, string | null>;
  /** 当前已启用的服务列表 */
  availableServices: string[];
  /** 服务中文名映射 */
  serviceNames: Record<string, string>;
  /** 是否正在批量检测 */
  isBatchTesting: boolean;
  /** 已完成检测的服务集合 */
  batchTestedServices: Set<string>;
  /** 刚完成检测的服务集合（短暂高亮） */
  batchDoneServices: Set<string>;
  /** 当前激活的筛选条件 */
  activeFilter: ServiceHealthStatus | null;
}>();

const emit = defineEmits<{
  /** 切换服务启用/禁用 */
  toggleService: [service: ServiceType];
  /** 点击芯片跳转到配置 */
  chipClick: [service: ServiceType];
}>();

/** 生成芯片 tooltip */
function getChipTooltip(svc: ServiceType): string | null {
  const status = props.healthStatusMap[svc];
  if (status === 'unconfigured') return '未配置，点击跳转到配置';
  return props.healthTooltipMap[svc] ?? null;
}

/** 判断服务是否已启用 */
function isEnabled(svc: ServiceType): boolean {
  return props.availableServices.includes(svc);
}

/** 生成芯片的 CSS class 数组 */
function chipClasses(svc: ServiceType): Record<string, boolean> {
  return {
    'is-batch-shimmer': props.isBatchTesting && !props.batchTestedServices.has(svc),
    'is-batch-done': props.batchDoneServices.has(svc),
    'is-filtered-out': !!props.activeFilter && props.healthStatusMap[svc] !== props.activeFilter,
  };
}

/** 服务列表（直接使用 props，无需额外计算） */
const serviceList = computed(() => props.services);
</script>

<template>
  <div class="service-group-section">
    <div class="service-group-title">{{ groupTitle }}</div>
    <div class="service-toggles-grid">
      <div
        v-for="svc in serviceList"
        :key="svc"
        class="toggle-chip"
        :class="[healthStatusMap[svc], chipClasses(svc)]"
        v-tooltip.top="getChipTooltip(svc)"
        @click="emit('chipClick', svc)"
      >
        <span v-if="healthStatusMap[svc] === 'unconfigured'" class="toggle-empty-circle"></span>
        <button
          v-else
          class="toggle-indicator"
          :class="{ checked: isEnabled(svc) }"
          :aria-pressed="isEnabled(svc)"
          :aria-label="`${isEnabled(svc) ? '禁用' : '启用'} ${serviceNames[svc]}`"
          @click.stop="emit('toggleService', svc)"
        >
          <i v-if="isEnabled(svc)" class="pi pi-check"></i>
        </button>
        <span class="toggle-label">{{ serviceNames[svc] }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.service-group-section {
  margin-bottom: var(--space-lg);
}

.service-group-section:last-child {
  margin-bottom: 0;
}

.service-group-title {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--space-sm);
}

.service-toggles-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.toggle-chip {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  padding: var(--space-xs-sm) var(--space-md-lg);
  background: var(--hover-overlay-subtle);
  border: 1px solid var(--border-subtle-light);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: all var(--duration-normal);
}

.toggle-chip .toggle-label {
  font-size: var(--text-xs);
  color: var(--text-primary);
  white-space: nowrap;
}

/* 可用 - 淡绿底 */
.toggle-chip.verified {
  background: var(--success-alpha-8);
}

.toggle-chip.verified:hover {
  background: var(--success-alpha-15);
}

/* 未配置 - 明确弱化 */
.toggle-chip.unconfigured {
  cursor: pointer;
  background: transparent;
  border-color: var(--hover-overlay-subtle);
}

.toggle-chip.unconfigured .toggle-label {
  opacity: 0.4;
}

.toggle-chip.unconfigured:hover {
  background: var(--primary-alpha-8);
  border-color: var(--hover-overlay);
}

.toggle-chip.unconfigured:hover .toggle-label {
  opacity: 0.7;
}

/* 未检测 - 淡紫底 */
.toggle-chip.pending {
  background: var(--pending-alpha-8);
}

.toggle-chip.pending:hover {
  background: var(--pending-alpha-15);
}

/* 有问题 - 淡红底 */
.toggle-chip.error {
  background: var(--error-alpha-8);
}

.toggle-chip.error:hover {
  background: var(--error-alpha-15);
}

.toggle-indicator {
  width: 18px;
  height: 18px;
  padding: 0;
  background: none;
  border-radius: var(--radius-full);
  border: 1.5px solid var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  font-family: inherit;
  transition: all var(--duration-normal);
  opacity: 0.45;
}

.toggle-indicator .pi {
  font-size: var(--text-2xs);
  color: var(--text-on-primary);
  display: none;
}

.toggle-indicator.checked {
  opacity: 1;
  border: none;
}

.toggle-indicator.checked .pi {
  display: block;
}

.toggle-chip.verified .toggle-indicator.checked {
  background: var(--success);
}

.toggle-chip.pending .toggle-indicator.checked {
  background: var(--pending);
}

.toggle-chip.error .toggle-indicator.checked {
  background: var(--error);
}

.toggle-indicator:hover {
  opacity: 0.8;
  border-color: var(--primary);
}

.toggle-indicator.checked:hover {
  filter: brightness(1.15);
}

.toggle-empty-circle {
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  border: 1.5px solid var(--text-muted);
  opacity: 0.3;
  flex-shrink: 0;
  transition: all var(--duration-normal);
}

.toggle-chip.unconfigured:hover .toggle-empty-circle {
  opacity: 0.5;
  border-color: var(--primary);
}

/* 批量检测中：统一淡蓝底 + 扫光效果 */
.toggle-chip.is-batch-shimmer {
  position: relative;
  overflow: hidden;
  background: var(--success-alpha-8) !important;
  border-color: var(--success-alpha-15);
}

.toggle-chip.is-batch-shimmer::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--success-alpha-15) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: k-shimmer 1.4s ease-in-out infinite reverse;
  border-radius: inherit;
  pointer-events: none;
}

/* 单个服务检测完成：脉冲扩散 */
.toggle-chip.is-batch-done {
  animation: chip-done-pulse 0.6s ease-out;
}

@keyframes chip-done-pulse {
  0%   { box-shadow: 0 0 0 0 var(--primary-alpha-30); }
  50%  { box-shadow: 0 0 0 4px var(--primary-alpha-15); }
  100% { box-shadow: 0 0 0 0 transparent; }
}

/* 未配置服务：柔和灰色脉冲 */
.toggle-chip.unconfigured.is-batch-done {
  animation: chip-done-pulse-muted 0.6s ease-out;
}

@keyframes chip-done-pulse-muted {
  0%   { box-shadow: 0 0 0 0 var(--hover-overlay); }
  50%  { box-shadow: 0 0 0 4px var(--hover-overlay-subtle); }
  100% { box-shadow: 0 0 0 0 transparent; }
}

/* 筛选时未匹配的芯片淡化 */
.toggle-chip.is-filtered-out {
  opacity: 0.15;
  pointer-events: none;
  transition: opacity var(--duration-normal);
}
</style>
