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

const CONFIG_HINTS: Record<CloudServiceType, string[]> = {
  r2: [
    '在 Cloudflare 控制台创建 R2 存储桶',
    '生成 API Token（需要 R2 读写权限）',
    '填写 Account ID、Access Key、Secret Key 和 Bucket 名称',
  ],
  tencent: [
    '在腾讯云控制台创建 COS 存储桶',
    '获取 SecretId 和 SecretKey',
    '填写地域、Bucket 名称和访问域名',
  ],
  aliyun: [
    '在阿里云控制台创建 OSS 存储桶',
    '获取 AccessKey ID 和 AccessKey Secret',
    '填写地域、Bucket 名称和访问域名',
  ],
  qiniu: [
    '在七牛云控制台创建存储空间',
    '获取 Access Key 和 Secret Key',
    '填写 Bucket 名称和绑定的访问域名',
  ],
  upyun: [
    '在又拍云控制台创建存储服务',
    '获取操作员账号和密码',
    '填写服务名称（Bucket）和绑定的访问域名',
  ],
};
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

      <div class="config-steps">
        <p class="steps-title">配置步骤</p>
        <ol class="steps-list">
          <li v-for="(step, i) in CONFIG_HINTS[serviceId]" :key="i">{{ step }}</li>
        </ol>
      </div>
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

.go-settings-btn {
  margin-bottom: 32px;
}

.config-steps {
  text-align: left;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle-light);
  border-radius: 8px;
  padding: 16px 20px;
}

.steps-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.steps-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.8;
}
</style>
