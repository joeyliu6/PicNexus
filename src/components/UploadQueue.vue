<script setup lang="ts">
import { writeText } from '@tauri-apps/api/clipboard';
import type { ServiceType } from '../config/types';
import ProgressBar from 'primevue/progressbar';
import Button from 'primevue/button';
import { useToast } from '../composables/useToast';
import { useQueueState } from '../composables/useQueueState';
import type { QueueItem } from '../uploadQueue';

const toast = useToast();
const { queueItems } = useQueueState();  // 使用全局队列状态

// 重试回调函数 (支持 serviceId 参数)
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
  tcl: 'TCL',
  jd: '京东',
  nowcoder: '牛客',
  qiyu: '七鱼',
  zhihu: '知乎',
  nami: '纳米'
};

// 获取状态颜色类
const getStatusClass = (status: string): string => {
  if (status.includes('✓') || status.includes('完成')) return 'success';
  if (status.includes('✗') || status.includes('失败')) return 'error';
  if (status.includes('跳过')) return 'skipped';
  if (status.includes('%') || status.includes('中')) return 'uploading';
  return '';
};

// 状态文字精简函数
const formatStatus = (status: string | undefined): string => {
  if (!status) return '等待';

  // 检测完成状态
  if (status.includes('✓') || status.includes('完成')) return '完成';

  // 检测失败状态
  if (status.includes('✗') || status.includes('失败')) return '失败';

  // 检测跳过状态
  if (status.includes('跳过')) return '跳过';

  // 检测等待状态
  if (status.includes('等待')) return '等待';

  // 如果是百分比，直接返回
  if (status.includes('%')) return status;

  // 如果是步骤信息（如 "获取凭证中... (1/2)"）
  const stepMatch = status.match(/^(.+?)\s*\((\d+)\/(\d+)\)$/);
  if (stepMatch) {
    const stepText = stepMatch[1].replace(/\.\.\.$/, '').trim();
    // 智能简化步骤文字
    const shortStepMap: Record<string, string> = {
      '获取凭证中': '获取中',
      '获取Token中': '获取中',
      '上传图片中': '上传中',
      '处理图片中': '处理中',
      '压缩图片中': '压缩中',
      '验证图片中': '验证中'
    };
    const shortStep = shortStepMap[stepText] || stepText;
    return `${shortStep} ${stepMatch[2]}/${stepMatch[3]}`;
  }

  // 兜底策略：截断过长文字
  return status.length > 8 ? status.substring(0, 7) + '..' : status;
};

// 计算整体状态（含部分成功）
const getOverallStatus = (item: QueueItem): 'success' | 'error' | 'partial-success' | 'uploading' | 'pending' => {
  if (item.status === 'pending' || item.status === 'uploading') {
    return item.status;
  }

  if (!item.serviceProgress || !item.enabledServices) {
    return item.status;
  }

  let successCount = 0;
  let failedCount = 0;

  const serviceProgress = item.serviceProgress; // 类型守卫
  item.enabledServices.forEach(serviceId => {
    const progress = serviceProgress[serviceId];
    if (progress) {
      const status = progress.status || '';
      if (status.includes('✓') || status.includes('完成')) {
        successCount++;
      } else if (status.includes('✗') || status.includes('失败')) {
        failedCount++;
      }
    }
  });

  // 判断整体状态
  if (successCount > 0 && failedCount > 0) {
    return 'partial-success'; // 部分成功
  } else if (successCount > 0 && failedCount === 0) {
    return 'success'; // 全部成功
  } else if (failedCount > 0) {
    return 'error'; // 全部失败
  }

  return item.status;
};

