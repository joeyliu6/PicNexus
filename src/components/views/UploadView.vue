<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import UploadQueue from '../UploadQueue.vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import type { ServiceType } from '../../config/types';
import { PRIVATE_SERVICES, PUBLIC_SERVICES } from '../../config/types';
import { useToast } from '../../composables/useToast';
import { useUploadManager } from '../../composables/useUpload';
import { useClipboardImage } from '../../composables/useClipboardImage';
import { useQueueState } from '../../composables/useQueueState';
import { UploadQueueManager } from '../../uploadQueue';
import { RetryService } from '../../services/RetryService';
import { Store } from '../../store';

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

// 引用
const uploadQueueRef = ref<InstanceType<typeof UploadQueue>>();

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
  activePrefix: uploadManager.activePrefix,
  toast: toast,
  saveHistoryItem: uploadManager.saveHistoryItem
});

// 服务配置映射
const serviceLabels: Record<ServiceType, string> = {
  weibo: '微博',
  r2: 'R2',
  tcl: 'TCL',
  jd: '京东',
  nowcoder: '牛客',
  qiyu: '七鱼',
  zhihu: '知乎',
  nami: '纳米'
};

// 所有服务列表
const allServices: ServiceType[] = ['weibo', 'r2', 'tcl', 'jd', 'nowcoder', 'qiyu', 'zhihu', 'nami'];

// 可见的服务（在可用服务列表中的）
const visibleServices = computed(() => {
  return allServices.filter(serviceId =>
    uploadManager.availableServices.value.includes(serviceId)
  );
});

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

  if (e.dataTransfer?.files) {
    // 将 File 对象转换为路径（这在 Tauri 中不适用）
    // 实际的文件拖拽由 Tauri 的 file-drop 事件处理
    toast.info('请使用 Tauri 文件拖拽', '文件拖拽功能由 Tauri 提供');
  }
};

// 设置 Tauri 文件拖拽监听器
async function setupTauriFileDropListener() {
  try {
    // 监听文件拖拽事件
    const unlistenDrop = await listen<string[]>('tauri://file-drop', async (event) => {
      const filePaths = event.payload;
      console.log('[上传] 收到拖拽文件:', filePaths);
      await uploadManager.handleFilesUpload(filePaths);
      isDragging.value = false;
    });

    // 监听拖拽悬停事件
    const unlistenHover = await listen('tauri://file-drop-hover', () => {
      isDragging.value = true;
    });

    // 监听拖拽取消事件
    const unlistenCancelled = await listen('tauri://file-drop-cancelled', () => {
      isDragging.value = false;
    });

    fileDropUnlisteners.value = [unlistenDrop, unlistenHover, unlistenCancelled];
    console.log('[上传] Tauri 文件拖拽监听器已设置');
  } catch (error) {
    console.error('[上传] 设置 Tauri 文件拖拽监听器失败:', error);
  }
}

