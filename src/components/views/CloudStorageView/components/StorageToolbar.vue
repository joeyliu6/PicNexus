<script setup lang="ts">
import { ref, watch } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Breadcrumb from './Breadcrumb.vue';
import type { StorageStats, ViewMode } from '../types';

const props = defineProps<{
  /** 当前路径 */
  currentPath: string;
  /** 存储桶名称 */
  bucketName?: string;
  /** 统计信息 */
  stats: StorageStats | null;
  /** 是否加载中 */
  loading: boolean;
  /** 搜索关键词 */
  searchQuery: string;
  /** 视图模式 */
  viewMode: ViewMode;
}>();

const emit = defineEmits<{
  navigate: [path: string];
  refresh: [];
  upload: [];
  search: [query: string];
  'update:viewMode': [mode: ViewMode];
}>();

// 本地搜索值
const localSearchQuery = ref(props.searchQuery);

// 同步外部搜索值
watch(
  () => props.searchQuery,
  (newVal) => {
    localSearchQuery.value = newVal;
  }
);

// 搜索防抖
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

const handleSearchInput = () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    emit('search', localSearchQuery.value);
  }, 300);
};
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
      <div class="search-wrapper">
        <i class="pi pi-search search-icon"></i>
        <InputText
          v-model="localSearchQuery"
          placeholder="搜索文件..."
          @input="handleSearchInput"
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

      <!-- 视图切换按钮组 -->
      <div class="view-toggle">
        <Button
          icon="pi pi-th-large"
          :class="{ active: viewMode === 'grid' }"
          text
          size="small"
          @click="emit('update:viewMode', 'grid')"
          v-tooltip.top="'网格视图'"
        />
        <Button
          icon="pi pi-list"
          :class="{ active: viewMode === 'list' }"
          text
          size="small"
          @click="emit('update:viewMode', 'list')"
          v-tooltip.top="'列表视图'"
        />
        <Button
          icon="pi pi-table"
          :class="{ active: viewMode === 'table' }"
          text
          size="small"
          @click="emit('update:viewMode', 'table')"
          v-tooltip.top="'表格视图'"
        />
      </div>

      <!-- 刷新按钮 -->
      <Button
        icon="pi pi-refresh"
        @click="emit('refresh')"
        :loading="loading"
        text
        rounded
        size="small"
        v-tooltip.top="'刷新'"
        class="refresh-btn"
      />

      <!-- 上传按钮 -->
      <Button
        label="上传"
        icon="pi pi-upload"
        @click="emit('upload')"
        size="small"
        class="upload-btn"
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
  padding: 12px 24px;
  min-height: 56px;
  border-bottom: 1px solid var(--border-subtle);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 200px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 搜索框 */
.search-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 12px;
  color: var(--text-muted);
  font-size: 14px;
  pointer-events: none;
}

.search-input {
  padding-left: 36px;
  padding-right: 32px;
  width: 200px;
  border-radius: 20px;
  background: var(--bg-app);
  border: 1px solid var(--border-subtle);
  transition: all 0.2s;
}

.search-input:focus {
  width: 260px;
  background: var(--bg-card);
  border-color: var(--primary);
  box-shadow: var(--focus-ring-shadow);
}

.search-clear {
  position: absolute;
  right: 4px;
}

/* 视图切换按钮组 */
.view-toggle {
  display: flex;
  background: var(--bg-app);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
}

.view-toggle :deep(.p-button) {
  color: var(--text-muted);
  border-radius: 4px;
}

.view-toggle :deep(.p-button.active) {
  color: var(--primary);
  background: var(--bg-card);
}

.view-toggle :deep(.p-button:hover:not(.active)) {
  color: var(--text-primary);
  background: var(--hover-overlay-subtle);
}

/* 刷新按钮 */
.refresh-btn {
  color: var(--text-secondary);
}

.refresh-btn:hover {
  color: var(--primary);
  background: var(--hover-overlay);
}

/* 上传按钮 */
.upload-btn {
  font-weight: 500;
}
</style>
