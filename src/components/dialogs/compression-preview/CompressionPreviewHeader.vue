<script setup lang="ts">
interface Props {
  /** 是否显示文件名胶囊（对应 status === 'done' && result 的条件） */
  showFilename: boolean;
  /** 文件名，仅 showFilename=true 时使用 */
  fileName: string;
}

defineProps<Props>();
const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <div class="cpd-header">
    <div class="cpd-header-left">
      <span class="cpd-title">压缩预览</span>
      <span v-if="showFilename" class="cpd-filename" v-tooltip.top="fileName">{{ fileName }}</span>
    </div>
    <button class="cpd-close" @click="emit('close')" v-tooltip.bottom="'关闭 (Esc)'">
      <i class="pi pi-times" />
    </button>
  </div>
</template>

<style scoped>
.cpd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 0;
  flex-shrink: 0;
}

.cpd-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.cpd-title {
  font-size: var(--text-lg-xl);
  font-weight: 700;
  color: var(--text-primary);
  flex-shrink: 0;
}

.cpd-filename {
  font-size: var(--text-sm);
  color: var(--text-muted);
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 10px;
  background: var(--hover-overlay-subtle);
  border-radius: 4px;
  font-family: var(--font-mono);
}

.cpd-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--duration-fast);
  flex-shrink: 0;
}

.cpd-close:hover {
  background: var(--hover-overlay);
  color: var(--text-primary);
}
</style>
