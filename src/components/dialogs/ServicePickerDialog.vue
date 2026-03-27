<template>
  <Dialog
    :visible="visible"
    :modal="true"
    header="选择专用图床"
    :style="{ width: '520px' }"
    :draggable="false"
    @update:visible="handleClose"
  >
    <div class="service-picker">
      <InputText
        v-model="searchQuery"
        placeholder="搜索图床..."
        class="search-input"
      />

      <div class="service-groups">
        <template v-for="group in filteredGroups" :key="group.label">
          <div class="group-header">
            <i :class="group.icon" />
            <span>{{ group.label }}</span>
          </div>
          <div class="group-grid">
            <div
              v-for="svc in group.services"
              :key="svc.value"
              class="service-item"
              :class="{
                selected: selectedService === svc.value,
                current: currentService === svc.value,
              }"
              @click="selectedService = svc.value"
            >
              <span class="service-name">{{ svc.label }}</span>
              <span class="service-desc">{{ svc.desc }}</span>
            </div>
          </div>
        </template>

        <div v-if="filteredGroups.length === 0" class="empty-result">
          没有匹配的图床
        </div>
      </div>
    </div>

    <template #footer>
      <Button
        label="取消"
        severity="secondary"
        outlined
        class="dialog-btn-reject"
        @click="handleClose"
      />
      <Button
        label="确认选择"
        icon="pi pi-check"
        class="dialog-btn-accept"
        :disabled="!selectedService"
        @click="handleConfirm"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import type { ServerServiceType } from '../../config/types';

interface ServiceOption {
  value: ServerServiceType;
  label: string;
  desc: string;
}

interface ServiceGroup {
  label: string;
  icon: string;
  services: ServiceOption[];
}

interface Props {
  visible: boolean;
  currentService: ServerServiceType | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  select: [service: ServerServiceType];
}>();

const SERVICE_GROUPS: ServiceGroup[] = [
  {
    label: '开箱即用',
    icon: 'pi pi-bolt',
    services: [
      { value: 'jd', label: '京东图床', desc: '无需认证，开箱即用' },
      { value: 'qiyu', label: '七鱼图床', desc: '无需认证（需 Chrome/Edge）' },
    ],
  },
  {
    label: '私有存储',
    icon: 'pi pi-cloud',
    services: [
      { value: 'r2', label: 'Cloudflare R2', desc: '私有 S3 存储' },
      { value: 'tencent', label: '腾讯云 COS', desc: 'SecretId + SecretKey' },
      { value: 'aliyun', label: '阿里云 OSS', desc: 'AccessKey + Secret' },
      { value: 'qiniu', label: '七牛云', desc: 'AK + SK' },
      { value: 'upyun', label: '又拍云', desc: 'Operator + Password' },
    ],
  },
  {
    label: 'Token 认证',
    icon: 'pi pi-key',
    services: [
      { value: 'github', label: 'GitHub', desc: 'Personal Access Token' },
      { value: 'smms', label: 'SM.MS', desc: 'API Token' },
      { value: 'imgur', label: 'Imgur', desc: 'Client ID' },
    ],
  },
  {
    label: 'Cookie 认证',
    icon: 'pi pi-lock',
    services: [
      { value: 'weibo', label: '微博', desc: '需要 Cookie' },
      { value: 'bilibili', label: '哔哩哔哩', desc: '需要 Cookie' },
      { value: 'zhihu', label: '知乎', desc: '需要 Cookie' },
      { value: 'nowcoder', label: '牛客', desc: '需要 Cookie' },
      { value: 'chaoxing', label: '超星', desc: '需要 Cookie' },
      { value: 'nami', label: '纳米图床', desc: 'Cookie + Token' },
    ],
  },
];

const searchQuery = ref('');
const selectedService = ref<ServerServiceType | null>(null);

watch(() => props.visible, (val) => {
  if (val) {
    selectedService.value = props.currentService;
    searchQuery.value = '';
  }
});

const filteredGroups = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return SERVICE_GROUPS;

  return SERVICE_GROUPS
    .map(group => ({
      ...group,
      services: group.services.filter(
        svc => svc.label.toLowerCase().includes(q) || svc.desc.toLowerCase().includes(q)
      ),
    }))
    .filter(group => group.services.length > 0);
});

function handleConfirm() {
  if (!selectedService.value) return;
  emit('select', selectedService.value);
  emit('update:visible', false);
}

function handleClose() {
  emit('update:visible', false);
}
</script>

<style scoped>
.service-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-input {
  width: 100%;
  border-radius: 8px;
  font-size: 13px;
}

.service-groups {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 400px;
  overflow-y: auto;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 10px 4px 4px;
}

.group-header i {
  font-size: 12px;
}

.group-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.service-item {
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-card);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: all 0.15s;
}

.service-item:hover {
  border-color: var(--primary);
}

.service-item.selected {
  border-color: var(--primary);
  background: var(--primary-alpha-8);
  box-shadow: 0 0 0 1px var(--primary);
}

.service-item.current:not(.selected) {
  border-color: var(--primary-alpha-30);
}

.service-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.service-item.selected .service-name {
  color: var(--primary);
}

.service-desc {
  font-size: 11px;
  color: var(--text-muted);
}

.empty-result {
  text-align: center;
  padding: 24px;
  color: var(--text-muted);
  font-size: 13px;
}

:deep(.dialog-btn-reject) {
  flex: 1;
  border-radius: 8px !important;
  padding: 12px 20px !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  background: var(--bg-button-secondary) !important;
  border: none !important;
  color: white !important;
}

:deep(.dialog-btn-reject:hover) {
  background: var(--bg-button-secondary-hover) !important;
}

:deep(.dialog-btn-accept) {
  flex: 1;
  border-radius: 8px !important;
  padding: 12px 20px !important;
  font-size: 14px !important;
  font-weight: 600 !important;
}
</style>
