<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { UnlistenFn } from '@tauri-apps/api/event';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import type { ServiceType, UserConfig } from '../../config/types';
import { PRIVATE_SERVICES, PUBLIC_SERVICES, DEFAULT_CONFIG } from '../../config/types';
import { useToast } from '../../composables/useToast';
import { useUploadManager } from '../../composables/useUpload';
import { useClipboardImage } from '../../composables/useClipboardImage';
import { useQueueState } from '../../composables/useQueueState';
import { UploadQueueManager } from '../../uploadQueue';
import { RetryService } from '../../services/RetryService';
import { Store } from '../../store';
import type { MultiUploadResult } from '../../core/MultiServiceUploader';

import UploadDropZone from './upload/UploadDropZone.vue';
import ServiceSelector from './upload/ServiceSelector.vue';
import UploadQueuePanel from './upload/UploadQueuePanel.vue';

const toast = useToast();

// 获取全局队列状态
const { queueItems, clearQueue, clearCompletedItems, hasCompletedItems } = useQueueState();

// 创建上传队列管理器实例
const queueManager = new UploadQueueManager();

// 使用上传管理器
const uploadManager = useUploadManager(queueManager);

// 使用剪贴板图片功能
const { isProcessing: isPasting, pasteAndUpload } = useClipboardImage();

// 键盘事件处理函数（需要在 onUnmounted 中清理）
let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

const uploadQueuePanelRef = ref<InstanceType<typeof UploadQueuePanel>>();

// 文件拖拽监听器清理函数
const fileDropUnlisteners = ref<UnlistenFn[]>([]);

// 配置更新监听器清理函数
const configUnlisten = ref<UnlistenFn | null>(null);

// 配置存储
const configStore = new Store('.settings.dat');

// 创建重试服务实例
const retryService = new RetryService({
  configStore,
  queueManager,
  get activePrefix() { return uploadManager.activePrefix.value; },
  toast: toast,
  saveHistoryItem: async (filePath: string, result: MultiUploadResult) => {
    await uploadManager.saveHistoryItem(filePath, result);
  }
});

// 服务配置映射
const serviceLabels: Record<ServiceType, string> = {
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
  tencent: '腾讯云',
  aliyun: '阿里云',
  qiniu: '七牛云',
  upyun: '又拍云'
};

// 可见的私有图床
const visiblePrivateServices = computed(() => {
  return PRIVATE_SERVICES.filter(serviceId =>
    uploadManager.availableServices.value.includes(serviceId)
  );
});

// 可见的公共图床
const visiblePublicServices = computed(() => {
  return PUBLIC_SERVICES.filter(serviceId =>
    uploadManager.availableServices.value.includes(serviceId)
  );
});

// 处理服务选择切换
const toggleService = (serviceId: ServiceType) => {
  // 检查是否已配置
  if (!uploadManager.serviceConfigStatus.value[serviceId]) {
    toast.warn('未配置', `${serviceLabels[serviceId]} 图床未配置，请先在设置中配置`);
    return;
  }

  // 切换选择
  uploadManager.toggleServiceSelection(serviceId);
};

// 打开文件选择对话框
const openFileDialog = async () => {
  const filePaths = await uploadManager.selectFiles();
  if (filePaths && filePaths.length > 0) {
    await uploadManager.handleFilesUpload(filePaths);
  }
};

// 从剪贴板粘贴图片
const handlePasteFromClipboard = async () => {
  await pasteAndUpload(uploadManager.handleFilesUpload);
};

// 拖拽相关
const isDragging = ref(false);

const handleDragEnter = (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = true;
};

const handleDragOver = (e: DragEvent) => {
  e.preventDefault();
};

const handleDragLeave = (e: DragEvent) => {
  e.preventDefault();
  // 只有当离开 drop-zone 本身时才取消拖拽状态
  if (e.currentTarget === e.target) {
    isDragging.value = false;
  }
};

const handleDrop = (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = false;
};

// 设置 Tauri 文件拖拽监听器（Tauri v2 API）
async function setupTauriFileDropListener() {
  try {
    const webview = getCurrentWebview();
    // Tauri v2 使用 onDragDropEvent 统一监听所有拖拽事件
    const unlisten = await webview.onDragDropEvent(async (event) => {
      if (event.payload.type === 'over') {
        // 悬停状态
        isDragging.value = true;
      } else if (event.payload.type === 'drop') {
        // 放下文件
        const filePaths = event.payload.paths;
        console.log('[上传] 收到拖拽文件:', filePaths);
        await uploadManager.handleFilesUpload(filePaths);
        isDragging.value = false;
      } else {
        // 取消拖拽 (leave 或其他)
        isDragging.value = false;
      }
    });

    fileDropUnlisteners.value = [unlisten];
    console.log('[上传] Tauri 文件拖拽监听器已设置 (v2 API)');
  } catch (error) {
    console.error('[上传] 设置 Tauri 文件拖拽监听器失败:', error);
  }
}

// 设置重试回调
const setupRetryCallback = () => {
  if (uploadQueuePanelRef.value) {
    uploadQueuePanelRef.value.setRetryCallback(async (itemId: string, serviceId?: ServiceType) => {
      const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;

      if (serviceId) {
        // 单个服务重试
        await retryService.retrySingleService(itemId, serviceId, config);
      } else {
        // 全量重试
        await retryService.retryAll(itemId, config);
      }
    });
  }
};

const hasFailedServices = (item: typeof queueItems.value[0]): boolean => {
  if (item.status === 'error') return true;
  if (item.serviceProgress) {
    return Object.values(item.serviceProgress).some(
      progress => progress.status?.includes('失败') || progress.status?.includes('✗')
    );
  }
  return false;
};

