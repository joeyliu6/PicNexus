<script setup lang="ts">
import { computed } from 'vue';
import VirtualScroller from 'primevue/virtualscroller';
import { useQueueState } from '../composables/useQueueState';
import type { QueueItem } from '../uploadQueue';
import { deepClone, deepMerge } from '../utils/deepClone';
import { useConfigManager } from '../composables/useConfig';
import { useCopyLink } from '../composables/useCopyLink';
import type { LinkFormat } from '../utils/linkFormatter';
import QueueCard from './upload/QueueCard.vue';

const VIRTUAL_SCROLL_THRESHOLD = 20;
const ITEM_HEIGHT = 180;

const { queueItems } = useQueueState();
const { config } = useConfigManager();
const { copyLink } = useCopyLink();

const useVirtualScroll = computed(() => queueItems.value.length > VIRTUAL_SCROLL_THRESHOLD);

interface QueueCopyPayload {
  url: string;
  serviceId: string;
  fileName: string;
  format?: LinkFormat;
}

let retryCallback: ((itemId: string, serviceId?: string) => void) | null = null;

function handleRetry(itemId: string, serviceId: string) {
  retryCallback?.(itemId, serviceId);
}

async function handleCopy(payload: QueueCopyPayload) {
  await copyLink(
    {
      url: payload.url,
      serviceId: payload.serviceId,
      fileName: payload.fileName
    },
    {
      format: payload.format
    }
  );
}

defineExpose({
  addFile: (item: QueueItem) => {
    queueItems.value.unshift(deepClone(item));
  },
  updateItem: (id: string, updates: Partial<QueueItem>) => {
    const index = queueItems.value.findIndex(i => i.id === id);
    if (index !== -1) {
      queueItems.value[index] = deepMerge(queueItems.value[index], updates);
    }
  },
  getItem: (id: string) => queueItems.value.find(i => i.id === id),
  clear: () => {
    queueItems.value = [];
  },
  count: () => queueItems.value.length,
  getAllItems: () => queueItems.value,
  setRetryCallback: (callback: (itemId: string, serviceId?: string) => void) => {
    retryCallback = callback;
  },
});
</script>

<template>
  <div class="upload-queue">
    <div v-if="queueItems.length === 0" class="upload-queue-empty">
      <i class="pi pi-inbox empty-icon"></i>
      <span class="empty-text">暂无上传队列</span>
    </div>

    <VirtualScroller
      v-else-if="useVirtualScroll"
      :items="queueItems"
      :itemSize="ITEM_HEIGHT"
      class="virtual-scroller"
    >
      <template v-slot:item="{ item }">
        <QueueCard
          :item="(item as QueueItem)"
          :config="config"
          class="virtual-card"

          @copy="handleCopy"
          @retry="handleRetry"
        />
      </template>
    </VirtualScroller>

    <QueueCard
      v-else
      v-for="item in queueItems"
      :key="item.id"
      :item="item"
      :config="config"
      @copy="handleCopy"
      @retry="handleRetry"
    />
  </div>
</template>

<style scoped>
.upload-queue {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.virtual-scroller {
  flex: 1;
  height: 100%;
  min-height: 300px;
  max-height: calc(100vh - 200px);
}

.virtual-card {
  margin-bottom: 12px;
  box-sizing: border-box;
}

.upload-queue-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 0;
  text-align: center;
  gap: 8px;
}

.empty-icon {
  font-size: 2rem;
  color: var(--text-muted);
  opacity: 0.5;
}

.empty-text {
  color: var(--text-secondary);
  font-size: 13px;
  font-style: italic;
  opacity: 0.7;
}
</style>
