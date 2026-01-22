<script setup lang="ts">
import { computed } from 'vue';

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
    <div class="breadcrumb-list">
      <template v-for="(item, index) in breadcrumbItems" :key="item.path">
        <button
          class="breadcrumb-item"
          :class="{ 'is-current': index === breadcrumbItems.length - 1 }"
          @click="emit('navigate', item.path)"
          :disabled="index === breadcrumbItems.length - 1"
        >
          <span class="item-label">{{ item.label }}</span>
        </button>
        <span
          v-if="index < breadcrumbItems.length - 1"
          class="separator"
        >/</span>
      </template>
    </div>
  </nav>
</template>

<style scoped>
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
}

.breadcrumb-list {
  display: flex;
  align-items: center;
  gap: 0;
  flex-wrap: wrap;
}

.breadcrumb-item {
  display: inline-flex;
  align-items: center;
  padding: 4px 2px;
  border: none;
  background: transparent;
  border-radius: 4px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s;
}

.breadcrumb-item:hover:not(.is-current) {
  color: var(--text-muted);
  background: var(--hover-overlay);
}

.breadcrumb-item.is-current {
  color: var(--text-primary);
  font-weight: 600;
  text-decoration: none;
  cursor: default;
}

.item-label {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.separator {
  font-size: 16px;
  color: var(--text-tertiary);
  margin: 0 4px;
}
</style>
