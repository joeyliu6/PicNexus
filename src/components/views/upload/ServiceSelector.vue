<script setup lang="ts">
// 图床服务选择器组件

import { computed } from 'vue';
import EmptyState from '../../common/EmptyState.vue';
import type { ServiceHealthStatus } from '../../../types/serviceHealth';

// ==================== Props ====================

interface Props {
  publicServices: string[];
  privateServices: string[];
  serviceLabels: Record<string, string>;
  isServiceSelected: (id: string) => boolean;
  serviceHealthMap?: Record<string, ServiceHealthStatus>;
  serviceHealthTooltipMap?: Record<string, string>;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  toggle: [serviceId: string];
  'go-settings': [];
  'go-service-settings': [serviceId: string];
}>();

const hasServices = computed(() => props.publicServices.length > 0 || props.privateServices.length > 0);
const showAddEntryInPublic = computed(() => props.publicServices.length > 0);
const showAddEntryInPrivate = computed(() => props.publicServices.length === 0 && props.privateServices.length > 0);

// ==================== Methods ====================

function handleToggle(serviceId: string) {
  emit('toggle', serviceId);
}

function getServiceHealthStatus(serviceId: string): ServiceHealthStatus {
  return props.serviceHealthMap?.[serviceId] || 'unconfigured';
}

function canOpenServiceSettings(serviceId: string): boolean {
  return getServiceHealthStatus(serviceId) !== 'verified';
}

function getHealthTooltip(serviceId: string): string | null {
  const tooltip = props.serviceHealthTooltipMap?.[serviceId] || null;
  if (!canOpenServiceSettings(serviceId)) return tooltip;
  return tooltip ? `${tooltip}，点击前往设置` : '点击前往设置';
}

function getHealthAriaLabel(serviceId: string): string | undefined {
  if (!canOpenServiceSettings(serviceId)) return undefined;
  return `打开 ${props.serviceLabels[serviceId] || serviceId} 图床设置`;
}

function handleHealthDotClick(event: MouseEvent, serviceId: string) {
  if (!canOpenServiceSettings(serviceId)) return;
  event.preventDefault();
  event.stopPropagation();
  emit('go-service-settings', serviceId);
}
</script>

<template>
  <div class="upload-controls">
    <template v-if="hasServices">
      <!-- 公共图床 -->
      <div v-if="publicServices.length > 0" class="service-group">
        <div class="service-group-label">公共图床</div>
        <div class="service-tags-wrapper">
          <button
            v-for="serviceId in publicServices"
            :key="serviceId"
            class="service-tag"
            :class="{ 'is-selected': isServiceSelected(serviceId) }"
            @click="handleToggle(serviceId)"
            v-ripple
          >
            <span
              class="health-dot"
              :class="[getServiceHealthStatus(serviceId), { 'can-open-settings': canOpenServiceSettings(serviceId) }]"
              :aria-label="getHealthAriaLabel(serviceId)"
              v-tooltip.top="getHealthTooltip(serviceId)"
              @click="handleHealthDotClick($event, serviceId)"
            ></span>
            <span class="tag-text">{{ serviceLabels[serviceId] }}</span>
          </button>
          <button
            v-if="showAddEntryInPublic"
            type="button"
            class="service-tag add-service-tag"
            aria-label="新增图床"
            v-tooltip.top="'新增图床'"
            @click="emit('go-settings')"
            v-ripple
          >
            <i class="pi pi-plus" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <!-- 私有存储 -->
      <div v-if="privateServices.length > 0" class="service-group">
        <div class="service-group-label">私有存储</div>
        <div class="service-tags-wrapper">
          <button
            v-for="serviceId in privateServices"
            :key="serviceId"
            class="service-tag"
            :class="{ 'is-selected': isServiceSelected(serviceId) }"
            @click="handleToggle(serviceId)"
            v-ripple
          >
            <span
              class="health-dot"
              :class="[getServiceHealthStatus(serviceId), { 'can-open-settings': canOpenServiceSettings(serviceId) }]"
              :aria-label="getHealthAriaLabel(serviceId)"
              v-tooltip.top="getHealthTooltip(serviceId)"
              @click="handleHealthDotClick($event, serviceId)"
            ></span>
            <span class="tag-text">{{ serviceLabels[serviceId] }}</span>
          </button>
          <button
            v-if="showAddEntryInPrivate"
            type="button"
            class="service-tag add-service-tag"
            aria-label="新增图床"
            v-tooltip.top="'新增图床'"
            @click="emit('go-settings')"
            v-ripple
          >
            <i class="pi pi-plus" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </template>

    <!-- 空状态引导 -->
    <EmptyState v-else icon="pi pi-cog" title="暂无可用图床">
      <button class="empty-state-link" @click="emit('go-settings')">前往设置配置</button>
    </EmptyState>
  </div>
</template>

<style scoped>
/* 图床选择区域 */
.upload-controls {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-lg) var(--space-xl) var(--space-lg-xl);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.service-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.service-group-label {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.service-tags-wrapper {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm-md);
}

.service-tag {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  height: 36px;
  padding: 0 var(--space-lg);
  background-color: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
  color: var(--text-secondary);
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all var(--duration-fast) ease-in-out;
  user-select: none;
}

/* 悬停效果（排除选中状态） */
.service-tag:hover:not(:disabled, .is-selected, .add-service-tag) {
  background-color: var(--hover-overlay-subtle);
  border-color: var(--primary);
  color: var(--text-primary);
}

/* 选中状态（固定样式，悬浮时不变） */
.service-tag.is-selected {
  background-color: var(--primary-alpha-10);
  border-color: var(--primary);
  color: var(--primary);
  font-weight: var(--weight-semibold);
}

.add-service-tag {
  width: 36px;
  padding: 0;
  justify-content: center;
  border-style: dashed;
  color: var(--text-muted);
  background-color: transparent;
  opacity: 0.62;
}

.add-service-tag .pi {
  font-size: var(--text-base);
  line-height: 1;
}

.add-service-tag:hover {
  border-color: var(--primary);
  color: var(--primary);
  background-color: var(--primary-alpha-8);
  opacity: 1;
}

/* 图床健康状态圆点 */
.health-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-muted);
  box-shadow: 0 0 0 1px var(--border-subtle);
  transition: transform var(--duration-fast) ease, box-shadow var(--duration-fast) ease;
}

.health-dot.can-open-settings {
  cursor: pointer;
}

.health-dot.can-open-settings:hover {
  transform: scale(1.25);
  box-shadow: 0 0 0 3px var(--primary-alpha-15);
}

.health-dot.pending {
  background: var(--warning);
}

.health-dot.verified {
  background: var(--success);
}

.health-dot.error {
  background: var(--error);
}

/* 空状态引导 */
.empty-state-link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: inherit;
  color: var(--primary);
  cursor: pointer;
  transition: color var(--duration-normal) ease;
}

.empty-state-link:hover {
  color: var(--primary-hover, #3b82f6);
  text-decoration: underline;
}
</style>
