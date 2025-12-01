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
  nami: '纳米',
  jd: '京东',
  nowcoder: '牛客'
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
        <img v-if="item.thumbUrl" :src="item.thumbUrl" :alt="item.fileName" class="thumb-img" onerror="this.style.display='none'">
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
            <svg v-if="service === 'weibo'" class="action-icon" viewBox="0 0 1138 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
              <path d="M914.432 518.144q27.648 21.504 38.912 51.712t9.216 62.976-14.336 65.536-31.744 59.392q-34.816 48.128-78.848 81.92t-91.136 56.32-94.72 35.328-89.6 18.944-75.264 7.68-51.712 1.536-49.152-2.56-68.096-10.24-78.336-21.504-79.872-36.352-74.24-55.296-59.904-78.848q-16.384-29.696-22.016-63.488t-5.632-86.016q0-22.528 7.68-51.2t27.136-63.488 53.248-75.776 86.016-90.112q51.2-48.128 105.984-85.504t117.248-57.856q28.672-10.24 63.488-11.264t57.344 11.264q10.24 11.264 19.456 23.04t12.288 29.184q3.072 14.336 0.512 27.648t-5.632 26.624-5.12 25.6 2.048 22.528q17.408 2.048 33.792-1.536t31.744-9.216 31.232-11.776 33.28-9.216q27.648-5.12 54.784-4.608t49.152 7.68 36.352 22.016 17.408 38.4q2.048 14.336-2.048 26.624t-8.704 23.04-7.168 22.016 1.536 23.552q3.072 7.168 14.848 13.312t27.136 12.288 32.256 13.312 29.184 16.384zM656.384 836.608q26.624-16.384 53.76-45.056t44.032-64 18.944-75.776-20.48-81.408q-19.456-33.792-47.616-57.344t-62.976-37.376-74.24-19.968-80.384-6.144q-78.848 0-139.776 16.384t-105.472 43.008-72.192 60.416-38.912 68.608q-11.264 33.792-6.656 67.072t20.992 62.976 42.496 53.248 57.856 37.888q58.368 25.6 119.296 32.256t116.224 0.512 100.864-21.504 74.24-33.792zM522.24 513.024q20.48 8.192 38.912 18.432t32.768 27.648q10.24 12.288 17.92 30.72t10.752 39.424 1.536 42.496-9.728 38.912q-8.192 18.432-19.968 37.376t-28.672 35.328-40.448 29.184-57.344 18.944q-61.44 11.264-117.76-11.264t-88.064-74.752q-12.288-39.936-13.312-70.656t16.384-66.56q13.312-27.648 40.448-51.712t62.464-38.912 75.264-17.408 78.848 12.8zM359.424 764.928q37.888 3.072 57.856-18.432t21.504-48.128-15.36-47.616-52.736-16.896q-27.648 3.072-43.008 23.552t-17.408 43.52 9.728 42.496 39.424 21.504zM778.24 6.144q74.752 0 139.776 19.968t113.664 57.856 76.288 92.16 27.648 122.88q0 33.792-16.384 50.688t-35.328 17.408-35.328-14.336-16.384-45.568q0-40.96-22.528-77.824t-59.392-64.512-84.48-43.52-96.768-15.872q-31.744 0-47.104-15.36t-14.336-34.304 18.944-34.304 51.712-15.36zM778.24 169.984q95.232 0 144.384 48.64t49.152 146.944q0 30.72-10.24 43.52t-22.528 11.264-22.528-14.848-10.24-35.84q0-60.416-34.816-96.256t-93.184-35.84q-19.456 0-28.672-10.752t-9.216-23.04 9.728-23.04 28.16-10.752z" fill="currentColor"></path>
            </svg>
            <svg v-else-if="service === 'r2'" class="action-icon" viewBox="0 0 1280 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
              <path d="M796.82375 631.836875l-432.75-5.49a8.5875 8.5875 0 0 1-6.81-3.61125 8.715 8.715 0 0 1-0.92625-7.775625 11.518125 11.518125 0 0 1 10.051875-7.6425l436.7625-5.505c51.808125-2.3625 107.89875-44.20125 127.54125-95.22l24.91125-64.76625a14.895 14.895 0 0 0 0.9825-5.505 14.503125 14.503125 0 0 0-0.3075-3.058125A284.83125 284.83125 0 0 0 409.356875 404 127.725 127.725 0 0 0 208.625 537.48125C110.6075 540.32375 32 620.24 32 718.475a180.10125 180.10125 0 0 0 1.929375 26.17125 8.4525 8.4525 0 0 0 8.334375 7.258125l798.9375 0.095625c0.080625 0 0.15-0.035625 0.22875-0.0375a10.51125 10.51125 0 0 0 9.883125-7.5l6.136875-21.121875c7.3125-25.125 4.59-48.375-7.6875-65.4375-11.28-15.735-30.09375-24.99-52.93875-26.06625z m198.65625-185.274375c-4.014375 0-8.008125 0.11625-11.983125 0.3075a7.070625 7.070625 0 0 0-6.2325 4.974375l-17.019375 58.486875c-7.3125 25.125-4.591875 48.34875 7.6875 65.41875 11.2875 15.75 30.10125 24.980625 52.94625 26.0625l92.25 5.510625a8.420625 8.420625 0 0 1 6.58125 3.55125 8.7 8.7 0 0 1 0.96375 7.816875 11.536875 11.536875 0 0 1-10.033125 7.640625l-95.859375 5.510625c-52.03875 2.38125-108.129375 44.20125-127.771875 95.22l-6.928125 18.01125a5.0925 5.0925 0 0 0 4.550625 6.9c0.08625 0 0.165 0.031875 0.255 0.031875h329.83125a8.79375 8.79375 0 0 0 8.510625-6.31875 234.013125 234.013125 0 0 0 8.77875-63.75C1232 551.9375 1126.1075 446.5625 995.48 446.5625z" fill="currentColor"></path>
            </svg>
            <svg v-else-if="service === 'tcl'" class="action-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span>{{ serviceNames[service] }}</span>
          </button>
        </template>

        <!-- 旧架构：向后兼容 -->
        <template v-else-if="item.status === 'success'">
          <button @click="copyToClipboard(item.weiboLink, $event)" :disabled="!item.weiboLink" class="action-btn">
            <svg class="action-icon" viewBox="0 0 1138 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
              <path d="M914.432 518.144q27.648 21.504 38.912 51.712t9.216 62.976-14.336 65.536-31.744 59.392q-34.816 48.128-78.848 81.92t-91.136 56.32-94.72 35.328-89.6 18.944-75.264 7.68-51.712 1.536-49.152-2.56-68.096-10.24-78.336-21.504-79.872-36.352-74.24-55.296-59.904-78.848q-16.384-29.696-22.016-63.488t-5.632-86.016q0-22.528 7.68-51.2t27.136-63.488 53.248-75.776 86.016-90.112q51.2-48.128 105.984-85.504t117.248-57.856q28.672-10.24 63.488-11.264t57.344 11.264q10.24 11.264 19.456 23.04t12.288 29.184q3.072 14.336 0.512 27.648t-5.632 26.624-5.12 25.6 2.048 22.528q17.408 2.048 33.792-1.536t31.744-9.216 31.232-11.776 33.28-9.216q27.648-5.12 54.784-4.608t49.152 7.68 36.352 22.016 17.408 38.4q2.048 14.336-2.048 26.624t-8.704 23.04-7.168 22.016 1.536 23.552q3.072 7.168 14.848 13.312t27.136 12.288 32.256 13.312 29.184 16.384zM656.384 836.608q26.624-16.384 53.76-45.056t44.032-64 18.944-75.776-20.48-81.408q-19.456-33.792-47.616-57.344t-62.976-37.376-74.24-19.968-80.384-6.144q-78.848 0-139.776 16.384t-105.472 43.008-72.192 60.416-38.912 68.608q-11.264 33.792-6.656 67.072t20.992 62.976 42.496 53.248 57.856 37.888q58.368 25.6 119.296 32.256t116.224 0.512 100.864-21.504 74.24-33.792zM522.24 513.024q20.48 8.192 38.912 18.432t32.768 27.648q10.24 12.288 17.92 30.72t10.752 39.424 1.536 42.496-9.728 38.912q-8.192 18.432-19.968 37.376t-28.672 35.328-40.448 29.184-57.344 18.944q-61.44 11.264-117.76-11.264t-88.064-74.752q-12.288-39.936-13.312-70.656t16.384-66.56q13.312-27.648 40.448-51.712t62.464-38.912 75.264-17.408 78.848 12.8zM359.424 764.928q37.888 3.072 57.856-18.432t21.504-48.128-15.36-47.616-52.736-16.896q-27.648 3.072-43.008 23.552t-17.408 43.52 9.728 42.496 39.424 21.504zM778.24 6.144q74.752 0 139.776 19.968t113.664 57.856 76.288 92.16 27.648 122.88q0 33.792-16.384 50.688t-35.328 17.408-35.328-14.336-16.384-45.568q0-40.96-22.528-77.824t-59.392-64.512-84.48-43.52-96.768-15.872q-31.744 0-47.104-15.36t-14.336-34.304 18.944-34.304 51.712-15.36zM778.24 169.984q95.232 0 144.384 48.64t49.152 146.944q0 30.72-10.24 43.52t-22.528 11.264-22.528-14.848-10.24-35.84q0-60.416-34.816-96.256t-93.184-35.84q-19.456 0-28.672-10.752t-9.216-23.04 9.728-23.04 28.16-10.752z" fill="currentColor"></path>
            </svg>
            <span>微博</span>
          </button>
          <button @click="copyToClipboard(item.baiduLink, $event)" :disabled="!item.baiduLink" class="action-btn">
            <svg class="action-icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
              <path d="M226.522 536.053c96.993-20.839 83.792-136.761 80.878-162.089-4.758-39.065-50.691-107.346-113.075-101.952-78.499 7.036-89.957 120.445-89.957 120.445C93.748 444.857 129.764 556.857 226.522 536.053zM329.512 737.61c-2.848 8.175-9.18 29.014-3.686 47.173 10.822 40.707 46.168 42.55 46.168 42.55l50.792 0L422.786 703.169 368.41 703.169C343.952 710.473 332.159 729.468 329.512 737.61zM406.537 341.666c53.572 0 96.859-61.646 96.859-137.9 0-76.12-43.287-137.767-96.859-137.767-53.472 0-96.892 61.646-96.892 137.767C309.645 280.019 353.065 341.666 406.537 341.666zM637.241 350.779c71.598 9.281 117.632-67.141 126.777-125.035 9.349-57.827-36.854-125.036-87.544-136.561-50.791-11.659-114.213 69.688-119.976 122.757C549.597 276.803 565.779 341.566 637.241 350.779zM812.666 691.174c0 0-110.761-85.701-175.425-178.305-87.645-136.593-212.177-81.011-253.822-11.558-41.478 69.452-106.106 113.375-115.286 125-9.314 11.458-133.813 78.666-106.173 201.423 27.64 122.69 124.7 120.345 124.7 120.345s71.53 7.036 154.519-11.524c83.021-18.428 154.484 4.59 154.484 4.59s193.919 64.929 246.988-60.072C895.655 756.037 812.666 691.174 812.666 691.174zM480.881 877.253 354.807 877.253c-54.443-10.855-76.12-48.044-78.867-54.343-2.68-6.433-18.125-36.317-9.951-87.109 23.52-76.12 90.627-81.614 90.627-81.614l67.107 0 0-82.485 57.157 0.871L480.88 877.253zM715.674 876.382l-145.07 0c-56.219-14.508-58.866-54.444-58.866-54.444L511.738 661.49l58.866-0.938 0 144.199c3.586 15.345 22.682 18.159 22.682 18.159l59.771 0L653.057 661.49l62.618 0L715.675 876.382zM921.051 448.006c0-27.708-23.018-111.13-108.385-111.13-85.501 0-96.925 78.732-96.925 134.382 0 53.136 4.489 127.313 110.695 124.935C932.677 593.846 921.051 475.881 921.051 448.006z" fill="currentColor"></path>
            </svg>
            <span>百度</span>
          </button>
          <button v-if="item.uploadToR2" @click="copyToClipboard(item.r2Link, $event)" :disabled="!item.r2Link" class="action-btn">
            <svg class="action-icon" viewBox="0 0 1280 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
              <path d="M796.82375 631.836875l-432.75-5.49a8.5875 8.5875 0 0 1-6.81-3.61125 8.715 8.715 0 0 1-0.92625-7.775625 11.518125 11.518125 0 0 1 10.051875-7.6425l436.7625-5.505c51.808125-2.3625 107.89875-44.20125 127.54125-95.22l24.91125-64.76625a14.895 14.895 0 0 0 0.9825-5.505 14.503125 14.503125 0 0 0-0.3075-3.058125A284.83125 284.83125 0 0 0 409.356875 404 127.725 127.725 0 0 0 208.625 537.48125C110.6075 540.32375 32 620.24 32 718.475a180.10125 180.10125 0 0 0 1.929375 26.17125 8.4525 8.4525 0 0 0 8.334375 7.258125l798.9375 0.095625c0.080625 0 0.15-0.035625 0.22875-0.0375a10.51125 10.51125 0 0 0 9.883125-7.5l6.136875-21.121875c7.3125-25.125 4.59-48.375-7.6875-65.4375-11.28-15.735-30.09375-24.99-52.93875-26.06625z m198.65625-185.274375c-4.014375 0-8.008125 0.11625-11.983125 0.3075a7.070625 7.070625 0 0 0-6.2325 4.974375l-17.019375 58.486875c-7.3125 25.125-4.591875 48.34875 7.6875 65.41875 11.2875 15.75 30.10125 24.980625 52.94625 26.0625l92.25 5.510625a8.420625 8.420625 0 0 1 6.58125 3.55125 8.7 8.7 0 0 1 0.96375 7.816875 11.536875 11.536875 0 0 1-10.033125 7.640625l-95.859375 5.510625c-52.03875 2.38125-108.129375 44.20125-127.771875 95.22l-6.928125 18.01125a5.0925 5.0925 0 0 0 4.550625 6.9c0.08625 0 0.165 0.031875 0.255 0.031875h329.83125a8.79375 8.79375 0 0 0 8.510625-6.31875 234.013125 234.013125 0 0 0 8.77875-63.75C1232 551.9375 1126.1075 446.5625 995.48 446.5625z" fill="currentColor"></path>
            </svg>
            <span>R2</span>
          </button>
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
    gap: 5px;
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
