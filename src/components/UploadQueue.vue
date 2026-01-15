<script setup lang="ts">
import { computed } from 'vue';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import VirtualScroller from 'primevue/virtualscroller';
import type { ServiceType } from '../config/types';
import { useToast } from '../composables/useToast';
import { useQueueState } from '../composables/useQueueState';
import type { QueueItem } from '../uploadQueue';
import { deepClone, deepMerge } from '../utils/deepClone';
import { generateThumbnailUrl, getThumbnailCandidates } from '../composables/useThumbCache';
import ThumbnailImage from './common/ThumbnailImage.vue';
import { useConfigManager } from '../composables/useConfig';
import { getServiceIcon } from '../utils/icons';

/** 虚拟滚动阈值：超过此数量启用虚拟滚动 */
const VIRTUAL_SCROLL_THRESHOLD = 20;

/** 队列项估算高度（用于虚拟滚动） */
const ITEM_HEIGHT = 180;

const toast = useToast();
const { queueItems } = useQueueState();
const { config } = useConfigManager();

// ========== 状态计算缓存 ==========

/** 状态统计结果 */
interface StatusCounts {
  success: number;
  error: number;
  uploading: number;
  pending: number;
}

/** 进度条百分比 */
interface StackedProgress {
  successPct: number;
  errorPct: number;
  uploadingPct: number;
}

/** 缓存的项状态 */
interface CachedItemStatus {
  counts: StatusCounts;
  progress: StackedProgress;
  statusText: string;
}

/**
 * 计算所有队列项的状态缓存
 * 使用 computed 确保只在 queueItems 变化时重新计算
 */
const itemStatusCache = computed<Map<string, CachedItemStatus>>(() => {
  const cache = new Map<string, CachedItemStatus>();

  for (const item of queueItems.value) {
    // 计算状态统计
    let success = 0, error = 0, uploading = 0, pending = 0;
    item.enabledServices?.forEach(serviceId => {
      const status = item.serviceProgress?.[serviceId]?.status || '';
      if (isStatusSuccess(status)) success++;
      else if (isStatusError(status)) error++;
      else if (isStatusUploading(status)) uploading++;
      else pending++;
    });
    const counts: StatusCounts = { success, error, uploading, pending };

    // 计算进度条百分比
    const total = item.enabledServices?.length || 1;
    const progress: StackedProgress = {
      successPct: (counts.success / total) * 100,
      errorPct: (counts.error / total) * 100,
      uploadingPct: (counts.uploading / total) * 100
    };

    // 计算状态文本
    let statusText = '等待中...';
    if (counts.uploading > 0) {
      statusText = '正在同步...';
    } else if (counts.error > 0 && counts.success > 0) {
      statusText = '上传完成，部分失败';
    } else if (counts.error > 0 && counts.error === total) {
      statusText = '上传失败';
    } else if (counts.success > 0 && counts.success + counts.error === total) {
      statusText = '全部完成';
    } else if (counts.success > 0 && counts.pending > 0) {
      statusText = '部分完成...';
    }

    cache.set(item.id, { counts, progress, statusText });
  }

  return cache;
});

/** 获取缓存的状态统计 */
const getCachedCounts = (item: QueueItem): StatusCounts => {
  return itemStatusCache.value.get(item.id)?.counts || { success: 0, error: 0, uploading: 0, pending: 0 };
};

/** 获取缓存的进度条数据 */
const getCachedProgress = (item: QueueItem): StackedProgress => {
  return itemStatusCache.value.get(item.id)?.progress || { successPct: 0, errorPct: 0, uploadingPct: 0 };
};

/** 获取缓存的状态文本 */
const getCachedStatusText = (item: QueueItem): string => {
  return itemStatusCache.value.get(item.id)?.statusText || '等待中...';
};

/** 是否启用虚拟滚动（队列项数量超过阈值时启用） */
const useVirtualScroll = computed(() => queueItems.value.length > VIRTUAL_SCROLL_THRESHOLD);

// 重试回调函数
let retryCallback: ((itemId: string, serviceId?: ServiceType) => void) | null = null;

const handleRetry = (itemId: string, serviceId?: ServiceType) => {
  if (retryCallback) {
    retryCallback(itemId, serviceId);
  }
};

// 图床名称映射
const serviceNames: Record<ServiceType, string> = {
  weibo: '微博',
  r2: 'R2',
  jd: '京东',
  nowcoder: '牛客',
  qiyu: '七鱼',
  zhihu: '知乎',
  nami: '纳米',
  bilibili: 'B站',
  chaoxing: '超星',
  smms: 'SM.MS',
  github: 'GitHub',
  imgur: 'Imgur',
  cos: '腾讯云',
  oss: '阿里云',
  qiniu: '七牛云',
  upyun: '又拍云'
};

