<script setup lang="ts">
import { computed } from 'vue';
import type { UserConfig } from '../../config/types';
import type { QueueItem } from '../../core/UploadQueue';
import type { LinkFormat } from '../../utils/linkFormatter';
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

interface QueueCopyPayload {
  url: string;
  serviceId: string;
  fileName: string;
  format?: LinkFormat;
  itemId?: string;
}

interface Props {
  item: QueueItem;
  config: UserConfig;
  copiedServiceKey?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  copiedServiceKey: null,
});

const emit = defineEmits<{
  copy: [payload: QueueCopyPayload];
  retry: [itemId: string, serviceId: string];
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
  if (c.error > 0 && c.pending > 0) return '部分失败，等待中...';
  if (c.error > 0 && c.success > 0) return '上传完成，部分失败';
  if (c.error > 0 && c.error === total) return '上传失败';
  if (c.success > 0 && c.success + c.error === total) return '全部完成';
  if (c.success > 0 && c.pending > 0) return '部分完成...';
  return '等待中...';
});

const thumbnailSrcs = computed(() => getThumbnailCandidates(props.item, props.config));

function getServiceCopyKey(serviceId: string): string {
  return `upload-queue:${props.item.id}:${serviceId}`;
}

function handleRetry(serviceId: string) {
  emit('retry', props.item.id, serviceId);
}

function handleCopy(payload: QueueCopyPayload) {
  emit('copy', {
    ...payload,
    itemId: props.item.id,
  });
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
          <h3 class="filename" v-tooltip.top="item.fileName">{{ item.fileName }}</h3>
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
        :error="item.serviceProgress[service]?.error"
        :link="item.serviceProgress[service]?.link"
        :file-name="item.fileName"
        :copied="copiedServiceKey === getServiceCopyKey(service)"
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
  border-radius: var(--radius-md);
  padding: var(--space-md-lg);
}

.card-header {
  display: flex;
  gap: var(--space-md);
  align-items: center;
  margin-bottom: var(--space-md);
}

.thumbnail-wrapper {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
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
  font-size: var(--text-lg);
}

.header-content {
  flex: 1;
  min-width: 0;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-xs-sm);
  gap: var(--space-sm);
}

.filename {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.status-pills {
  display: flex;
  gap: var(--space-xs-sm);
  flex-shrink: 0;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-2xs) var(--space-xs-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  border: 1px solid transparent;
}

.pill i {
  font-size: var(--text-2xs);
}

.pill.success {
  color: var(--success);
  background: var(--success-alpha-8);
}

.pill.error {
  color: var(--error);
  background: transparent;
}

.pill.uploading {
  color: var(--primary);
  background: var(--primary-alpha-5);
}

.stacked-progress {
  height: 4px;
  background: var(--bg-input);
  border-radius: var(--radius-xs);
  display: flex;
  overflow: hidden;
  margin-bottom: var(--space-xs);
}

.segment {
  height: 100%;
  transition: width var(--duration-slower) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.segment.success {
  background: var(--success);
}

.segment.error {
  background: var(--error);
}

.segment.uploading {
  background: var(--primary);
  animation: k-pulse var(--duration-shimmer) ease-in-out infinite;
}

.status-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-text {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.channel-grid {
  display: grid;
  gap: var(--space-sm);
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
}
</style>
