<script setup lang="ts">
import { getServiceDisplayName } from '../../../../constants/serviceNames';

defineProps<{
  services: { serviceId: string; count: number }[];
}>();

const emit = defineEmits<{
  (e: 'copy-service', serviceId: string): void;
}>();

function handleClick(serviceId: string): void {
  emit('copy-service', serviceId);
}
</script>

<template>
  <div class="fab-service-section">
    <p class="fab-service-label">按图床</p>
    <div class="fab-service-chips">
      <button
        v-for="svc in services"
        :key="svc.serviceId"
        class="service-chip"
        @click.stop="handleClick(svc.serviceId)"
      >
        <span class="service-chip__name">{{ getServiceDisplayName(svc.serviceId) }}</span>
        <span class="service-chip__count">{{ svc.count }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.fab-service-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  padding: 0 var(--space-xs-sm);
}

.fab-service-label {
  margin: 0;
  padding: 0 var(--space-sm);
  font-size: var(--text-2xs);
  color: var(--text-muted);
  opacity: 0.8;
  user-select: none;
  line-height: 1.6;
}

.fab-service-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  padding: 0 var(--space-2xs) var(--space-2xs);
}

.service-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-full);
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1;
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);
}

.service-chip:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-alpha-8);
}

.service-chip__name {
  white-space: nowrap;
}

.service-chip__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  padding: 0 var(--space-2xs);
  font-size: var(--text-2xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  background: var(--hover-overlay);
  border-radius: var(--radius-full);
  line-height: 1.6;
}

.service-chip:hover .service-chip__count {
  background: var(--primary-alpha-15);
  color: var(--primary);
}
</style>