// 设置重试回调
const setupRetryCallback = () => {
  if (uploadQueueRef.value) {
    uploadQueueRef.value.setRetryCallback(async (itemId: string, serviceId?: ServiceType) => {
      const config = await configStore.get('config') || { services: {} };

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

// 计算属性：是否有失败项（检查整体状态和服务级别状态）
const hasFailedItems = computed(() => {
  return queueItems.value.some(item => {
    // 检查整体状态
    if (item.status === 'error') return true;
    // 检查各服务进度中是否有失败
    if (item.serviceProgress) {
      return Object.values(item.serviceProgress).some(
        progress => progress.status?.includes('失败') || progress.status?.includes('✗')
      );
    }
    return false;
  });
});

// 计算属性：队列是否有内容
const hasQueueItems = computed(() => {
  return queueItems.value.length > 0;
});

// 清空确认对话框状态
const showClearConfirm = ref(false);

// 批量重试状态
const isBatchRetrying = ref(false);

// 检查队列项是否有失败的服务
const hasFailedServices = (item: typeof queueItems.value[0]): boolean => {
  if (item.status === 'error') return true;
  if (item.serviceProgress) {
    return Object.values(item.serviceProgress).some(
      progress => progress.status?.includes('失败') || progress.status?.includes('✗')
    );
  }
  return false;
};

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
    const config = await configStore.get('config') || { services: {} };
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
      <div
        class="drop-zone"
        :class="{ dragging: isDragging }"
        @click="openFileDialog"
        @dragenter="handleDragEnter"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <div class="drop-message">
          <i class="pi pi-cloud-upload drop-icon"></i>
          <p class="drop-text">拖拽图片到此处上传</p>
          <span class="drop-hint">
            或点击选择文件，或<button
              class="paste-link"
              :disabled="isPasting"
              @click.stop="handlePasteFromClipboard"
              v-tooltip.top="'快捷键: Ctrl+V'"
            >{{ isPasting ? '正在粘贴...' : '从剪贴板粘贴' }}</button>
          </span>
        </div>
      </div>

      <!-- 图床选择区域 -->
      <div class="upload-controls">
        <!-- 公共图床 -->
        <div v-if="visiblePublicServices.length > 0" class="service-group">
          <div class="service-group-label">公共图床</div>
          <div class="service-tags-wrapper">
            <button
              v-for="serviceId in visiblePublicServices"
              :key="serviceId"
              class="service-tag"
              :class="{
                'is-selected': uploadManager.isServiceSelected.value(serviceId),
                'is-configured': uploadManager.serviceConfigStatus.value[serviceId],
                'not-configured': !uploadManager.serviceConfigStatus.value[serviceId]
              }"
              @click="toggleService(serviceId)"
              v-ripple
              v-tooltip.top="!uploadManager.serviceConfigStatus.value[serviceId] ? '请先在设置中配置' : ''"
            >
              <span class="status-dot"></span>
              <span class="tag-text">{{ serviceLabels[serviceId] }}</span>
            </button>
          </div>
        </div>

        <!-- 私有图床 -->
        <div v-if="visiblePrivateServices.length > 0" class="service-group">
          <div class="service-group-label">私有图床</div>
          <div class="service-tags-wrapper">
            <button
              v-for="serviceId in visiblePrivateServices"
              :key="serviceId"
              class="service-tag"
              :class="{
                'is-selected': uploadManager.isServiceSelected.value(serviceId),
                'is-configured': uploadManager.serviceConfigStatus.value[serviceId],
                'not-configured': !uploadManager.serviceConfigStatus.value[serviceId]
              }"
              @click="toggleService(serviceId)"
              v-ripple
              v-tooltip.top="!uploadManager.serviceConfigStatus.value[serviceId] ? '请先在设置中配置' : ''"
            >
              <span class="status-dot"></span>
              <span class="tag-text">{{ serviceLabels[serviceId] }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 上传队列 -->
      <div class="upload-queue-section">
        <div class="queue-header">
          <h3 class="queue-title">
            <i class="pi pi-list"></i>
            <span>上传队列</span>
          </h3>
          <div class="queue-actions">
            <button
              v-if="hasFailedItems"
              class="queue-action-btn retry-btn"
              :disabled="isBatchRetrying"
              @click="handleBatchRetry"
            >
              <i class="pi" :class="isBatchRetrying ? 'pi-spin pi-spinner' : 'pi-refresh'"></i>
              <span>{{ isBatchRetrying ? '重传中...' : '批量重传' }}</span>
            </button>
            <button
              v-if="hasCompletedItems"
              class="queue-action-btn clear-completed-btn"
              @click="handleClearCompleted"
            >
              <i class="pi pi-check-square"></i>
              <span>清空已完成</span>
            </button>
            <button
              v-if="hasQueueItems"
              class="queue-action-btn clear-btn"
              @click="handleClearQueue"
            >
              <i class="pi pi-trash"></i>
              <span>清空列表</span>
            </button>
          </div>
        </div>
        <UploadQueue ref="uploadQueueRef" />
      </div>
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

/* 拖拽区域 */
.drop-zone {
  background: var(--bg-card);
  border: 2px dashed var(--border-subtle);
  border-radius: 12px;
  padding: 60px 40px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
}

.drop-zone:hover {
  border-color: var(--primary);
  background: rgba(59, 130, 246, 0.05);
}

.drop-zone.dragging {
  border-color: var(--primary);
  background: rgba(59, 130, 246, 0.1);
  border-style: solid;
}

.drop-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  pointer-events: none;
}

.drop-icon {
  font-size: 3.5rem;
  color: var(--primary);
  opacity: 0.8;
}

.drop-text {
  font-size: 1.25rem;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
}

.drop-hint {
  font-size: 0.95rem;
  color: var(--text-secondary);
}

/* 剪贴板粘贴链接 */
.paste-link {
  /* 重置按钮默认样式 */
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: inherit;
  /* 链接样式 */
  color: var(--primary);
  cursor: pointer;
  transition: color 0.2s ease;
  pointer-events: auto;
}

.paste-link:hover:not(:disabled) {
  color: var(--primary-hover, #2563eb);
  text-decoration: underline;
}

.paste-link:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

/* 图床选择区域 */
.upload-controls {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.service-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.service-group-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.service-tags-wrapper {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.service-tag {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;

  height: 36px;
  padding: 0 16px;

  background-color: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;

  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  font-family: var(--font-sans);

  cursor: pointer;
  transition: all 0.15s ease-in-out;
  user-select: none;
}

/* 悬停效果（排除选中和未配置状态） */
.service-tag:hover:not(:disabled):not(.is-selected):not(.not-configured) {
  background-color: var(--hover-overlay-subtle);
  border-color: var(--text-muted);
}

/* 选中状态（固定样式，悬浮时不变） */
.service-tag.is-selected {
  background-color: rgba(59, 130, 246, 0.1);
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
}

/* 状态点 */
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--border-subtle);
}

/* 已配置（绿点） */
.service-tag.is-configured .status-dot {
  background-color: var(--success);
  box-shadow: 0 0 4px rgba(16, 185, 129, 0.4);
}

/* 未配置（黄点） */
.service-tag.not-configured .status-dot {
  background-color: var(--warning);
}

/* 未配置态（禁用） */
.service-tag.not-configured {
  opacity: 0.65;
  cursor: not-allowed;
}

.service-tag.not-configured:hover {
  background-color: var(--bg-input);
  border-color: var(--border-subtle);
}

/* 上传队列区域 */
.upload-queue-section {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 24px;
  flex: 1;
}

.queue-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.queue-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.queue-title i {
  color: var(--primary);
  font-size: 1.3rem;
}

/* 队列操作按钮区域 */
.queue-actions {
  display: flex;
  gap: 8px;
}

.queue-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  background: transparent;
}

.queue-action-btn i {
  font-size: 14px;
}

/* 重试按钮 */
.queue-action-btn.retry-btn {
  color: var(--warning);
}

.queue-action-btn.retry-btn:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.1);
}

.queue-action-btn.retry-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 清空按钮 */
.queue-action-btn.clear-btn {
  color: var(--text-muted);
}

.queue-action-btn.clear-btn:hover {
  color: var(--error);
  background: rgba(239, 68, 68, 0.1);
}

/* 清空已完成按钮 */
.queue-action-btn.clear-completed-btn {
  color: var(--text-muted);
}

.queue-action-btn.clear-completed-btn:hover {
  color: var(--success);
  background: rgba(34, 197, 94, 0.1);
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
