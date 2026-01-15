<script setup lang="ts">
import { computed } from 'vue';
import type { ServiceType, UserConfig } from '../../config/types';
import type { QueueItem } from '../../uploadQueue';
import { getThumbnailCandidates } from '../../composables/useThumbCache';
import { isStatusSuccess, isStatusError, isStatusUploading } from '../../utils/uploadStatus';
import ThumbnailImage from '../common/ThumbnailImage.vue';
import ChannelCard from './ChannelCard.vue';

interface StatusCounts {
  success: number;
  error: number;
  uploading: number;
  pending: number;
}

interface StackedProgress {
  successPct: number;
  errorPct: number;
  uploadingPct: number;
}

interface Props {
  item: QueueItem;
  config: UserConfig;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  copy: [link: string];
  retry: [itemId: string, serviceId: ServiceType];
}>();

const counts = computed<StatusCounts>(() => {
  let success = 0, error = 0, uploading = 0, pending = 0;
  props.item.enabledServices?.forEach(serviceId => {
    const status = props.item.serviceProgress?.[serviceId]?.status || '';
    if (isStatusSuccess(status)) success++;
    else if (isStatusError(status)) error++;
    else if (isStatusUploading(status)) uploading++;
    else pending++;
  });
  return { success, error, uploading, pending };
});

const progress = computed<StackedProgress>(() => {
  const total = props.item.enabledServices?.length || 1;
  return {
    successPct: (counts.value.success / total) * 100,
    errorPct: (counts.value.error / total) * 100,
    uploadingPct: (counts.value.uploading / total) * 100,
  };
});

const statusText = computed(() => {
  const c = counts.value;
  const total = props.item.enabledServices?.length || 1;

  if (c.uploading > 0) return '正在同步...';
  if (c.error > 0 && c.success > 0) return '上传完成，部分失败';
  if (c.error > 0 && c.error === total) return '上传失败';
  if (c.success > 0 && c.success + c.error === total) return '全部完成';
  if (c.success > 0 && c.pending > 0) return '部分完成...';
  return '等待中...';
});

const thumbnailSrcs = computed(() => getThumbnailCandidates(props.item, props.config));

function handleCopy(link: string) {
  emit('copy', link);
}

function handleRetry(serviceId: ServiceType) {
  emit('retry', props.item.id, serviceId);
}
</script>

<template>
  <div class="queue-card">
    <div class="card-header">
      <div class="thumbnail-wrapper">
        <ThumbnailImage :srcs="thumbnailSrcs" :alt="item.fileName" imageClass="thumbnail">
          <template #placeholder>
            <div class="thumbnail-placeholder">
              <i class="pi pi-image"></i>
            </div>
          </template>
        </ThumbnailImage>
      </div>

      <div class="header-content">
        <div class="header-top">
          <h3 class="filename" :title="item.fileName">{{ item.fileName }}</h3>
          <div class="status-pills">
            <span v-if="counts.success > 0" class="pill success">
              <i class="pi pi-check-circle"></i>
              {{ counts.success }}
            </span>
            <span v-if="counts.error > 0" class="pill error">
              <i class="pi pi-exclamation-circle"></i>
              {{ counts.error }}
            </span>
            <span v-if="counts.uploading > 0" class="pill uploading">
              <i class="pi pi-spin pi-spinner"></i>
              {{ counts.uploading }}
            </span>
          </div>
        </div>

        <div class="stacked-progress">
          <div class="segment success" :style="{ width: progress.successPct + '%' }"></div>
          <div class="segment error" :style="{ width: progress.errorPct + '%' }"></div>
          <div class="segment uploading" :style="{ width: progress.uploadingPct + '%' }"></div>
        </div>

        <div class="status-line">
          <span class="status-text">{{ statusText }}</span>
        </div>
      </div>
    </div>

    <div v-if="item.enabledServices && item.serviceProgress" class="channel-grid">
      <ChannelCard
        v-for="service in item.enabledServices"
        :key="service"
        :service="service"
        :status="item.serviceProgress[service]?.status"
        :link="item.serviceProgress[service]?.link"
        @copy="handleCopy"
        @retry="handleRetry(service)"
      />
    </div>
  </div>
</template>

<style scoped>
.queue-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 14px;
}

.card-header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.thumbnail-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
}

:deep(.thumbnail) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumbnail-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 16px;
}

.header-content {
  flex: 1;
  min-width: 0;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  gap: 8px;
}

.filename {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.status-pills {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid transparent;
}

.pill i {
  font-size: 10px;
}

.pill.success {
  color: var(--success);
  background: rgba(16, 185, 129, 0.05);
}

.pill.error {
  color: var(--error);
  background: transparent;
}

.pill.uploading {
  color: var(--primary);
  background: rgba(59, 130, 246, 0.05);
}

.stacked-progress {
  height: 4px;
  background: var(--bg-input);
  border-radius: 2px;
  display: flex;
  overflow: hidden;
  margin-bottom: 4px;
}

.segment {
  height: 100%;
  transition: width 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.segment.success {
  background: var(--success);
}

.segment.error {
  background: #f87171;
}

.segment.uploading {
  background: var(--primary);
  animation: progressPulse 1.5s ease-in-out infinite;
}

@keyframes progressPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.status-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-text {
  font-size: 11px;
  color: var(--text-muted);
}

.channel-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(4, 1fr);
}
</style>
