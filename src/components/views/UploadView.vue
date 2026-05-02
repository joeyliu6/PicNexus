<script setup lang="ts">
import { ref, onMounted, onUnmounted, onActivated, onDeactivated, computed, nextTick } from 'vue';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { emit as tauriEmit, type UnlistenFn } from '@tauri-apps/api/event';
import { useConfirm } from '../../composables/useConfirm';
import type { UserConfig, CustomS3Profile } from '../../config/types';
import { PRIVATE_SERVICES, PUBLIC_SERVICES, DEFAULT_CONFIG, makeCustomS3Id } from '../../config/types';
import { useToast } from '../../composables/useToast';
import { useServiceHealth } from '../../composables/useServiceHealth';
import { useUploadManager } from '../../composables/useUpload';
import { useClipboardImage } from '../../composables/useClipboardImage';
import { useUrlDownload } from '../../composables/useUrlDownload';
import { useQueueState } from '../../composables/useQueueState';
import { UploadQueueManager } from '../../uploadQueue';
import { RetryService } from '../../services/RetryService';
import { configStore } from '../../store/instances';
import { useConfigManager } from '../../composables/useConfig';
import type { MultiUploadResult } from '../../core/MultiServiceUploader';
import type { ImageCompressionConfig, CompressionPreset } from '../../config/types';
import { DEFAULT_COMPRESSION_PRESET } from '../../config/types';
import { createLogger } from '../../utils/logger';

const log = createLogger('UploadView');

import UploadDropZone from './upload/UploadDropZone.vue';
import ServiceSelector from './upload/ServiceSelector.vue';
import UploadQueuePanel from './upload/UploadQueuePanel.vue';
import UrlDownloadDialog from '../dialogs/UrlDownloadDialog.vue';

const toast = useToast();
const { healthStatusMap, healthTooltipMap, loadHealthStatus, evaluateConfig } = useServiceHealth();
const { showConfirm } = useConfirm();

// 获取全局队列状态
const { queueItems, clearQueue, clearCompletedItems, hasCompletedItems } = useQueueState();

// 创建上传队列管理器实例
const queueManager = new UploadQueueManager();

// 使用上传管理器
const uploadManager = useUploadManager(queueManager);

// 使用剪贴板图片功能
const { isProcessing: isPasting, pasteAndUpload } = useClipboardImage();

// 使用 URL 下载功能
const { isDownloading, downloadAndUpload } = useUrlDownload();
const showUrlDialog = ref(false);

// 键盘事件处理函数（需要在 onUnmounted 中清理）
let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

const uploadQueuePanelRef = ref<InstanceType<typeof UploadQueuePanel>>();

// 文件拖拽监听器清理函数
const fileDropUnlisteners = ref<UnlistenFn[]>([]);

// 配置更新监听器清理函数
const configUnlisten = ref<UnlistenFn | null>(null);

// 压缩配置（与全局 configStore 双向同步）
const compressionConfig = ref<ImageCompressionConfig>(DEFAULT_CONFIG.imageCompression!);

// 创建重试服务实例
const retryService = new RetryService({
  configStore,
  queueManager,
  toast: toast,
  saveHistoryItem: async (filePath: string, result: MultiUploadResult) => {
    await uploadManager.saveHistoryItem(filePath, result);
  }
});

// 自定义 S3 profiles（从 configStore 同步）
const customS3Profiles = ref<CustomS3Profile[]>([]);

// 服务配置映射（动态合并自定义 S3 profiles 名称）
const serviceLabels = computed<Record<string, string>>(() => {
  const base: Record<string, string> = {
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
    upyun: '又拍云',
  };
  for (const profile of customS3Profiles.value) {
    base[makeCustomS3Id(profile.id)] = profile.name || '自定义 S3';
  }
  return base;
});

// 过滤可见的图床服务（需在 availableServices 中且非未配置状态）
const filterVisibleServices = (services: string[]) =>
  services.filter(s =>
    uploadManager.availableServices.value.includes(s) &&
    healthStatusMap.value[s] !== 'unconfigured'
  );