// 判断状态类型
const isStatusSuccess = (status: string | undefined): boolean => {
  if (!status) return false;
  return status.includes('✓') || status.includes('完成');
};

const isStatusError = (status: string | undefined): boolean => {
  if (!status) return false;
  return status.includes('✗') || status.includes('失败');
};

const isStatusUploading = (status: string | undefined): boolean => {
  if (!status) return false;
  // 排除"等待中"，只匹配真正的上传中状态
  if (status.includes('等待中')) return false;
  // 包含 '%' 或 '上传' 或 '准备' 表示上传中
  // 或者包含步骤格式 "(数字/数字)" 也表示上传中（如 "获取STS凭证中... (2/5)"）
  return status.includes('%') ||
         status.includes('上传') ||
         status.includes('准备') ||
         /\(\d+\/\d+\)/.test(status);  // 匹配步骤格式
};

// 获取渠道卡片的状态类
const getChannelCardClass = (item: QueueItem, service: ServiceType) => {
  const status = item.serviceProgress?.[service]?.status || '';
  return {
    'error': isStatusError(status),
    'success': isStatusSuccess(status)
  };
};

// 获取渠道状态标签文本（紧凑模式）
const getStatusLabel = (item: QueueItem, service: ServiceType): string => {
  const progress = item.serviceProgress?.[service];
  const status = progress?.status || '';

  if (isStatusSuccess(status)) return '已发布';
  if (isStatusError(status)) return '失败';
  if (isStatusUploading(status)) return '上传中...';
  return '等待中';
};

// 获取状态标签的样式类
const getStatusLabelClass = (item: QueueItem, service: ServiceType): string => {
  const status = item.serviceProgress?.[service]?.status || '';
  if (isStatusSuccess(status)) return 'success';
  if (isStatusError(status)) return 'error';
  if (isStatusUploading(status)) return 'uploading';
  return '';
};

// 复制链接
const copyToClipboard = async (text: string | undefined) => {
  if (!text) return;
  try {
    await writeText(text);
    toast.success('已复制', '链接已复制到剪贴板', 1500);
  } catch (err) {
    console.error('Copy failed', err);
    toast.error('复制失败', String(err));
  }
};

defineExpose({
  addFile: (item: QueueItem) => {
    queueItems.value.unshift(deepClone(item));
  },
  updateItem: (id: string, updates: Partial<QueueItem>) => {
    const index = queueItems.value.findIndex(i => i.id === id);
    if (index !== -1) {
      const item = queueItems.value[index];
      const mergedItem = deepMerge(item, updates);
      queueItems.value[index] = mergedItem;

      const updatedItem = queueItems.value[index];
      
      // 注意：thumbUrl 设置逻辑已移除，因为现在使用 ThumbnailImage 组件
      // 该组件会自动通过 getThumbnailCandidates 生成候选 URL 列表
    }
  },
  getItem: (id: string) => queueItems.value.find(i => i.id === id),
  clear: () => {
    queueItems.value = [];
  },
  count: () => queueItems.value.length,
  getAllItems: () => queueItems.value,
  setRetryCallback: (callback: (itemId: string, serviceId?: ServiceType) => void) => {
    retryCallback = callback;
  }
});
</script>

