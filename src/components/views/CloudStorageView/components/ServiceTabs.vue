<script setup lang="ts">
import { computed } from 'vue';
import type { ServiceStatus, CloudServiceType, ConnectionStatus } from '../types';

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

// 获取服务图标
const getServiceIcon = (serviceId: string): string => {
  switch (serviceId) {
    case 'r2':
      return 'pi-cloud';
    case 'cos':
      return 'pi-server';
    case 'oss':
      return 'pi-database';
    case 'qiniu':
      return 'pi-box';
    case 'upyun':
      return 'pi-globe';
    default:
      return 'pi-cloud';
  }
};
</script>

<template>
  <div class="service-tabs">
    <button
      v-for="service in services"
      :key="service.serviceId"
      class="service-tab"
      :class="{
        active: service.serviceId === activeService,
        [getStatusClass(service.status)]: true,
      }"
      @click="emit('change', service.serviceId)"
      :title="service.error || service.serviceName"
    >
      <i :class="`pi ${getServiceIcon(service.serviceId)}`" class="service-icon"></i>
      <span class="service-name">{{ service.serviceName }}</span>
      <i :class="`pi ${getStatusIcon(service.status)}`" class="status-icon"></i>
    </button>
  </div>
</template>

<style scoped>
.service-tabs {
  display: flex;
  gap: 8px;
  padding: 0 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.service-tabs::-webkit-scrollbar {
  display: none;
}

.service-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  flex-shrink: 0;
}

.service-tab:hover {
  background: var(--bg-app);
  color: var(--text-primary);
}

.service-tab.active {
  background: var(--primary);
  border-color: var(--primary);
  color: white;
}

.service-icon {
  font-size: 1rem;
}

.service-name {
  font-weight: 500;
}

.status-icon {
  font-size: 0.75rem;
  margin-left: 4px;
}

/* 状态颜色 */
.service-tab.status-connected .status-icon {
  color: var(--success);
}

.service-tab.active.status-connected .status-icon {
  color: rgba(255, 255, 255, 0.9);
}

.service-tab.status-connecting .status-icon {
  color: var(--warning);
}

.service-tab.status-error .status-icon {
  color: var(--error);
}

.service-tab.status-unconfigured .status-icon {
  color: var(--text-muted);
}

.service-tab.status-disconnected .status-icon {
  color: var(--text-muted);
}
</style>
