<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import { getServiceDisplayName } from '../../../../constants/serviceNames';
import { getServiceIcon } from '../../../../utils/icons';

defineProps<{
  services: { serviceId: string; count: number }[];
}>();

const emit = defineEmits<{
  (e: 'copy-service', serviceId: string): void;
}>();

const copiedId = ref<string | null>(null);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

function handleClick(serviceId: string): void {
  emit('copy-service', serviceId);
  copiedId.value = serviceId;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copiedId.value = null;
    copyTimer = null;
  }, 1500);
}

onUnmounted(() => {
  if (copyTimer) clearTimeout(copyTimer);
});
</script>

<template>
  <div class="fab-service-section">
    <div class="fab-service-list">
      <button
        v-for="svc in services"
        :key="svc.serviceId"
        class="svc-row"
        :class="{ 'svc-row--copied': copiedId === svc.serviceId }"
        @click.stop="handleClick(svc.serviceId)"
      >
        <span class="svc-icon" aria-hidden="true" v-html="getServiceIcon(svc.serviceId)" />
        <span class="svc-name">{{ getServiceDisplayName(svc.serviceId) }}</span>
        <span class="svc-badge">{{ svc.count }}</span>
        <i
          class="pi svc-copy-icon"
          :class="copiedId === svc.serviceId ? 'pi-check' : 'pi-copy'"
          aria-hidden="true"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.fab-service-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  padding: var(--space-2xs) var(--space-sm) var(--space-2xs);
}

.fab-service-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.svc-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  height: 36px;
  padding: 0 var(--space-sm);
  border: none;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--text-sm);
  cursor: pointer;
  text-align: left;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.svc-row:hover {
  background: var(--hover-overlay);
}

.svc-row:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}

.svc-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-muted);
}

.svc-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.svc-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.svc-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 var(--space-2xs);
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  background: var(--hover-overlay);
  border-radius: var(--radius-full);
  flex-shrink: 0;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.svc-copy-icon {
  font-size: var(--text-xs);
  color: var(--text-muted);
  opacity: 0;
  flex-shrink: 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.svc-row:hover .svc-copy-icon {
  opacity: 1;
  color: var(--primary);
}

.svc-row:hover .svc-badge {
  background: var(--primary-alpha-15);
  color: var(--primary);
}

.svc-row--copied {
  background: var(--success-alpha-10);
}

.svc-row--copied .svc-copy-icon {
  opacity: 1;
  color: var(--success);
}

.svc-row--copied .svc-badge {
  background: var(--success-alpha-15, var(--success-alpha-10));
  color: var(--success);
}

.svc-row--copied:hover {
  background: var(--success-alpha-10);
}

.svc-row--copied:hover .svc-copy-icon {
  color: var(--success);
}

.svc-row--copied:hover .svc-badge {
  background: var(--success-alpha-15, var(--success-alpha-10));
  color: var(--success);
}
</style>