// 计算汇总文本
const getSummaryText = (item: QueueItem): string | null => {
  if (!item.serviceProgress || !item.enabledServices) return null;
  if (item.status === 'pending' || item.status === 'uploading') return null;

  let successCount = 0;
  let failedCount = 0;

  const serviceProgress = item.serviceProgress; // 类型守卫
  item.enabledServices.forEach(serviceId => {
    const status = serviceProgress[serviceId]?.status || '';
    if (status.includes('✓') || status.includes('完成')) successCount++;
    else if (status.includes('✗') || status.includes('失败')) failedCount++;
  });

  const total = item.enabledServices.length;

  if (successCount === total) {
    return `全部完成 (${total}/${total})`;
  } else if (failedCount === total) {
    return `全部失败 (0/${total})`;
  } else if (successCount > 0) {
    return `部分成功 (${successCount}/${total})`;
  }

  return null;
};

// 获取状态图标
const getStatusIcon = (status: string): string => {
  if (status.includes('✓') || status.includes('完成')) return 'pi pi-check-circle';
  if (status.includes('✗') || status.includes('失败')) return 'pi pi-times-circle';
  if (status.includes('跳过')) return 'pi pi-minus-circle';
  if (status.includes('%') || status.includes('中')) return 'pi pi-spin pi-spinner';
  return '';
};

// 直接使用全局队列状态，不需要本地 items

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
      queueItems.value.unshift(item);
  },
  updateItem: (id: string, updates: Partial<QueueItem>) => {
      const item = queueItems.value.find(i => i.id === id);
      if (item) {
          Object.assign(item, updates);
          // Update thumbUrl if PID is available and not set
          if (item.weiboPid && !item.thumbUrl) {
              const baiduPrefix = 'https://image.baidu.com/search/down?thumburl=';
              const bmiddleUrl = `https://tvax1.sinaimg.cn/bmiddle/${item.weiboPid}.jpg`;
              item.thumbUrl = `${baiduPrefix}${bmiddleUrl}`;
          }
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
  <div class="upload-queue-vue">
    <!-- 空状态提示 -->
    <div v-if="queueItems.length === 0" class="upload-queue-empty">
      <i class="pi pi-inbox empty-icon"></i>
      <span class="empty-text">暂无上传队列</span>
    </div>

    <!-- 队列项列表 -->
    <div
      v-for="item in queueItems"
      :key="item.id"
      class="upload-item"
      :class="[
        item.status,
        {
          'upload-success': getOverallStatus(item) === 'success',
          'upload-error': getOverallStatus(item) === 'error',
          'upload-partial-success': getOverallStatus(item) === 'partial-success'
        }
      ]"
    >
      
      <!-- Preview Column -->
      <div class="preview">
        <img v-if="item.thumbUrl" :src="item.thumbUrl" :alt="item.fileName" class="thumb-img" referrerpolicy="no-referrer" onerror="this.style.display='none'">
        <svg v-else-if="item.status === 'error'" class="error-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <svg v-else class="loading-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/>
          <path d="M12 2 A10 10 0 0 1 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
        </svg>
      </div>

      <!-- Filename Column -->
      <div class="filename-section">
        <div class="filename" :title="item.fileName">{{ item.fileName }}</div>

        <!-- 整体状态汇总 -->
        <div
          v-if="getSummaryText(item)"
          class="status-summary"
          :class="{
            'summary-success': getOverallStatus(item) === 'success',
            'summary-error': getOverallStatus(item) === 'error',
            'summary-partial': getOverallStatus(item) === 'partial-success'
          }"
        >
          <i
            :class="getOverallStatus(item) === 'partial-success'
              ? 'pi pi-exclamation-triangle'
              : (getOverallStatus(item) === 'success' ? 'pi pi-check-circle' : 'pi pi-times-circle')"
          ></i>
          <span>{{ getSummaryText(item) }}</span>
        </div>
      </div>

      <!-- Progress Column -->
      <div class="progress-section">
        <!-- 新架构：多图床动态进度条 -->
        <template v-if="item.serviceProgress && item.enabledServices">
          <div
            v-for="service in item.enabledServices"
            :key="service"
            class="progress-row"
          >
            <label>{{ serviceNames[service] }}</label>

            <ProgressBar
              :value="item.serviceProgress[service]?.progress || 0"
              :class="getStatusClass(item.serviceProgress[service]?.status || '')"
              :showValue="false"
              class="progress-bar"
            />

            <span
              class="status"
              :class="getStatusClass(item.serviceProgress[service]?.status || '')"
              :title="item.serviceProgress[service]?.status"
            >
              {{ formatStatus(item.serviceProgress[service]?.status) }}
            </span>

            <div class="row-action">
              <Button
                v-if="item.serviceProgress[service]?.status?.includes('✓') || item.serviceProgress[service]?.status?.includes('完成')"
                @click="copyToClipboard(item.serviceProgress[service]?.link)"
                icon="pi pi-copy"
                text
                rounded
                size="small"
                class="action-btn copy-btn"
                v-tooltip.top="'复制链接'"
              />

              <i
                v-else-if="item.serviceProgress[service]?.isRetrying"
                class="pi pi-spin pi-spinner action-icon loading-icon"
                title="重传中..."
              ></i>

              <Button
                v-else-if="item.serviceProgress[service]?.status?.includes('✗') || item.serviceProgress[service]?.status?.includes('失败')"
                @click="handleRetry(item.id, service)"
                icon="pi pi-refresh"
                severity="danger"
                text
                rounded
                size="small"
                class="action-btn retry-btn"
                v-tooltip.top="'重试此服务'"
              />
            </div>
          </div>
        </template>

        <!-- 旧架构：向后兼容 Weibo + R2 -->
        <template v-else>
          <div class="progress-row">
            <label>微博</label>
            <ProgressBar :value="item.weiboProgress" :showValue="false" class="progress-bar" />
            <span class="status" :class="{ success: item.weiboStatus?.includes('✓'), error: item.weiboStatus?.includes('✗') }" :title="item.weiboStatus">
              <i v-if="getStatusIcon(item.weiboStatus || '')" :class="getStatusIcon(item.weiboStatus || '')" class="status-icon"></i>
              {{ formatStatus(item.weiboStatus) }}
            </span>
          </div>
          <div class="progress-row" v-if="item.uploadToR2">
            <label>R2</label>
            <ProgressBar :value="item.r2Progress" :showValue="false" class="progress-bar" />
            <span class="status" :class="{ success: item.r2Status?.includes('✓'), error: item.r2Status?.includes('✗'), skipped: item.r2Status === '已跳过' }" :title="item.r2Status">
              <i v-if="getStatusIcon(item.r2Status || '')" :class="getStatusIcon(item.r2Status || '')" class="status-icon"></i>
              {{ formatStatus(item.r2Status) }}
            </span>
          </div>
        </template>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* Inherit or adapt styles from style.css */
