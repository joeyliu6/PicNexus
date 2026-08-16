<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { useConfigManager } from '../../composables/useConfig';
import { LINK_FORMAT_OPTIONS, type LinkFormat } from '../../utils/linkFormatter';
import { getServiceDisplayName } from '../../constants/serviceNames';
import { isStatusSuccess, isStatusError, getStatusType, getStatusLabel } from '../../utils/uploadStatus';
import { buildUploadFailureTooltip } from '../../utils/uploadFailureMessage';
import { serviceNameTooltip } from '../../utils/serviceNameFit';
import ServiceLogo from '../common/ServiceLogo.vue';

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
const statusType = computed(() => getStatusType(props.status));
const statusLabel = computed(() => getStatusLabel(props.status));
const errorTooltip = computed(() => {
  if (!isStatusError(props.status)) return '';
  return buildUploadFailureTooltip(serviceName.value, props.error, [props.service]);
});

/**
 * 名字被截断时看全名的入口。
 *
 * 只在名字放不下时才给：短名字卡片上已经完整显示，弹一个一模一样的气泡是噪音。
 * 失败态返回 null 让位给根节点的 errorTooltip——那条文案本身就以服务名开头，
 * 全名照样可见。两者互斥，避免父子 tooltip 同时弹出两个气泡。
 */
const nameTooltip = computed(() => {
  if (isStatusError(props.status)) return null;
  return serviceNameTooltip(serviceName.value) ?? null;
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
    <ServiceLogo :service-id="service" class="channel-icon" />

    <div class="channel-info">
      <span class="channel-name" v-tooltip.top="nameTooltip">{{ serviceName }}</span>
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
  width: 14px;
  height: 14px;
  color: var(--text-primary);
  font-size: var(--text-sm);
  transition: color var(--duration-normal) ease;
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

/* 流内布局：绝对定位时 .channel-name 的 ellipsis 算不到按钮宽度，
   长图床名会直接钻到复制/重试按钮下面重叠。改成 flex 项后
   .channel-info(flex:1; min-width:0) 自动让位，省略号落在按钮左侧。
   align-self 顶到首行，保持原来「贴右上角」的观感——卡片是 align-items:center，
   不指定的话按钮会垂直居中到两行文字中间。 */
.copy-actions {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  flex-shrink: 0;
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
  align-self: flex-start;
  flex-shrink: 0;
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
