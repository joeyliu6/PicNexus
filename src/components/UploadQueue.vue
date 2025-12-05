<script setup lang="ts">
import { ref, computed } from 'vue';
import { writeText } from '@tauri-apps/api/clipboard';
import type { ServiceType } from '../config/types';

// 重试回调函数
let retryCallback: ((itemId: string) => void) | null = null;

const handleRetry = (itemId: string) => {
  if (retryCallback) {
    retryCallback(itemId);
  }
};

// 单个图床服务的进度状态
export interface ServiceProgress {
  serviceId: ServiceType;
  progress: number;
  status: string;
  link?: string;
  error?: string;
}

// 队列项类型（新架构 - 支持多图床）
export interface QueueItem {
  id: string;
  fileName: string;
  filePath: string;
  enabledServices?: ServiceType[];  // 启用的图床列表
  serviceProgress?: Record<ServiceType, ServiceProgress>;  // 各图床独立进度
  status: 'pending' | 'uploading' | 'success' | 'error';
  errorMessage?: string;
  thumbUrl?: string;

  // 向后兼容字段
  uploadToR2?: boolean;
  weiboProgress?: number;
  r2Progress?: number;
  weiboStatus?: string;
  r2Status?: string;
  weiboPid?: string;
  weiboLink?: string;
  r2Link?: string;
  baiduLink?: string;
}

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
  if (status.includes('%')) return 'uploading';
  return '';
};

const items = ref<QueueItem[]>([]);

const copyToClipboard = async (text: string | undefined, event: Event) => {
    if (!text) return;
    try {
        await writeText(text);
        const btn = event.target as HTMLButtonElement;
        const originalText = btn.textContent;
        btn.textContent = '✓ 已复制';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove('copied');
        }, 1500);
    } catch (err) {
        console.error('Copy failed', err);
    }
};

defineExpose({
  addFile: (item: QueueItem) => {
      // Prepend to match "newest first" behavior
      items.value.unshift(item);
  },
  updateItem: (id: string, updates: Partial<QueueItem>) => {
      const item = items.value.find(i => i.id === id);
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
  getItem: (id: string) => items.value.find(i => i.id === id),
  clear: () => items.value = [],
  count: () => items.value.length,
  setRetryCallback: (callback: (itemId: string) => void) => {
      retryCallback = callback;
  }
});
</script>

<template>
  <div class="upload-queue-vue">
    <!-- 空状态提示 -->
    <div v-if="items.length === 0" class="upload-queue-empty">
      <span class="empty-text">暂无上传队列</span>
    </div>
    
    <!-- 队列项列表 -->
    <div v-for="item in items" :key="item.id" class="upload-item" :class="[item.status, { 'upload-success': item.status === 'success', 'upload-error': item.status === 'error' }]">
      
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
      <div class="filename" :title="item.fileName">{{ item.fileName }}</div>

      <!-- Progress Column -->
      <div class="progress-section">
        <!-- 新架构：多图床动态进度条 -->
        <template v-if="item.serviceProgress && item.enabledServices">
          <div
            v-for="service in item.enabledServices"
            :key="service"
            class="progress-row"
          >
            <label>{{ serviceNames[service] }}:</label>
            <progress
              :value="item.serviceProgress[service]?.progress || 0"
              max="100"
              :class="getStatusClass(item.serviceProgress[service]?.status || '')"
            ></progress>
            <span
              class="status"
              :class="getStatusClass(item.serviceProgress[service]?.status || '')"
            >
              {{ item.serviceProgress[service]?.status || '等待中...' }}
            </span>
          </div>
        </template>

        <!-- 旧架构：向后兼容 Weibo + R2 -->
        <template v-else>
          <div class="progress-row">
            <label>微博:</label>
            <progress :value="item.weiboProgress" max="100"></progress>
            <span class="status" :class="{ success: item.weiboStatus?.includes('✓'), error: item.weiboStatus?.includes('✗') }">{{ item.weiboStatus }}</span>
          </div>
          <div class="progress-row" v-if="item.uploadToR2">
            <label>R2:</label>
            <progress :value="item.r2Progress" max="100"></progress>
            <span class="status" :class="{ success: item.r2Status?.includes('✓'), error: item.r2Status?.includes('✗'), skipped: item.r2Status === '已跳过' }">{{ item.r2Status }}</span>
          </div>
        </template>
      </div>

      <!-- Actions Column -->
      <div class="actions">
        <!-- 重试按钮（失败时显示） -->
        <button v-if="item.status === 'error'" @click="handleRetry(item.id)" class="action-btn retry-btn" title="重试上传">
          <svg class="action-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
            <path d="M8 16H3v5"/>
          </svg>
          <span>重试</span>
        </button>

        <!-- 新架构：动态显示启用服务的复制按钮 -->
        <template v-if="item.serviceProgress && item.enabledServices && item.status === 'success'">
          <button
            v-for="service in item.enabledServices"
            :key="service"
            @click="copyToClipboard(item.serviceProgress[service]?.link, $event)"
            :disabled="!item.serviceProgress[service]?.link"
            class="action-btn"
            :title="`复制 ${serviceNames[service]} 链接`"
          >
            {{ serviceNames[service] }}
          </button>
        </template>

        <!-- 旧架构：向后兼容 -->
        <template v-else-if="item.status === 'success'">
          <button @click="copyToClipboard(item.weiboLink, $event)" :disabled="!item.weiboLink" class="action-btn">微博</button>
          <button @click="copyToClipboard(item.baiduLink, $event)" :disabled="!item.baiduLink" class="action-btn">百度</button>
          <button v-if="item.uploadToR2" @click="copyToClipboard(item.r2Link, $event)" :disabled="!item.r2Link" class="action-btn">R2</button>
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
    align-items: center;
    justify-content: center;
    padding: 40px 0;
    text-align: center;
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
    padding: 10px;
    background: var(--bg-card);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    gap: 10px;
    color: var(--text-primary);
    transition: all 0.2s ease;
}