<template>
  <div class="upload-queue">
    <!-- 空状态提示 -->
    <div v-if="queueItems.length === 0" class="upload-queue-empty">
      <i class="pi pi-inbox empty-icon"></i>
      <span class="empty-text">暂无上传队列</span>
    </div>

    <!-- 虚拟滚动模式（大列表） -->
    <VirtualScroller
      v-else-if="useVirtualScroll"
      :items="queueItems"
      :itemSize="ITEM_HEIGHT"
      class="virtual-scroller"
    >
      <template v-slot:item="{ item }">
        <div class="queue-card virtual-card">
          <!-- 头部：缩略图 + 文件名 + 统计标签 + 堆叠进度条 -->
          <div class="card-header">
            <!-- 缩略图 -->
            <!-- 缩略图 -->
            <div class="thumbnail-wrapper">
              <ThumbnailImage
                :srcs="getThumbnailCandidates(item as any, config)"
                :alt="item.fileName"
                imageClass="thumbnail"
              >
                <template #placeholder>
                  <div class="thumbnail-placeholder">
                    <i class="pi pi-image"></i>
                  </div>
                </template>
              </ThumbnailImage>
            </div>

            <!-- 头部内容 -->
            <div class="header-content">
              <!-- 顶部行：文件名 + 状态标签 -->
              <div class="header-top">
                <h3 class="filename" :title="item.fileName">{{ item.fileName }}</h3>
                <div class="status-pills">
                  <span v-if="getCachedCounts(item as QueueItem).success > 0" class="pill success">
                    <i class="pi pi-check-circle"></i>
                    {{ getCachedCounts(item as QueueItem).success }}
                  </span>
                  <span v-if="getCachedCounts(item as QueueItem).error > 0" class="pill error">
                    <i class="pi pi-exclamation-circle"></i>
                    {{ getCachedCounts(item as QueueItem).error }}
                  </span>
                  <span v-if="getCachedCounts(item as QueueItem).uploading > 0" class="pill uploading">
                    <i class="pi pi-spin pi-spinner"></i>
                    {{ getCachedCounts(item as QueueItem).uploading }}
                  </span>
                </div>
              </div>

              <!-- 堆叠进度条 -->
              <div class="stacked-progress">
                <div
                  class="segment success"
                  :style="{ width: getCachedProgress(item as QueueItem).successPct + '%' }"
                ></div>
                <div
                  class="segment error"
                  :style="{ width: getCachedProgress(item as QueueItem).errorPct + '%' }"
                ></div>
                <div
                  class="segment uploading"
                  :style="{ width: getCachedProgress(item as QueueItem).uploadingPct + '%' }"
                ></div>
              </div>

              <!-- 状态描述 -->
              <div class="status-line">
                <span class="status-text">{{ getCachedStatusText(item as QueueItem) }}</span>
              </div>
            </div>
          </div>

          <!-- 渠道网格 -->
          <div
            v-if="(item as QueueItem).enabledServices && (item as QueueItem).serviceProgress"
            class="channel-grid"
          >
            <div
              v-for="service in (item as QueueItem).enabledServices"
              :key="service"
              class="channel-card"
              :class="getChannelCardClass(item as QueueItem, service)"
            >
              <!-- 渠道图标 -->
              <div class="channel-icon" :class="{ 'has-svg': !!getServiceIcon(service) }">
                <span v-if="getServiceIcon(service)" class="icon-svg" v-html="getServiceIcon(service)"></span>
                <span v-else>{{ serviceNames[service][0] }}</span>
              </div>

              <!-- 渠道信息 -->
              <div class="channel-info">
                <span class="channel-name">{{ serviceNames[service] }}</span>
                <span class="status-label" :class="getStatusLabelClass(item as QueueItem, service)">
                  {{ getStatusLabel(item as QueueItem, service) }}
                </span>
              </div>

              <!-- 右上角按钮 -->
              <button
                v-if="isStatusSuccess((item as QueueItem).serviceProgress[service]?.status)"
                @click="copyToClipboard((item as QueueItem).serviceProgress[service]?.link)"
                class="copy-btn"
                title="复制链接"
              >
                <i class="pi pi-copy"></i>
              </button>
              <button
                v-else-if="isStatusError((item as QueueItem).serviceProgress[service]?.status)"
                @click="handleRetry((item as QueueItem).id, service)"
                class="retry-btn"
                title="重试"
              >
                <i class="pi pi-refresh"></i>
              </button>
            </div>
          </div>
        </div>
      </template>
    </VirtualScroller>

    <!-- 普通模式（小列表） -->
    <div
      v-else
      v-for="item in queueItems"
      :key="item.id"
      class="queue-card"
    >
      <!-- 头部：缩略图 + 文件名 + 统计标签 + 堆叠进度条 -->
      <div class="card-header">
        <!-- 缩略图 -->
        <div class="thumbnail-wrapper">
          <ThumbnailImage
            :srcs="getThumbnailCandidates(item, config)"
            :alt="item.fileName"
            imageClass="thumbnail"
          >
            <template #placeholder>
              <div class="thumbnail-placeholder">
                <i class="pi pi-image"></i>
              </div>
            </template>
          </ThumbnailImage>
        </div>

        <!-- 头部内容 -->
        <div class="header-content">
          <!-- 顶部行：文件名 + 状态标签 -->
          <div class="header-top">
            <h3 class="filename" :title="item.fileName">{{ item.fileName }}</h3>
            <div class="status-pills">
              <span v-if="getCachedCounts(item).success > 0" class="pill success">
                <i class="pi pi-check-circle"></i>
                {{ getCachedCounts(item).success }}
              </span>
              <span v-if="getCachedCounts(item).error > 0" class="pill error">
                <i class="pi pi-exclamation-circle"></i>
                {{ getCachedCounts(item).error }}
              </span>
              <span v-if="getCachedCounts(item).uploading > 0" class="pill uploading">
                <i class="pi pi-spin pi-spinner"></i>
                {{ getCachedCounts(item).uploading }}
              </span>
            </div>
          </div>

          <!-- 堆叠进度条 -->
          <div class="stacked-progress">
            <div
              class="segment success"
              :style="{ width: getCachedProgress(item).successPct + '%' }"
            ></div>
            <div
              class="segment error"
              :style="{ width: getCachedProgress(item).errorPct + '%' }"
            ></div>
            <div
              class="segment uploading"
              :style="{ width: getCachedProgress(item).uploadingPct + '%' }"
            ></div>
          </div>

          <!-- 状态描述 -->
          <div class="status-line">
            <span class="status-text">{{ getCachedStatusText(item) }}</span>
          </div>
        </div>
      </div>

      <!-- 渠道网格 -->
      <div
        v-if="item.enabledServices && item.serviceProgress"
        class="channel-grid"
      >
        <div
          v-for="service in item.enabledServices"
          :key="service"
          class="channel-card"
          :class="getChannelCardClass(item, service)"
        >
          <!-- 渠道图标（去品牌化：统一中性灰） -->
          <div class="channel-icon" :class="{ 'has-svg': !!getServiceIcon(service) }">
            <span v-if="getServiceIcon(service)" class="icon-svg" v-html="getServiceIcon(service)"></span>
            <span v-else>{{ serviceNames[service][0] }}</span>
          </div>

          <!-- 渠道信息 -->
          <div class="channel-info">
            <span class="channel-name">{{ serviceNames[service] }}</span>
            <span class="status-label" :class="getStatusLabelClass(item, service)">
              {{ getStatusLabel(item, service) }}
            </span>
          </div>

          <!-- 右上角：成功时复制按钮 或 失败时重试按钮 -->
          <button
            v-if="isStatusSuccess(item.serviceProgress[service]?.status)"
            @click="copyToClipboard(item.serviceProgress[service]?.link)"
            class="copy-btn"
            title="复制链接"
          >
            <i class="pi pi-copy"></i>
          </button>
          <button
            v-else-if="isStatusError(item.serviceProgress[service]?.status)"
            @click="handleRetry(item.id, service)"
            class="retry-btn"
            title="重试"
          >
            <i class="pi pi-refresh"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 队列容器 */
