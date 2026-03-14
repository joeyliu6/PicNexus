<script setup lang="ts">
import Button from 'primevue/button';

interface LoadingState {
  export: boolean;
  import: boolean;
}

interface Props {
  type: 'config' | 'history';
  loading: LoadingState;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'export-local': [];
  'import-local': [];
}>();

const itemConfig = {
  config: {
    title: '配置文件',
    icon: 'pi pi-cog',
    description: '包含图床密钥、Cookie 及偏好设置'
  },
  history: {
    title: '上传记录',
    icon: 'pi pi-history',
    description: '历史上传文件和 URL 记录'
  }
};
</script>

<template>
  <div class="sync-item-row">
    <div class="item-left">
      <div class="item-icon">
        <i :class="itemConfig[props.type].icon"></i>
      </div>
      <div class="item-info">
        <div class="item-title">{{ itemConfig[props.type].title }}</div>
        <div class="item-desc">{{ itemConfig[props.type].description }}</div>
      </div>
    </div>

    <div class="item-right">
      <div class="item-actions">
        <Button
          @click="emit('export-local')"
          :loading="loading.export"
          label="导出"
          icon="pi pi-download"
          outlined
          size="small"
        />
        <Button
          @click="emit('import-local')"
          :loading="loading.import"
          label="导入"
          icon="pi pi-upload"
          outlined
          size="small"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sync-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
  gap: 16px;
  transition: background-color 0.15s;
  margin: 0 -16px;
  padding-left: 16px;
  padding-right: 16px;
}

.sync-item-row:hover {
  background: var(--primary-hover-bg);
}

.item-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.item-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-hover-bg);
  border-radius: 8px;
  color: var(--primary);
  flex-shrink: 0;
}

.item-icon i {
  font-size: 18px;
}

.item-info {
  min-width: 0;
}

.item-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.item-desc {
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