.upload-queue-vue {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

/* 空状态样式 */
.upload-queue-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 0;
    text-align: center;
    gap: 12px;
}

.empty-icon {
    font-size: 3rem;
    color: var(--text-muted);
    opacity: 0.5;
}

.empty-text {
    color: var(--text-secondary);
    font-size: var(--text-base);
    font-style: italic;
    opacity: 0.7;
}

.upload-item {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    background: var(--bg-card);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    gap: 12px;
    color: var(--text-primary);
    transition: all 0.2s ease;
}

.upload-item.upload-success {
    border-left: 4px solid var(--success);
    background: rgba(16, 185, 129, 0.05);
    animation: successPulse 0.6s ease-out;
}

.upload-item.upload-error {
    border-left: 4px solid var(--error);
    background: rgba(239, 68, 68, 0.05);
    animation: errorShake 0.5s ease-out;
}

/* 部分成功状态 */
.upload-item.upload-partial-success {
    border-left: 4px solid var(--warning);
    background: rgba(234, 179, 8, 0.05);
    animation: partialWarning 0.4s ease-out;
}

.preview {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-input);
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    flex-shrink: 0;
}

.thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.loading-icon {
    width: 24px;
    height: 24px;
    color: var(--primary);
    animation: spin 1s linear infinite;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

/* 文件名区域 */
.filename-section {
    flex: 1;
    min-width: 100px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.filename {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.9em;
    font-weight: 500;
    color: var(--text-primary);
}

/* 整体状态汇总 */
.status-summary {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 500;
    width: fit-content;
    animation: fadeIn 0.3s ease-out;
}

.status-summary i {
    font-size: 10px;
    flex-shrink: 0;
}

.summary-success {
    color: var(--success);
    background: rgba(16, 185, 129, 0.15);
    border: 1px solid rgba(16, 185, 129, 0.3);
}

.summary-error {
    color: var(--error);
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
}

.summary-partial {
    color: var(--warning);
    background: rgba(234, 179, 8, 0.15);
    border: 1px solid rgba(234, 179, 8, 0.3);
}

.progress-section {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
    flex: 1; /* 让它占据剩余空间 */
    margin-left: 10px;
}

.progress-row {
    display: grid;
    /* Label | ProgressBar | Status Text | Action Button */
    grid-template-columns: 40px 1fr 60px 32px;
    gap: 12px;
    align-items: center;
    font-size: 12px;
    height: 24px; /* 稍微增加高度以容纳按钮 */
}

.progress-row label {
    color: var(--text-secondary);
    text-align: left;
    white-space: nowrap;
}

/* PrimeVue ProgressBar 深度定制 */
.progress-bar {
    height: 5px !important; /* 从 4px 增加到 5px */
    border-radius: 3px;
}

.progress-bar :deep(.p-progressbar) {
    background: rgba(51, 65, 85, 0.5); /* 未完成部分半透明 */
    border-radius: 3px;
}

.progress-bar :deep(.p-progressbar-value) {
    border-radius: 3px;
    transition: all 0.3s ease;
}

/* 成功状态 - 渐变绿色 */
.progress-bar.success :deep(.p-progressbar-value) {
    background: linear-gradient(
        90deg,
        var(--success) 0%,
        #14f195 50%,
        var(--success) 100%
    );
}

/* 失败状态 - 红色 */
.progress-bar.error :deep(.p-progressbar-value) {
    background-color: var(--error);
}

/* 上传中状态 - 渐变蓝色 + 滑动动画 */
.progress-bar.uploading :deep(.p-progressbar-value) {
    background: linear-gradient(
        90deg,
        var(--primary) 0%,
        var(--accent) 50%,
        var(--primary) 100%
    );
    background-size: 200% 100%;
    animation: progressShimmer 1.5s ease-in-out infinite;
}

/* 跳过状态 - 灰色 */
.progress-bar.skipped :deep(.p-progressbar-value) {
    background-color: var(--text-muted);
}

/* 状态文本 */
.status {
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-secondary);
}

/* 状态颜色 */
.status.success { color: var(--success); }
.status.error { color: var(--error); }
.status.uploading { color: var(--primary); }

/* Row Action Styles */
.row-action {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
}

/* 按钮样式微调 */
.action-btn {
    width: 24px !important;
    height: 24px !important;
    padding: 0 !important;
}

.action-icon {
    font-size: 0.9rem;
    color: var(--text-muted);
}

.action-icon.loading-icon {
    color: var(--primary);
}

.error-icon {
    width: 24px;
    height: 24px;
    color: var(--error);
    flex-shrink: 0;
}

/* ========== 动画效果 ========== */

/* 成功光晕动画 */
@keyframes successPulse {
    0% {
        box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
    }
    70% {
        box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
    }
    100% {
        box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
    }
}

/* 失败抖动动画 */
@keyframes errorShake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70% { transform: translateX(-3px); }
    20%, 40%, 60% { transform: translateX(3px); }
}

/* 部分失败微抖动动画 */
@keyframes partialWarning {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-2px); }
    75% { transform: translateX(2px); }
}

/* 淡入动画 */
@keyframes fadeIn {
    from {
        opacity: 0;
        transform: translateX(4px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

/* 进度条光泽滑动动画 */
@keyframes progressShimmer {
    0%, 100% { background-position: 200% 0; }
    50% { background-position: 0% 0; }
}
</style>
