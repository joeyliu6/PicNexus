<script setup lang="ts">
import { getIllustration } from '../../../../utils/icons';

defineProps<{
  title: string;
}>();
</script>

<template>
  <div class="empty-state">
    <div class="empty-illustration" v-html="getIllustration('cloud-upload')"></div>
    <h3 class="empty-title">{{ title }}</h3>
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

.empty-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 500;
  color: var(--text-muted);
}
</style>
