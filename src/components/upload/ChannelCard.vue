<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
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
  copied?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  copied: false,
});

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
  'channel-card--copied': props.copied,
}));

const menuVisible = ref(false);
const actionsRef = ref<HTMLElement | null>(null);
const teleportedMenuRef = ref<HTMLElement | null>(null);
const menuPosition = ref<{ top?: number; bottom?: number; right: number; openUpward: boolean }>({ right: 0, openUpward: false });

const formatOptions = computed(() => {
  const hasCustomTemplate = !!configManager.config.value.linkOutput?.customTemplate;
  return LINK_FORMAT_OPTIONS.filter(opt => opt.format !== 'custom' || hasCustomTemplate);
});

onClickOutside(actionsRef, () => {
  menuVisible.value = false;
}, { ignore: [teleportedMenuRef] });

function closeMenu() {
  menuVisible.value = false;
}

watch(menuVisible, (visible) => {
  if (visible) {
    window.addEventListener('scroll', closeMenu, true);
  } else {
    window.removeEventListener('scroll', closeMenu, true);
  }
});

onUnmounted(() => {
  window.removeEventListener('scroll', closeMenu, true);
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
  if (!menuVisible.value && actionsRef.value) {
    const rect = actionsRef.value.getBoundingClientRect();
    const estimatedHeight = formatOptions.value.length * 36 + 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < estimatedHeight + 8;
    menuPosition.value = openUpward
      ? { bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right, openUpward: true }
      : { top: rect.bottom + 4, right: window.innerWidth - rect.right, openUpward: false };
  }
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
      ref="actionsRef"
      class="copy-actions"
    >
      <button
        class="copy-btn"
        :class="{ 'copy-btn--copied': copied }"
        v-tooltip.top="copied ? '已复制' : '复制链接'"
        @click="handleCopy"
      >
        <i class="pi" :class="copied ? 'pi-check' : 'pi-copy'"></i>
      </button>
      <button
        class="copy-menu-btn"
        v-tooltip.top="'选择复制格式'"
        @click.stop="toggleMenu"
      >
        <i class="pi pi-angle-down"></i>
      </button>
    </div>

    <Teleport to="body">
      <Transition name="copy-menu">
        <div
          v-if="menuVisible"
          ref="teleportedMenuRef"
          class="copy-format-menu"
          :class="{ 'open-upward': menuPosition.openUpward }"
          :style="{
            top: menuPosition.top !== undefined ? menuPosition.top + 'px' : 'auto',
            bottom: menuPosition.bottom !== undefined ? menuPosition.bottom + 'px' : 'auto',
            right: menuPosition.right + 'px',
          }"
        >
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
    </Teleport>

    <button
      v-if="isStatusError(status)"
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
  gap: var(--space-sm);
  padding: var(--space-sm);
  border-radius: var(--radius-md);
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

.channel-card--copied,
.channel-card.success.channel-card--copied {
  background: var(--state-success-bg);
  border-color: var(--success);
}

.channel-icon {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm-md);
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  font-weight: var(--weight-semibold);
  font-size: var(--text-xs);
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
  gap: var(--space-2xs);
}

.channel-name {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-label {
  font-size: var(--text-xs);
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
  padding: var(--space-2xs);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-normal) ease;
}

.copy-btn {
  color: var(--success);
  opacity: 0.7;
}

.copy-btn--copied {
  color: var(--state-success-text);
  opacity: 1;
  background: var(--success-alpha-15);
}

.copy-menu-btn {
  color: var(--success);
  opacity: 0.75;
  border-left: 1px solid var(--success-soft);
  margin-left: var(--space-2xs);
  padding: var(--space-2xs) var(--space-xs);
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

.copy-btn--copied:hover {
  background: var(--success-alpha-15);
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
  font-size: var(--text-xs);
}

.copy-format-menu {
  position: fixed;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-float);
  padding: var(--space-xs);
  min-width: 120px;
  z-index: var(--z-modal);
}

.format-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-xs);
  border-radius: var(--radius-sm-md);
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

.open-upward.copy-menu-enter-from,
.open-upward.copy-menu-leave-to {
  transform: translateY(4px);
}
</style>
