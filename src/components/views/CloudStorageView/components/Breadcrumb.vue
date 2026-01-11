<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';

const props = defineProps<{
  /** 当前路径 */
  path: string;
  /** 存储桶名称 */
  bucketName?: string;
}>();

const emit = defineEmits<{
  navigate: [path: string];
}>();

// 解析路径为面包屑项
const breadcrumbItems = computed(() => {
  const items: Array<{ label: string; path: string }> = [
    { label: props.bucketName || '根目录', path: '' },
  ];

  if (!props.path) return items;

  const parts = props.path.split('/').filter(Boolean);
  let currentPath = '';

  for (const part of parts) {
    currentPath += part + '/';
    items.push({ label: part, path: currentPath });
  }

  return items;
});
</script>

<template>
  <nav class="breadcrumb">
    <template v-for="(item, index) in breadcrumbItems" :key="item.path">
      <Button
        :label="item.label"
        :class="{ 'current-item': index === breadcrumbItems.length - 1 }"
        text
        size="small"
        @click="emit('navigate', item.path)"
      />
      <i
        v-if="index < breadcrumbItems.length - 1"
        class="pi pi-chevron-right separator"
      ></i>
    </template>
  </nav>
</template>

<style scoped>
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.breadcrumb :deep(.p-button) {
  padding: 4px 8px;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.breadcrumb :deep(.p-button:hover) {
  color: var(--primary);
  background: rgba(59, 130, 246, 0.1);
}

.breadcrumb :deep(.p-button.current-item) {
  color: var(--text-primary);
  font-weight: 500;
  pointer-events: none;
}

.separator {
  font-size: 0.75rem;
  color: var(--text-muted);
}
</style>