const hasFailedItems = computed(() => {
  return queueItems.value.some(hasFailedServices);
});

// 计算属性：队列是否有内容
const hasQueueItems = computed(() => {
  return queueItems.value.length > 0;
});

// 清空确认对话框状态
const showClearConfirm = ref(false);

// 批量重试状态
const isBatchRetrying = ref(false);

// 批量重试所有失败项
const handleBatchRetry = async () => {
  if (isBatchRetrying.value) return;

  const failedItemIds = queueItems.value
    .filter(item => hasFailedServices(item))
    .map(item => item.id);

  if (failedItemIds.length === 0) {
    toast.info('无需重试', '没有失败的上传项');
    return;
  }

  isBatchRetrying.value = true;
  try {
    const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;
    await retryService.retryAllFailed(failedItemIds, config);
  } finally {
    isBatchRetrying.value = false;
  }
};

// 显示清空确认对话框
const handleClearQueue = () => {
  showClearConfirm.value = true;
};

// 确认清空队列
const confirmClearQueue = () => {
  clearQueue();
  showClearConfirm.value = false;
  toast.success('已清空', '上传队列已清空');
};

// 清空已完成的队列项（无需确认，不影响进行中的上传）
const handleClearCompleted = () => {
  clearCompletedItems();
  toast.success('已清空', '已完成的上传项已清理');
};

// 加载配置
onMounted(async () => {
  // 加载服务按钮状态
  await uploadManager.loadServiceButtonStates();
  console.log('[UploadView] 服务按钮状态已加载');

  // 设置配置更新监听器（设置页面修改配置后自动刷新）
  configUnlisten.value = await uploadManager.setupConfigListener();
  console.log('[UploadView] 配置更新监听器已设置');

  // 设置文件拖拽监听
  await setupTauriFileDropListener();

  // 设置重试回调
  await nextTick();
  setupRetryCallback();

  // 设置 Ctrl+V / Cmd+V 快捷键监听
  keydownHandler = async (e: KeyboardEvent) => {
    // 检测 Ctrl+V (Windows/Linux) 或 Cmd+V (Mac)
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      // 排除输入框，避免干扰正常的文本粘贴
      const tagName = (e.target as HTMLElement)?.tagName?.toUpperCase();
      if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
        return;
      }
      // 阻止默认行为并处理粘贴
      e.preventDefault();
      await handlePasteFromClipboard();
    }
  };
  window.addEventListener('keydown', keydownHandler);
  console.log('[UploadView] Ctrl+V 快捷键监听已设置');
});

// 组件卸载时清理监听器
onUnmounted(() => {
  // 清理配置更新监听器
  if (configUnlisten.value) {
    configUnlisten.value();
    configUnlisten.value = null;
  }

  // 清理所有文件拖拽监听器
  fileDropUnlisteners.value.forEach(unlisten => unlisten());
  fileDropUnlisteners.value = [];

  // 清理键盘监听器
  if (keydownHandler) {
    window.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }
});
</script>

<template>
  <div class="upload-view">
    <div class="upload-container">
      <!-- 拖拽区域 -->
      <UploadDropZone
        :is-dragging="isDragging"
        :is-pasting="isPasting"
        @click="openFileDialog"
        @paste="handlePasteFromClipboard"
        @drag-enter="handleDragEnter"
        @drag-over="handleDragOver"
        @drag-leave="handleDragLeave"
        @drop="handleDrop"
      />

      <!-- 图床选择区域 -->
      <ServiceSelector
        :public-services="visiblePublicServices"
        :private-services="visiblePrivateServices"
        :service-labels="serviceLabels"
        :service-config-status="uploadManager.serviceConfigStatus.value"
        :is-service-selected="uploadManager.isServiceSelected.value"
        @toggle="toggleService"
      />

      <!-- 上传队列 -->
      <UploadQueuePanel
        ref="uploadQueuePanelRef"
        :has-failed-items="hasFailedItems"
        :has-completed-items="hasCompletedItems"
        :has-queue-items="hasQueueItems"
        :is-batch-retrying="isBatchRetrying"
        @batch-retry="handleBatchRetry"
        @clear-completed="handleClearCompleted"
        @clear-queue="handleClearQueue"
      />
    </div>

    <!-- 清空确认对话框 -->
    <Dialog
      v-model:visible="showClearConfirm"
      header="确认清空"
      :modal="true"
      :closable="true"
      :style="{ width: '360px' }"
    >
      <div class="confirm-content">
        <i class="pi pi-exclamation-triangle confirm-icon"></i>
        <p>确定要清空上传队列吗？此操作不可恢复。</p>
      </div>
      <template #footer>
        <Button
          label="取消"
          severity="secondary"
          text
          @click="showClearConfirm = false"
        />
        <Button
          label="确定清空"
          severity="danger"
          @click="confirmClearQueue"
        />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.upload-view {
  height: 100%;
  overflow-y: auto;
  padding: 20px;
  background: var(--bg-app);
}

.upload-container {
  max-width: 850px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 确认对话框内容 */
.confirm-content {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px 0;
}

.confirm-content .confirm-icon {
  color: var(--warning);
  font-size: 1.5rem;
  flex-shrink: 0;
}

.confirm-content p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* 滚动条 */
.upload-view::-webkit-scrollbar {
  width: 8px;
}

.upload-view::-webkit-scrollbar-track {
  background: var(--bg-input);
}

.upload-view::-webkit-scrollbar-thumb {
  background: var(--border-subtle);
  border-radius: 4px;
}

.upload-view::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}
</style>
