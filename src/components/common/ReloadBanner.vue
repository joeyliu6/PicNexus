<script setup lang="ts">
import { UI_COPY } from '../../constants/uiCopy';

defineProps<{
  visible: boolean;
  message?: string;
}>();

const emit = defineEmits<{
  reload: [];
}>();

function handleReload(): void {
  emit('reload');
}
</script>

<template>
  <div v-if="visible" class="reload-banner" role="status">
    <i class="pi pi-info-circle reload-banner-icon"></i>
    <span class="reload-banner-text">{{ message || UI_COPY.banner.reload.defaultMessage }}</span>
    <button type="button" class="reload-banner-btn" @click="handleReload">
      <i class="pi pi-refresh"></i>
      <span>{{ UI_COPY.banner.reload.action }}</span>
    </button>
  </div>
</template>

<style scoped>
.reload-banner {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: var(--primary-alpha-8);
  border: 1px solid var(--primary-alpha-15);
  color: var(--text-main);
  font-size: var(--text-sm);
}

.reload-banner-icon {
  font-size: var(--text-base);
  color: var(--primary);
  flex-shrink: 0;
}

.reload-banner-text {
  flex: 1;
  color: var(--text-main);
}

.reload-banner-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-2xs) var(--space-sm);
  border-radius: var(--radius-sm-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  color: var(--text-main);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.reload-banner-btn:hover {
  background: var(--hover-overlay);
}
</style>
