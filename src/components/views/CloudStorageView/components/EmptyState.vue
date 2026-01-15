<script setup lang="ts">
import Button from 'primevue/button';
import { getIllustration } from '../../../../utils/illustrationIcons';

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
    <!-- SVG 插画 -->
    <div class="empty-illustration" v-html="getIllustration('cloud-upload')"></div>

    <h3 class="empty-title">{{ title }}</h3>
    <p v-if="description" class="empty-description">{{ description }}</p>
    <Button
      v-if="actionLabel"
      :label="actionLabel"
      :icon="actionIcon ? `pi ${actionIcon}` : undefined"
      @click="emit('action')"
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
  padding: 80px 20px;
  text-align: center;
}

.empty-illustration {
  width: 200px;
  height: 160px;
  margin-bottom: 24px;
  color: var(--text-primary);
}

.empty-illustration svg {
  width: 100%;
  height: 100%;
}

.empty-title {
  margin: 0 0 8px 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--text-primary);
}

.empty-description {
  margin: 0 0 24px 0;
  font-size: 14px;
  color: var(--text-secondary);
  max-width: 320px;
  line-height: 1.5;
}

.empty-action {
  font-weight: 500;
}
</style>
