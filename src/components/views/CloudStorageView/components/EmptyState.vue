<script setup lang="ts">
import Button from 'primevue/button';
import { getIllustration } from '../../../../utils/icons';

defineProps<{
  title: string;
  description?: string;
  variant: 'empty' | 'search';
  searchQuery?: string;
}>();

const emit = defineEmits<{
  upload: [];
  createFolder: [];
  clearSearch: [];
}>();
</script>

<template>
  <div class="empty-state">
    <!-- 搜索无结果 -->
    <template v-if="variant === 'search'">
      <div class="empty-search-icon">
        <i class="pi pi-search"></i>
      </div>
      <h3 class="empty-title">未找到包含「{{ searchQuery }}」的文件</h3>
      <p class="empty-desc">试试其他关键词，或清除搜索条件查看全部文件</p>
      <div class="empty-actions">
        <Button
          label="清除搜索"
          icon="pi pi-times"
          severity="secondary"
          size="small"
          @click="emit('clearSearch')"
        />
      </div>
    </template>

    <!-- 空目录 -->
    <template v-else>
      <div class="empty-illustration" v-html="getIllustration('cloud-upload')"></div>
      <h3 class="empty-title">{{ title }}</h3>
      <p v-if="description" class="empty-desc">{{ description }}</p>
      <div class="empty-actions">
        <Button
          label="上传文件"
          icon="pi pi-upload"
          size="small"
          @click="emit('upload')"
        />
        <Button
          label="添加目录"
          icon="pi pi-folder-plus"
          severity="secondary"
          size="small"
          @click="emit('createFolder')"
        />
      </div>
      <p class="empty-drag-hint">也可以直接拖拽文件到此处上传</p>
    </template>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  height: 100%;
  min-height: 400px;
}

.empty-illustration {
  width: 180px;
  height: 140px;
  color: var(--primary);
  opacity: 0.9;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

.empty-illustration :deep(svg) {
  width: 100%;
  height: 100%;
}

.empty-search-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle-light);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}

.empty-search-icon .pi {
  font-size: 1.5rem;
  color: var(--text-muted);
}

.empty-title {
  margin: 0 0 8px;
  font-size: 1.25rem;
  font-weight: 500;
  color: var(--text-muted);
}

.empty-desc {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--text-muted);
  opacity: 0.7;
}

.empty-actions {
  display: flex;
  gap: 10px;
  margin-bottom: 8px;
}

.empty-drag-hint {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  opacity: 0.5;
}
</style>
