<script setup lang="ts">
import type { ServiceStatus, CloudServiceType, ConnectionStatus } from '../types';
import { getServiceIcon } from '../../../../utils/icons';

const props = defineProps<{
  services: ServiceStatus[];
  activeService: CloudServiceType;
  expanded?: boolean;
  isLoading?: boolean;
}>();

const emit = defineEmits<{
  change: [serviceId: CloudServiceType];
}>();

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

const getServiceSvg = (serviceId: string): string | null => {
  return getServiceIcon(serviceId as CloudServiceType) || null;
};
</script>

<template>
  <nav class="service-nav" :class="{ expanded }">
    <!-- 标题区域 -->
    <div class="nav-header">
      <i class="pi pi-cloud nav-icon"></i>
      <span class="nav-title">云存储</span>
    </div>

    <div class="service-list">
      <button
        v-for="service in services"
        :key="service.serviceId"
        class="service-item"
        :class="{
          active: service.serviceId === activeService,
          loading: service.serviceId === activeService && isLoading,
          [getStatusClass(service.status)]: true,
        }"
        @click="emit('change', service.serviceId)"
        :title="service.serviceName"
      >
        <!-- 加载中指示器 -->
        <svg
          v-if="service.serviceId === activeService && isLoading"
          class="loading-spinner"
          width="20"
          height="20"
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M6.99701 14C5.85441 13.999 4.72939 13.7186 3.72012 13.1832C2.71084 12.6478 1.84795 11.8737 1.20673 10.9284C0.565504 9.98305 0.165424 8.89526 0.041387 7.75989C-0.0826496 6.62453 0.073125 5.47607 0.495122 4.4147C0.917119 3.35333 1.59252 2.4113 2.46241 1.67077C3.33229 0.930247 4.37024 0.413729 5.4857 0.166275C6.60117 -0.0811796 7.76026 -0.0520535 8.86188 0.251112C9.9635 0.554278 10.9742 1.12227 11.8057 1.90555C11.915 2.01493 11.9764 2.16319 11.9764 2.31778C11.9764 2.47236 11.915 2.62062 11.8057 2.73C11.7521 2.78503 11.688 2.82877 11.6171 2.85864C11.5463 2.8885 11.4702 2.90389 11.3933 2.90389C11.3165 2.90389 11.2404 2.8885 11.1695 2.85864C11.0987 2.82877 11.0346 2.78503 10.9809 2.73C9.9998 1.81273 8.73246 1.26138 7.39226 1.16876C6.05206 1.07615 4.72086 1.44794 3.62279 2.22152C2.52471 2.99511 1.72683 4.12325 1.36345 5.41602C1.00008 6.70879 1.09342 8.08723 1.62775 9.31926C2.16209 10.5513 3.10478 11.5617 4.29713 12.1803C5.48947 12.7989 6.85865 12.988 8.17414 12.7157C9.48963 12.4435 10.6711 11.7264 11.5196 10.6854C12.3681 9.64432 12.8319 8.34282 12.8328 7C12.8328 6.84529 12.8943 6.69692 13.0038 6.58752C13.1132 6.47812 13.2616 6.41667 13.4164 6.41667C13.5712 6.41667 13.7196 6.47812 13.8291 6.58752C13.9385 6.69692 14 6.84529 14 7C14 8.85651 13.2622 10.637 11.9489 11.9497C10.6356 13.2625 8.85432 14 6.99701 14Z"
            fill="currentColor"
          />
        </svg>
        <span v-else class="service-icon-svg" v-html="getServiceSvg(service.serviceId)"></span>
        <span class="service-name">{{ service.serviceName }}</span>
        <span class="status-dot" :class="getStatusClass(service.status)"></span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.service-nav {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 6px;
}

.service-nav.expanded {
  padding: 12px 8px;
}

/* 标题区域 */
.nav-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--border-subtle);
}

.service-nav.expanded .nav-header {
  justify-content: flex-start;
  padding: 8px 12px;
}

.nav-icon {
  font-size: 18px;
  color: var(--primary);
  flex-shrink: 0;
}

.nav-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  opacity: 0;
  width: 0;
  white-space: nowrap;
  transition: opacity 0.2s ease;
}

.service-nav.expanded .nav-title {
  opacity: 1;
  width: auto;
}

.service-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.service-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
  width: 100%;
  position: relative;
}

.service-nav.expanded .service-item {
  justify-content: flex-start;
  padding: 10px 12px;
}

.service-item:hover {
  background: var(--hover-overlay);
  color: var(--text-primary);
}

.service-item.active {
  border-color: var(--primary);
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(59, 130, 246, 0.06) 100%);
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--primary), 0 0 20px rgba(59, 130, 246, 0.15);
}

.service-item.active .service-icon-svg {
  color: var(--primary);
}

.service-icon-svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: color 0.15s;
}

.service-icon-svg :deep(svg) {
  width: 100%;
  height: 100%;
}

.service-item:hover .service-icon-svg {
  color: var(--text-primary);
}

.service-name {
  flex: 1;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  width: 0;
  transition: opacity 0.2s ease;
}

.service-nav.expanded .service-name {
  opacity: 1;
  width: auto;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.2s;
}

.service-nav.expanded .status-dot {
  opacity: 1;
}

.status-dot.status-connected {
  background: var(--success);
  box-shadow: 0 0 8px var(--success);
  animation: pulse-green 2s infinite;
}

@keyframes pulse-green {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.status-dot.status-connecting {
  background: var(--warning);
}

.status-dot.status-error {
  background: var(--error);
}

.status-dot.status-unconfigured {
  background: var(--text-muted);
}

.status-dot.status-disconnected {
  background: var(--text-muted);
}

/* 加载指示器 - PrimeVue 风格 SVG */
.loading-spinner {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--primary);
  animation: spinner-spin 1s linear infinite;
}

@keyframes spinner-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.service-item.loading {
  pointer-events: none;
}

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
