<script setup lang="ts">
// 图床服务选择器组件

import { computed } from 'vue';
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
}>();

const hasServices = computed(() => props.publicServices.length > 0 || props.privateServices.length > 0);

// ==================== Methods ====================

function handleToggle(serviceId: string) {
  emit('toggle', serviceId);
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
            <span class="health-dot" :class="serviceHealthMap?.[serviceId] || 'unconfigured'" v-tooltip.top="serviceHealthTooltipMap?.[serviceId] || null"></span>
            <span class="tag-text">{{ serviceLabels[serviceId] }}</span>
          </button>
        </div>
      </div>

      <!-- 私有图床 -->
      <div v-if="privateServices.length > 0" class="service-group">
        <div class="service-group-label">私有图床</div>
        <div class="service-tags-wrapper">
          <button
            v-for="serviceId in privateServices"
            :key="serviceId"
            class="service-tag"
            :class="{ 'is-selected': isServiceSelected(serviceId) }"
            @click="handleToggle(serviceId)"
            v-ripple
          >
            <span class="health-dot" :class="serviceHealthMap?.[serviceId] || 'unconfigured'" v-tooltip.top="serviceHealthTooltipMap?.[serviceId] || null"></span>
            <span class="tag-text">{{ serviceLabels[serviceId] }}</span>
          </button>
        </div>
      </div>
    </template>

    <!-- 空状态引导 -->
    <div v-else class="empty-state">
      <span class="empty-state-text">暂无可用图床，<button class="empty-state-link" @click="emit('go-settings')">前往设置配置</button></span>
    </div>
  </div>
</template>

<style scoped>
/* 图床选择区域 */
.upload-controls {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 16px 24px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.service-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.service-group-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.service-tags-wrapper {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.service-tag {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;

  height: 36px;
  padding: 0 16px;

  background-color: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;

  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  font-family: var(--font-sans);

  cursor: pointer;
  transition: all 0.15s ease-in-out;
  user-select: none;
}

/* 悬停效果（排除选中状态） */
.service-tag:hover:not(:disabled):not(.is-selected) {
  background-color: var(--hover-overlay-subtle);
  border-color: var(--text-muted);
}

/* 选中状态（固定样式，悬浮时不变） */
.service-tag.is-selected {
  background-color: color-mix(in srgb, var(--primary) 10%, transparent);
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
}

/* 图床健康状态圆点 */
.health-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-muted);
  box-shadow: 0 0 0 1px var(--border-subtle);
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
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 0;
}

.empty-state-text {
  font-size: 0.95rem;
  color: var(--text-secondary);
}

.empty-state-link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: inherit;
  color: var(--primary);
  cursor: pointer;
  transition: color 0.2s ease;
}

.empty-state-link:hover {
  color: var(--primary-hover, #3b82f6);
  text-decoration: underline;
}
</style>