.upload-item.upload-success {
    border-left: 4px solid var(--success);
    background: rgba(16, 185, 129, 0.1);
}

.upload-item.upload-error {
    border-left: 4px solid var(--error);
    background: rgba(239, 68, 68, 0.1);
}

.preview {
    width: 50px;
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-input);
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
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

.filename {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.9em;
    font-weight: 500;
    max-width: 150px;
    color: var(--text-primary);
}

.progress-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 200px;
}

.progress-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8em;
    color: var(--text-secondary);
}

.progress-row label {
    width: 35px;
    text-align: right;
}

progress {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    /* Webkit styling for progress bar */
    -webkit-appearance: none;
    background-color: var(--bg-input);
}

progress::-webkit-progress-bar {
    background-color: var(--bg-input);
}

progress::-webkit-progress-value {
    background-color: var(--primary);
    transition: width 0.3s ease;
}

/* 颜色编码进度条 */
progress.success::-webkit-progress-value {
    background-color: var(--success);
}

progress.error::-webkit-progress-value {
    background-color: var(--error);
}

progress.uploading::-webkit-progress-value {
    background-color: var(--primary);
}

progress.skipped::-webkit-progress-value {
    background-color: var(--text-muted);
}

.status {
    width: 50px;
    text-align: right;
    font-size: 0.85em;
}

.status.success { color: var(--success); }
.status.error { color: var(--error); }
.status.uploading { color: var(--primary); }
.status.skipped { color: var(--text-muted); }

.actions {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-self: flex-start;
}

.actions button {
    padding: 4px 8px;
    font-size: 0.8em;
    cursor: pointer;
    border: 1px solid var(--border-subtle);
    background: var(--bg-input);
    color: var(--text-primary);
    border-radius: 4px;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 4px;
}

.action-btn {
    display: flex;
    align-items: center;
    gap: 4px;
}

.action-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
}

.actions button:hover:not(:disabled) {
    background: var(--primary);
    border-color: var(--primary);
    color: white;
}

.actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--bg-app);
}

.actions button.copied {
    background: var(--success);
    color: white;
    border-color: var(--success);
}

.error-icon {
    width: 24px;
    height: 24px;
    color: var(--error);
    flex-shrink: 0;
}

.retry-btn {
    background: rgba(234, 179, 8, 0.6) !important;
    border-color: rgba(234, 179, 8, 0.8) !important;
    color: rgba(255, 255, 255, 0.9) !important;
}

.retry-btn:hover {
    background: rgba(234, 179, 8, 0.8) !important;
    border-color: rgba(234, 179, 8, 1) !important;
    color: white !important;
}
</style>
