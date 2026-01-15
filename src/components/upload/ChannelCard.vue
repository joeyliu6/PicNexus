<script setup lang="ts">
import { computed } from 'vue';
import type { ServiceType } from '../../config/types';
import { getServiceIcon } from '../../utils/icons';
import { SERVICE_DISPLAY_NAMES } from '../../constants/serviceNames';
import { isStatusSuccess, isStatusError, getStatusType, getStatusLabel } from '../../utils/uploadStatus';

interface Props {
  service: ServiceType;
  status?: string;
  link?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  copy: [link: string];
  retry: [];
}>();

const serviceName = computed(() => SERVICE_DISPLAY_NAMES[props.service]);
const serviceIcon = computed(() => getServiceIcon(props.service));
const statusType = computed(() => getStatusType(props.status));
const statusLabel = computed(() => getStatusLabel(props.status));

const cardClass = computed(() => ({
  error: isStatusError(props.status),
  success: isStatusSuccess(props.status),
}));

function handleCopy() {
  if (props.link) {
    emit('copy', props.link);
  }
}

function handleRetry() {
  emit('retry');
}
</script>

<template>
  <div class="channel-card" :class="cardClass">
    <div class="channel-icon" :class="{ 'has-svg': !!serviceIcon }">
      <span v-if="serviceIcon" class="icon-svg" v-html="serviceIcon"></span>
      <span v-else>{{ serviceName[0] }}</span>
    </div>

    <div class="channel-info">
      <span class="channel-name">{{ serviceName }}</span>
      <span class="status-label" :class="statusType">{{ statusLabel }}</span>
    </div>

    <button
      v-if="isStatusSuccess(status)"
      class="copy-btn"
      title="复制链接"
      @click="handleCopy"
    >
      <i class="pi pi-copy"></i>
    </button>
    <button
      v-else-if="isStatusError(status)"
      class="retry-btn"
      title="重试"
      @click="handleRetry"
    >
      <i class="pi pi-refresh"></i>
    </button>
  </div>
</template>

<style scoped>
.channel-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  transition: all 0.2s ease;
}

.channel-card:hover {
  border-color: rgba(59, 130, 246, 0.3);
}

.channel-card.error {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
}

.channel-card.success {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.3);
}

.channel-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 11px;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.channel-icon.has-svg {
  background: transparent;
  color: var(--text-primary);
}

.channel-icon .icon-svg {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.channel-icon .icon-svg :deep(svg) {
  width: 14px;
  height: 14px;
}

.channel-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.channel-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-label {
  font-size: 11px;
  color: var(--text-muted);
}

.status-label.success {
  color: var(--success);
}

.status-label.error {
  color: var(--error);
}

.status-label.uploading {
  color: var(--primary);
}

.copy-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: none;
  border: none;
  color: var(--success);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  opacity: 0.6;
}

.copy-btn:hover {
  background: var(--success-soft);
  opacity: 1;
}

.copy-btn i {
  font-size: 12px;
}

.retry-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: none;
  border: none;
  color: var(--error);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.retry-btn:hover {
  background: var(--error-soft);
}

.retry-btn i {
  font-size: 12px;
}
</style>
