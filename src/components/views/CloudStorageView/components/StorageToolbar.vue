<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Breadcrumb from './Breadcrumb.vue';
import type { StorageStats } from '../types';

const props = defineProps<{
  currentPath: string;
  bucketName?: string;
  stats: StorageStats | null;
  loading: boolean;
  searchQuery: string;
  selectedCount?: number;
}>();

const emit = defineEmits<{
  navigate: [path: string];
  refresh: [];
  upload: [];
  search: [query: string];
  delete: [];
  createFolder: [];
}>();

const localSearchQuery = ref(props.searchQuery);
const searchFocused = ref(false);

watch(
  () => props.searchQuery,
  (newVal) => {
    localSearchQuery.value = newVal;
  }
);

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

const handleSearchInput = () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    emit('search', localSearchQuery.value);
  }, 300);
};

onUnmounted(() => {
  if (searchTimeout) clearTimeout(searchTimeout);
});
</script>

<template>
  <div class="storage-toolbar">
    <!-- 左侧：面包屑导航 -->
    <div class="toolbar-left">
      <Breadcrumb
        :path="currentPath"
        :bucket-name="bucketName"
        @navigate="(path) => emit('navigate', path)"
      />
    </div>

    <!-- 右侧：操作区 -->
    <div class="toolbar-right">
      <!-- 搜索框 -->
      <div class="search-wrapper" :class="{ focused: searchFocused }">
        <i class="pi pi-search search-icon"></i>
        <InputText
          v-model="localSearchQuery"
          placeholder="搜索..."
          @input="handleSearchInput"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
          class="search-input"
        />
        <Button
          v-if="localSearchQuery"
          icon="pi pi-times"
          text
          rounded
          size="small"
          class="search-clear"
          @click="localSearchQuery = ''; emit('search', '')"
        />
      </div>

      <!-- 删除按钮（选中时显示） -->
      <Button
        v-if="selectedCount && selectedCount > 0"
        :label="`删除 ${selectedCount} 个文件`"
        icon="pi pi-trash"
        severity="danger"
        size="small"
        @click="emit('delete')"
      />

      <!-- 上传按钮 -->
      <Button
        label="上传"
        icon="pi pi-upload"
        text
        size="small"
        class="ghost-button"
        @click="emit('upload')"
      />

      <!-- 添加目录按钮 -->
      <Button
        label="添加目录"
        icon="pi pi-plus"
        text
        size="small"
        class="ghost-button"
        @click="emit('createFolder')"
      />

      <!-- 刷新按钮 -->
      <Button
        icon="pi pi-sync"
        outlined
        size="small"
        @click="emit('refresh')"
        :loading="loading"
      />
    </div>
  </div>
</template>

<style scoped>
.storage-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  min-height: 52px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 搜索框 */
.search-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-muted);
  font-size: 13px;
  pointer-events: none;
  transition: color 0.2s;
}

.search-wrapper.focused .search-icon {
  color: var(--primary);
}

.search-input {
  padding-left: 32px;
  padding-right: 28px;
  width: 140px;
  height: 34px;
  font-size: 13px;
  border-radius: 6px;
  background: var(--bg-secondary);
  border: 1px solid transparent;
  transition: all 0.2s;
}

.search-input:focus {
  width: 200px;
  background: var(--bg-card);
  border-color: var(--primary);
  box-shadow: var(--focus-ring-shadow);
}

.search-clear {
  position: absolute;
  right: 2px;
  width: 24px;
  height: 24px;
}

.search-clear :deep(.p-button-icon) {
  font-size: 12px;
}

/* 幽灵按钮样式 */
.ghost-button {
  background: transparent !important;
  border: 1px solid var(--border-subtle) !important;
  color: var(--text-muted) !important;
}

.ghost-button:hover {
  background: var(--hover-overlay) !important;
  border-color: var(--text-muted) !important;
  color: var(--text-primary) !important;
}
</style>