// 可见的私有存储（含自定义 S3）
const visiblePrivateServices = computed(() => {
  const customIds = customS3Profiles.value.map(p => makeCustomS3Id(p.id));
  return filterVisibleServices([...PRIVATE_SERVICES, ...customIds]);
});

// 可见的公共图床
const visiblePublicServices = computed(() => filterVisibleServices(PUBLIC_SERVICES));

// 当前激活的预设（计算属性）
const activePreset = computed<CompressionPreset>(() => {
  const cfg = compressionConfig.value;
  return cfg.presets?.find(p => p.id === cfg.activePresetId)
    ?? cfg.presets?.[0]
    ?? { ...DEFAULT_COMPRESSION_PRESET };
});

// 压缩配置写回 configStore（与设置页同步）
async function handleCompressionToggle(enabled: boolean) {
  compressionConfig.value = { ...compressionConfig.value, enabled };
  await saveCompressionConfig();
}

async function handlePresetSwitch(presetId: string) {
  compressionConfig.value = { ...compressionConfig.value, activePresetId: presetId };
  await saveCompressionConfig();
}

const configManager = useConfigManager();

async function saveCompressionConfig() {
  try {
    const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;
    config.imageCompression = { ...compressionConfig.value };
    await configManager.saveConfig(config, true);
  } catch {
    // 静默保存失败不打扰用户
  }
}

const navigateToSettings = () => {
  tauriEmit('navigate-to', { view: 'settings', tab: 'hosting' });
};

const navigateToServiceSettings = (serviceId: string) => {
  tauriEmit('navigate-to', { view: 'settings', tab: 'hosting', section: serviceId });
};

