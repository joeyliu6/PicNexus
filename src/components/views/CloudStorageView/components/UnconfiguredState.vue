<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import { getServiceIcon } from '../../../../utils/icons';
import { SERVICE_NAMES, type CloudServiceType } from '../types';

const props = defineProps<{
  serviceId: CloudServiceType;
}>();

const emit = defineEmits<{
  goToSettings: [];
}>();

const serviceName = computed(() => SERVICE_NAMES[props.serviceId]);
const serviceIconSvg = computed(() => getServiceIcon(props.serviceId) || '');

</script>

<template>
  <div class="unconfigured-state">
    <div class="unconfigured-card">
      <div class="service-icon" v-html="serviceIconSvg"></div>
      <h3 class="service-title">{{ serviceName }}</h3>
      <p class="service-desc">该服务尚未配置，请先在设置中填写凭证信息</p>

      <Button
        label="前往设置"
        icon="pi pi-cog"
        class="go-settings-btn"
        @click="emit('goToSettings')"
      />
    </div>
  </div>
</template>

<style scoped>
.unconfigured-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 400px;
  padding: 40px 20px;
}

.unconfigured-card {
  text-align: center;
  max-width: 420px;
}

.service-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  color: var(--text-muted);
  opacity: 0.6;
}

.service-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.service-title {
  margin: 0 0 8px;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.service-desc {
  margin: 0 0 24px;
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.5;
}

</style>
