<script setup lang="ts">
import { computed, ref } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { useConfigManager } from '../../composables/useConfig';
import { LINK_FORMAT_OPTIONS, type LinkFormat } from '../../utils/linkFormatter';
import { getServiceIcon } from '../../utils/icons';
import { getServiceDisplayName } from '../../constants/serviceNames';
import { isStatusSuccess, isStatusError, getStatusType, getStatusLabel } from '../../utils/uploadStatus';
import { buildUploadFailureTooltip } from '../../utils/uploadFailureMessage';

export interface ChannelCopyPayload {
  url: string;
  serviceId: string;
  fileName: string;
  format?: LinkFormat;
}

interface Props {
  service: string;
  status?: string;
  link?: string;
  error?: string;
  fileName: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  copy: [payload: ChannelCopyPayload];
  retry: [];
}>();

const configManager = useConfigManager();

const serviceName = computed(() => getServiceDisplayName(props.service));
const serviceIcon = computed(() => getServiceIcon(props.service));
const statusType = computed(() => getStatusType(props.status));
const statusLabel = computed(() => getStatusLabel(props.status));
const errorTooltip = computed(() => {
  if (!isStatusError(props.status)) return '';
  return buildUploadFailureTooltip(serviceName.value, props.error, [props.service]);
});

const cardClass = computed(() => ({
  error: isStatusError(props.status),
  success: isStatusSuccess(props.status),
}));

const menuVisible = ref(false);
const menuRef = ref<HTMLElement | null>(null);

const formatOptions = computed(() => {
  const hasCustomTemplate = !!configManager.config.value.linkOutput?.customTemplate;
  return LINK_FORMAT_OPTIONS.filter(opt => opt.format !== 'custom' || hasCustomTemplate);
});

onClickOutside(menuRef, () => {
  menuVisible.value = false;
});

function emitCopy(format?: LinkFormat) {
  if (!props.link) return;
  emit('copy', {
    url: props.link,
    serviceId: props.service,
    fileName: props.fileName,
    format,
  });
}

function handleCopy() {
  emitCopy();
}

function toggleMenu() {
  menuVisible.value = !menuVisible.value;
}

function handleFormatCopy(format: LinkFormat) {
  menuVisible.value = false;
  emitCopy(format);
}

function handleRetry() {
  emit('retry');
}
</script>

<template>
  <div
    class="channel-card"
    :class="cardClass"
    v-tooltip.top="errorTooltip || null"
  >
    <div class="channel-icon" :class="{ 'has-svg': !!serviceIcon }">
      <span v-if="serviceIcon" class="icon-svg" v-html="serviceIcon"></span>
      <span v-else>{{ serviceName[0] }}</span>
    </div>

    <div class="channel-info">
      <span class="channel-name">{{ serviceName }}</span>
      <span class="status-label" :class="statusType">{{ statusLabel }}</span>
    </div>

    <div
      v-if="isStatusSuccess(status) && link"
      ref="menuRef"
      class="copy-actions"
    >
      <button
        class="copy-btn"
        v-tooltip.top="'复制链接'"
        @click="handleCopy"
      >
        <i class="pi pi-copy"></i>
      </button>
      <button
        class="copy-menu-btn"
        v-tooltip.top="'选择复制格式'"
        @click.stop="toggleMenu"
      >
        <i class="pi pi-angle-down"></i>
      </button>

      <Transition name="copy-menu">
        <div v-if="menuVisible" class="copy-format-menu">
          <button
            v-for="opt in formatOptions"
            :key="opt.format"
            class="format-item"
            @click="handleFormatCopy(opt.format)"
          >
            <i :class="'pi ' + opt.icon"></i>
            <span>{{ opt.label }}</span>
          </button>
        </div>
      </Transition>
    </div>

    <button
      v-else-if="isStatusError(status)"
      class="retry-btn"
      v-tooltip.top="'重试'"
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
  transition: all var(--duration-normal) ease;
}

.channel-card:hover {
  border-color: var(--primary-alpha-30);
}

.channel-card.error {
  background: var(--error-alpha-8);
  border-color: var(--error-border);
}

.channel-card.success {
  background: var(--success-alpha-8);
  border-color: var(--success-border);
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
  font-size: var(--text-2xs-xs);
  flex-shrink: 0;
  transition: all var(--duration-normal) ease;
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
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-label {
  font-size: var(--text-2xs-xs);
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

.copy-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
}

.copy-btn,
.copy-menu-btn,
.retry-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-normal) ease;
}

.copy-btn {
  color: var(--success);
  opacity: 0.7;
}

.copy-menu-btn {
  color: var(--success);
  opacity: 0.75;
  border-left: 1px solid var(--success-soft);
  margin-left: 2px;
  padding: 3px 4px;
}

.retry-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  color: var(--error);
}

.copy-btn:hover,
.copy-menu-btn:hover {
  background: var(--success-soft);
  opacity: 1;
}

.retry-btn:hover {
  background: var(--error-soft);
}

.copy-btn i,
.copy-menu-btn i,
.retry-btn i {
  font-size: var(--text-xs);
}

.copy-menu-btn i {
  font-size: var(--text-2xs-xs);
}

.copy-format-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  box-shadow: var(--shadow-float);
  padding: 4px;
  min-width: 120px;
  z-index: var(--z-modal);
}

.format-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-xs);
  border-radius: 6px;
  cursor: pointer;
  transition: all var(--duration-fast) ease;
  text-align: left;
}

.format-item:hover {
  background: var(--hover-overlay);
  color: var(--primary);
}

.format-item i {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  width: 14px;
  text-align: center;
}

.format-item:hover i {
  color: var(--primary);
}

.copy-menu-enter-active,
.copy-menu-leave-active {
  transition: all var(--duration-fast) ease;
}

.copy-menu-enter-from,
.copy-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
