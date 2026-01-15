<script setup lang="ts">
import type { ServiceStatus, CloudServiceType, ConnectionStatus } from '../types';
import { getServiceIcon } from '../../../../utils/serviceIcons';

const props = defineProps<{
  /** 服务状态列表 */
  services: ServiceStatus[];
  /** 当前激活的服务 */
  activeService: CloudServiceType;
}>();

const emit = defineEmits<{
  change: [serviceId: CloudServiceType];
}>();

// 获取状态图标
const getStatusIcon = (status: ConnectionStatus): string => {
  switch (status) {
    case 'connected':
      return 'pi-check-circle';
    case 'connecting':
      return 'pi-spin pi-spinner';
    case 'error':
      return 'pi-exclamation-circle';
    case 'unconfigured':
      return 'pi-minus-circle';
    default:
      return 'pi-circle';
  }
};

// 获取状态颜色类
const getStatusClass = (status: ConnectionStatus): string => {
  switch (status) {
    case 'connected':
      return 'status-connected';
    case 'connecting':
      return 'status-connecting';
    case 'error':
      return 'status-error';
    case 'unconfigured':
      return 'status-unconfigured';
    default:
      return 'status-disconnected';
  }
};

// 获取服务 SVG 图标
const getServiceSvg = (serviceId: string): string | null => {
  return getServiceIcon(serviceId as CloudServiceType) || null;
};
</script>

<template>
  <nav class="service-nav">
    <div class="nav-section-title">存储服务</div>
    <div class="service-list">
      <button
        v-for="service in services"
        :key="service.serviceId"
        class="service-item"
        :class="{
          active: service.serviceId === activeService,
          [getStatusClass(service.status)]: true,
        }"
        @click="emit('change', service.serviceId)"
        :title="service.error || service.serviceName"
      >
        <span class="service-icon-svg" v-html="getServiceSvg(service.serviceId)"></span>
        <span class="service-name">{{ service.serviceName }}</span>
        <i :class="`pi ${getStatusIcon(service.status)}`" class="status-indicator"></i>
      </button>
    </div>
  </nav>
</template>

<style scoped>
/* 侧边栏导航 */
.service-nav {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 16px;
}

.nav-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  padding: 8px 12px 12px;
}

.service-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.service-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
  width: 100%;
}

.service-item:hover {
  background: var(--hover-overlay);
  color: var(--text-primary);
}

.service-item.active {
  background: var(--selected-bg);
  color: var(--primary);
}

.service-icon-svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.service-icon-svg :deep(svg) {
  width: 100%;
  height: 100%;
}

.service-item:hover .service-icon-svg {
  color: var(--text-primary);
}

.service-item.active .service-icon-svg {
  color: var(--primary);
}

.service-name {
  flex: 1;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-indicator {
  font-size: 10px;
  flex-shrink: 0;
}

/* 状态颜色 */
.service-item.status-connected .status-indicator {
  color: var(--success);
}

.service-item.status-connecting .status-indicator {
  color: var(--warning);
}

.service-item.status-error .status-indicator {
  color: var(--error);
}

.service-item.status-unconfigured .status-indicator {
  color: var(--text-muted);
}

.service-item.status-disconnected .status-indicator {
  color: var(--text-muted);
}

/* 滚动条样式 */
.service-nav::-webkit-scrollbar {
  width: 4px;
}

.service-nav::-webkit-scrollbar-track {
  background: transparent;
}

.service-nav::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 2px;
}

.service-nav::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}
</style>
