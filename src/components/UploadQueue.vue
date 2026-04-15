<script setup lang="ts">
import { computed, ref } from 'vue';
import VirtualScroller from 'primevue/virtualscroller';
import { useElementSize } from '@vueuse/core';
import { useQueueState } from '../composables/useQueueState';
import type { QueueItem } from '../uploadQueue';
import { deepClone, deepMerge } from '../utils/deepClone';
import { useConfigManager } from '../composables/useConfig';
import { useCopyLink } from '../composables/useCopyLink';
import type { LinkFormat } from '../utils/linkFormatter';
import InlineEmptyState from './common/InlineEmptyState.vue';
import QueueCard from './upload/QueueCard.vue';

const VIRTUAL_SCROLL_THRESHOLD = 20;

// 虚拟滚动项高度计算常量（基于 QueueCard 实际 DOM 结构）
const CARD_PADDING = 28;       // padding: 14px * 2
const HEADER_SECTION = 62;     // card-header(~50px) + margin-bottom(12px)
const CHANNEL_CARD_H = 44;     // 单个 ChannelCard 高度（padding 8*2 + content ~26 + border 2）
const CHANNEL_GAP = 8;         // channel-grid gap
const CHANNEL_MIN_W = 150;     // channel-grid minmax 最小宽度（与 QueueCard 的 minmax(150px,1fr) 一致）
const CARD_GAP = 12;           // 卡片间距（padding-bottom）
const HEIGHT_BUFFER = 6;       // 浏览器渲染差异安全余量

const scrollerRef = ref<HTMLElement | null>(null);
const { width: scrollerWidth } = useElementSize(scrollerRef);

const { queueItems } = useQueueState();
const { config } = useConfigManager();
const { copyLink } = useCopyLink();

const useVirtualScroll = computed(() => queueItems.value.length > VIRTUAL_SCROLL_THRESHOLD);

/**
 * 动态计算虚拟滚动项高度
 * 列数根据容器实际宽度推算，与 QueueCard 的 repeat(auto-fill, minmax(150px,1fr)) 保持一致
 */
const dynamicItemHeight = computed(() => {
  let maxServices = 0;
  for (const item of queueItems.value) {
    const count = item.enabledServices?.length ?? 0;
    if (count > maxServices) maxServices = count;
  }
  if (maxServices === 0) maxServices = 4;

  // channel-grid 可用宽度 = 容器宽度 - 卡片 padding
  const gridWidth = (scrollerWidth.value || 850) - CARD_PADDING;
  const cols = Math.max(1, Math.floor((gridWidth + CHANNEL_GAP) / (CHANNEL_MIN_W + CHANNEL_GAP)));
  const rows = Math.ceil(maxServices / cols);
  const gridHeight = rows * CHANNEL_CARD_H + Math.max(0, rows - 1) * CHANNEL_GAP;
  return CARD_PADDING + HEADER_SECTION + gridHeight + CARD_GAP + HEIGHT_BUFFER;
});

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
    <InlineEmptyState v-if="queueItems.length === 0" icon="pi pi-inbox" title="暂无上传队列" />

    <VirtualScroller
      v-else-if="useVirtualScroll"
      ref="scrollerRef"
      :items="queueItems"
      :itemSize="dynamicItemHeight"
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
  gap: var(--space-md);
}

.virtual-scroller {
  flex: 1;
  height: 100%;
  min-height: 300px;
  max-height: calc(100vh - 200px);
}

.virtual-card {
  padding-bottom: var(--space-md);
  box-sizing: border-box;
}
</style>
