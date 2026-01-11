<script setup lang="ts">
import Button from 'primevue/button';

defineProps<{
  /** 图标 */
  icon?: string;
  /** 标题 */
  title: string;
  /** 描述 */
  description?: string;
  /** 操作按钮文本 */
  actionLabel?: string;
  /** 操作按钮图标 */
  actionIcon?: string;
}>();

const emit = defineEmits<{
  action: [];
}>();
</script>

<template>
  <div class="empty-state">
    <i :class="`pi ${icon || 'pi-inbox'}`" class="empty-icon"></i>
    <h3 class="empty-title">{{ title }}</h3>
    <p v-if="description" class="empty-description">{{ description }}</p>
    <Button
      v-if="actionLabel"
      :label="actionLabel"
      :icon="actionIcon ? `pi ${actionIcon}` : undefined"
      @click="emit('action')"
      outlined
      class="empty-action"
    />
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
}

.empty-icon {
  font-size: 4rem;
  color: var(--text-muted);
  opacity: 0.5;
  margin-bottom: 16px;
}

.empty-title {
  margin: 0 0 8px 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.empty-description {
  margin: 0 0 20px 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
  max-width: 300px;
}

.empty-action {
  margin-top: 8px;
}
</style>