.upload-queue {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 虚拟滚动容器 */
.virtual-scroller {
  flex: 1;
  height: 100%;
  min-height: 300px;
  max-height: calc(100vh - 200px);
}

/* 虚拟滚动卡片样式调整 */
.virtual-card {
  margin-bottom: 12px;
  box-sizing: border-box;
}

/* 空状态 */
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

/* 队列卡片 */
.queue-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 14px;
}

/* 卡片头部 */
.card-header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

/* 缩略图 */
.thumbnail-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
}

.thumbnail {
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

/* 头部内容 */
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

/* 状态标签 */
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

/* 状态胶囊：更克制的颜色 */
.pill.success {
  color: var(--success);
  background: rgba(16, 185, 129, 0.05);
  border-color: transparent;
}

.pill.error {
  color: var(--error);
  background: transparent;
  border-color: transparent;
}

.pill.uploading {
  color: var(--primary);
  background: rgba(59, 130, 246, 0.05);
  border-color: transparent;
}

/* 堆叠进度条：更细更精致 */
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
  background: var(--success);  /* Emerald */
}

.segment.error {
  background: #f87171;  /* Rose 400 - 更柔和 */
}

.segment.uploading {
  background: var(--primary);  /* Sky */
  animation: progressPulse 1.5s ease-in-out infinite;
}

@keyframes progressPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* 状态描述 */
.status-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-text {
  font-size: 11px;
  color: var(--text-muted);
}

/* 自适应网格 */
.channel-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(4, 1fr);
}

/* 渠道卡片 */
.channel-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  transition: all 0.2s ease;
}

/* Hover 态：边框变品牌蓝 */
.channel-card:hover {
  border-color: rgba(59, 130, 246, 0.3);
}

/* 错误态：浅红色透明背景 */
.channel-card.error {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
}

/* 成功态：浅绿色透明背景 */
.channel-card.success {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.3);
}


/* 渠道图标 */
.channel-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 11px;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.channel-icon.has-svg {
  background: transparent;
  color: var(--text-primary);
}

.channel-icon .icon-svg {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.channel-icon .icon-svg svg {
  width: 14px;
  height: 14px;
}


/* 渠道信息 */
.channel-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.channel-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}


/* 状态标签（紧凑模式） */
.status-label {
  font-size: 11px;
  color: var(--text-muted);
}

.status-label.success {
  color: var(--success);
}

.status-label.error {
  color: var(--error);
}

.status-label.uploading {
  color: var(--primary);
}

/* 复制按钮 */
.copy-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: none;
  border: none;
  color: var(--success);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  opacity: 0.6;
}

.copy-btn:hover {
  background: var(--success-soft);
  opacity: 1;
}

.copy-btn i {
  font-size: 12px;
}


/* 重试按钮 */
.retry-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: none;
  border: none;
  color: var(--error);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.retry-btn:hover {
  background: var(--error-soft);
}

.retry-btn i {
  font-size: 12px;
}

</style>