const navigateToCompressionSettings = () => {
  tauriEmit('navigate-to', { view: 'settings', tab: 'compression', section: 'imageCompression' });
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

// URL 下载相关
const handleUrlDownloadClick = () => {
  showUrlDialog.value = true;
};

const handleUrlConfirm = async (input: string) => {
  showUrlDialog.value = false;
  await downloadAndUpload(input, uploadManager.handleFilesUpload);
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

// KeepAlive 激活状态标记，防止后台页面拦截拖放事件
const isViewActive = ref(true);

// 设置 Tauri 文件拖拽监听器（Tauri v2 API）
async function setupTauriFileDropListener() {
  try {
    const webview = getCurrentWebview();
    // Tauri v2 使用 onDragDropEvent 统一监听所有拖拽事件
    const unlisten = await webview.onDragDropEvent(async (event) => {
      // KeepAlive 缓存时跳过，避免与其他页面的拖放冲突
      if (!isViewActive.value) return;

      if (event.payload.type === 'over') {
        // 悬停状态
        isDragging.value = true;
      } else if (event.payload.type === 'drop') {
        // 放下文件
        const filePaths = event.payload.paths;
        log.info('收到拖拽文件:', filePaths);
        await uploadManager.handleFilesUpload(filePaths);
        isDragging.value = false;
      } else {
        // 取消拖拽 (leave 或其他)
        isDragging.value = false;
      }
    });

    fileDropUnlisteners.value = [unlisten];
    log.info('Tauri 文件拖拽监听器已设置 (v2 API)');
  } catch (error) {
    log.error('设置 Tauri 文件拖拽监听器失败:', error);
  }
}

// 设置重试回调
const setupRetryCallback = () => {
  if (uploadQueuePanelRef.value) {
    uploadQueuePanelRef.value.setRetryCallback(async (itemId: string, serviceId?: string) => {
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
      progress => progress?.status?.includes('失败') || progress?.status?.includes('✗')
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

// 队列统计：总数和已完成数（用于进度指示）
const queueTotal = computed(() => queueItems.value.length);
const queueDone = computed(() =>
  queueItems.value.filter(i => i.status === 'success' || i.status === 'error').length
);

// 清空确认对话框状态

// 批量重试状态
const isBatchRetrying = ref(false);

// 批量重试所有失败项
const handleBatchRetry = async () => {
  if (isBatchRetrying.value) return;

  const failedItemIds = queueItems.value
    .filter(item => hasFailedServices(item))
    .map(item => item.id);

  if (failedItemIds.length === 0) return;

  isBatchRetrying.value = true;
  try {
    const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;
    await retryService.retryAllFailed(failedItemIds, config);
  } finally {
    isBatchRetrying.value = false;
  }
};

// 清空队列（带确认）
const handleClearQueue = () => {
  showConfirm({
    header: '确认清空',
    message: '确定要清空上传队列吗？此操作不可撤销。',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: '清空',
    rejectLabel: '取消',
    acceptClass: 'p-button-danger',
    accept: () => {
      clearQueue();
    }
  });
};

// 清空已完成的队列项（无需确认，不影响进行中的上传）
const handleClearCompleted = () => {
  clearCompletedItems();
};

// 加载配置
onMounted(async () => {
  // 加载服务按钮状态
  await uploadManager.loadServiceButtonStates();
  log.info('服务按钮状态已加载');

  // 初始化图床健康状态（与设置页同步）
  await loadHealthStatus();
  const config = await configStore.get<UserConfig>('config');
  if (config) {
    evaluateConfig(config);
    if (config.imageCompression) {
      compressionConfig.value = config.imageCompression;
    }
  }

  // 设置配置更新监听器（设置页面修改配置后自动刷新）
  configUnlisten.value = await uploadManager.setupConfigListener();

  // 监听配置变更，同步压缩配置（设置页改动后上传页自动更新）
  const { listen } = await import('@tauri-apps/api/event');
  const compressionUnlisten = await listen('config-updated', async () => {
    const updated = await configStore.get<UserConfig>('config');
    if (updated?.imageCompression) {
      compressionConfig.value = updated.imageCompression;
    }
  });
  // 将清理函数挂到已有的 configUnlisten 上
  const originalUnlisten = configUnlisten.value;
  configUnlisten.value = () => {
    originalUnlisten?.();
    compressionUnlisten();
  };

  log.info('配置更新监听器已设置');

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
  log.info('Ctrl+V 快捷键监听已设置');
});

onActivated(() => { isViewActive.value = true; });
onDeactivated(() => { isViewActive.value = false; });

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
        :is-downloading="isDownloading"
        :compression-enabled="compressionConfig.enabled"
        :active-preset="activePreset"
        :presets="compressionConfig.presets ?? []"
        @click="openFileDialog"
        @paste="handlePasteFromClipboard"
        @url-download="handleUrlDownloadClick"
        @drag-enter="handleDragEnter"
        @drag-over="handleDragOver"
        @drag-leave="handleDragLeave"
        @drop="handleDrop"
        @update:compression-enabled="handleCompressionToggle"
        @update:active-preset-id="handlePresetSwitch"
        @go-compression-settings="navigateToCompressionSettings"
      />

      <!-- 图床选择区域 -->
      <ServiceSelector
        :public-services="visiblePublicServices"
        :private-services="visiblePrivateServices"
        :service-labels="serviceLabels"
        :is-service-selected="uploadManager.isServiceSelected.value"
        :service-health-map="healthStatusMap"
        :service-health-tooltip-map="healthTooltipMap"
        @toggle="uploadManager.toggleServiceSelection"
        @go-settings="navigateToSettings"
        @go-service-settings="navigateToServiceSettings"
      />

      <!-- 上传队列 -->
      <UploadQueuePanel
        ref="uploadQueuePanelRef"
        :has-failed-items="hasFailedItems"
        :has-completed-items="hasCompletedItems"
        :has-queue-items="hasQueueItems"
        :is-batch-retrying="isBatchRetrying"
        :queue-total="queueTotal"
        :queue-done="queueDone"
        @batch-retry="handleBatchRetry"
        @clear-completed="handleClearCompleted"
        @clear-queue="handleClearQueue"
      />
    </div>

    <!-- URL 下载对话框 -->
    <UrlDownloadDialog
      v-model:visible="showUrlDialog"
      :is-downloading="isDownloading"
      @confirm="handleUrlConfirm"
    />
  </div>
</template>

<style scoped>
.upload-view {
  height: 100%;
  overflow-y: auto;
  padding: var(--space-lg-xl);
  background: var(--bg-app);
}

.upload-container {
  max-width: 850px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-lg-xl);
}

/* 滚动条 */
.upload-view::-webkit-scrollbar-track {
  background: var(--bg-input);
}
</style>
