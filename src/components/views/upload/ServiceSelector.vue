<script setup lang="ts">
// 图床服务选择器组件

import type { ServiceType } from '../../../config/types';

// ==================== Props ====================

interface Props {
  publicServices: ServiceType[];
  privateServices: ServiceType[];
  serviceLabels: Record<ServiceType, string>;
  serviceConfigStatus: Record<ServiceType, boolean>;
  isServiceSelected: (id: ServiceType) => boolean;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  toggle: [serviceId: ServiceType];
}>();

// ==================== Methods ====================

function handleToggle(serviceId: ServiceType) {
  emit('toggle', serviceId);
}
</script>

<template>
  <div class="upload-controls">
    <!-- 公共图床 -->
    <div v-if="publicServices.length > 0" class="service-group">
      <div class="service-group-label">公共图床</div>
      <div class="service-tags-wrapper">
        <button
          v-for="serviceId in publicServices"
          :key="serviceId"
          class="service-tag"
          :class="{
            'is-selected': isServiceSelected(serviceId),
            'is-configured': serviceConfigStatus[serviceId],
            'not-configured': !serviceConfigStatus[serviceId]
          }"
          @click="handleToggle(serviceId)"
          v-ripple
          v-tooltip.top="!serviceConfigStatus[serviceId] ? '请先在设置中配置' : ''"
        >
          <span class="status-dot"></span>
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
          :class="{
            'is-selected': isServiceSelected(serviceId),
            'is-configured': serviceConfigStatus[serviceId],
            'not-configured': !serviceConfigStatus[serviceId]
          }"
          @click="handleToggle(serviceId)"
          v-ripple
          v-tooltip.top="!serviceConfigStatus[serviceId] ? '请先在设置中配置' : ''"
        >
          <span class="status-dot"></span>
          <span class="tag-text">{{ serviceLabels[serviceId] }}</span>
        </button>
      </div>
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

/* 悬停效果（排除选中和未配置状态） */
.service-tag:hover:not(:disabled):not(.is-selected):not(.not-configured) {
  background-color: var(--hover-overlay-subtle);
  border-color: var(--text-muted);
}

/* 选中状态（固定样式，悬浮时不变） */
.service-tag.is-selected {
  background-color: rgba(59, 130, 246, 0.1);
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
}

/* 状态点 */
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--border-subtle);
}

/* 已配置（绿点） */
.service-tag.is-configured .status-dot {
  background-color: var(--success);
  box-shadow: 0 0 4px rgba(16, 185, 129, 0.4);
}

/* 未配置（黄点） */
.service-tag.not-configured .status-dot {
  background-color: var(--warning);
}

/* 未配置态（禁用） */
.service-tag.not-configured {
  opacity: 0.65;
  cursor: not-allowed;
}

.service-tag.not-configured:hover {
  background-color: var(--bg-input);
  border-color: var(--border-subtle);
}
</style>
