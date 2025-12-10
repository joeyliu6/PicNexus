<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import UploadQueue from '../UploadQueue.vue';
import type { ServiceType, UserConfig } from '../../config/types';
import { DEFAULT_CONFIG } from '../../config/types';
import { useToast } from '../../composables/useToast';
import { useUploadManager } from '../../composables/useUpload';
import { UploadQueueManager } from '../../uploadQueue';
import { MultiServiceUploader } from '../../core/MultiServiceUploader';
import { Store } from '../../store';

const toast = useToast();

// 创建上传队列管理器实例
const queueManager = new UploadQueueManager();

// 使用上传管理器
const uploadManager = useUploadManager(queueManager);

// 引用
const uploadQueueRef = ref<InstanceType<typeof UploadQueue>>();

// 文件拖拽监听器清理函数
const fileDropUnlisteners = ref<UnlistenFn[]>([]);

// 新增：重试并发控制
const retryingItems = ref<Set<string>>(new Set());

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
      const item = queueManager.getItem(itemId);
      if (!item) {
        toast.error('重试失败', '找不到队列项');
        return;
      }

      // === Case 1: Single Service Retry ===
      if (serviceId) {
        console.log(`[重试] 单独重试 ${item.fileName} -> ${serviceId}`);

        // Check concurrency for this specific service on this item
        const retryKey = `${itemId}-${serviceId}`;
        if (retryingItems.value.has(retryKey)) {
          console.warn(`[重试] ${item.fileName}-${serviceId} 已在重试中，跳过`);
          return;
        }

        // Reset UI state for this service
        queueManager.resetServiceForRetry(itemId, serviceId);
        retryingItems.value.add(retryKey);

        try {
          const uploader = new MultiServiceUploader();
          const configStore = new Store('.settings.dat');
          const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;

          const result = await uploader.retryUpload(
            item.filePath,
            serviceId,
            config,
            (percent) => {
              // Update progress bar
              queueManager.updateServiceProgress(itemId, serviceId, percent);
            }
          );

          // Handle Success
          const updates = { ...item.serviceProgress };
          let link = result.url;
          if (serviceId === 'weibo' && uploadManager.activePrefix.value) {
            link = uploadManager.activePrefix.value + link;
          }

          updates[serviceId] = {
            ...updates[serviceId],
            status: '✓ 完成',
            progress: 100,
            link: link,
            isRetrying: false,
            error: undefined
          };

          // Update queue item
          queueManager.updateItem(itemId, {
            serviceProgress: updates,
            // If all enabled services are now successful, mark whole item as success
            status: item.enabledServices.every(s =>
              (updates[s]?.status?.includes('完成') || updates[s]?.status?.includes('✓'))
            ) ? 'success' : 'uploading'
          });

          // If this was primary or we have no primary yet, set it
          if (!item.primaryUrl || serviceId === item.enabledServices[0]) {
            queueManager.updateItem(itemId, {
              primaryUrl: link,
              thumbUrl: link
            });
          }

          toast.success('重试成功', `${serviceLabels[serviceId]} 上传成功`);

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[重试] ${serviceId} 失败:`, errorMsg);

          const updates = { ...item.serviceProgress };
          updates[serviceId] = {
            ...updates[serviceId],
            status: '✗ 失败',
            progress: 0,
            error: errorMsg,
            isRetrying: false
          };
          queueManager.updateItem(itemId, { serviceProgress: updates });
          toast.error('重试失败', `${serviceLabels[serviceId]}: ${errorMsg}`);
        } finally {
          retryingItems.value.delete(retryKey);
        }
        return;
      }

      // === Case 2: Full Retry (Legacy / Fallback) ===
      // 新增：并发控制 - 检查是否已在重试中
      if (retryingItems.value.has(itemId)) {
        console.warn(`[重试] ${item.fileName} 已在重试中，跳过`);
        return;
      }

      // 新增：检查重试次数限制
      const currentRetryCount = item.retryCount || 0;
      const maxRetries = item.maxRetries || 3;

      if (currentRetryCount >= maxRetries) {
        toast.error(
          '重试次数已达上限',
          `${item.fileName} 已重试 ${maxRetries} 次，无法继续重试`,
          5000
        );
        return;
      }

      console.log(`[上传] 重试上传 (${currentRetryCount + 1}/${maxRetries}): ${item.fileName}`);

      // 新增：指数退避延迟（0ms, 2000ms, 4000ms）
      const delays = [0, 2000, 4000];
      const delay = delays[currentRetryCount] || 4000;

      if (delay > 0) {
        console.log(`[重试] 等待 ${delay}ms 后重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // 新增：标记为重试中
      retryingItems.value.add(itemId);
      queueManager.updateItem(itemId, {
        isRetrying: true,
        retryCount: currentRetryCount + 1,
        lastRetryTime: Date.now()
      });

      toast.info('重试中', `正在重新上传 ${item.fileName} (${currentRetryCount + 1}/${maxRetries})`);

      // 【关键修复】不调用 handleFilesUpload，直接在原地重新上传
      // 避免触发 isFileInQueue() 的重复检测

      // 重置状态
      queueManager.resetItemForRetry(itemId);

      // 获取启用的服务
      const enabledServices = item.enabledServices || [];

      try {
        // 创建 MultiServiceUploader 实例（无参数构造函数）
        const uploader = new MultiServiceUploader();

        // 从 configStore 读取配置
        const configStore = new Store('.settings.dat');
        const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;

        // 调用上传方法，传入配置对象和进度回调
        const result = await uploader.uploadToMultipleServices(
          item.filePath,
          enabledServices,
          config,  // 第3个参数：配置对象
          (serviceId, percent, step, stepIndex, totalSteps) => {
            // 在进度回调中使用 itemId 更新进度
            queueManager.updateServiceProgress(
              itemId,
              serviceId,
              percent,
              step,
              stepIndex,
              totalSteps
            );
          }
        );

        // 更新每个服务的状态(成功和失败)
        const currentItem = queueManager.getItem(itemId);
        if (currentItem) {
          const updatedServiceProgress = { ...currentItem.serviceProgress };

          result.results.forEach(serviceResult => {
            if (updatedServiceProgress[serviceResult.serviceId]) {
              if (serviceResult.status === 'success' && serviceResult.result) {
                // 成功：更新链接和状态
                let link = serviceResult.result.url;
                if (serviceResult.serviceId === 'weibo' && uploadManager.activePrefix.value) {
                  link = uploadManager.activePrefix.value + link;
                }
                updatedServiceProgress[serviceResult.serviceId] = {
                  ...updatedServiceProgress[serviceResult.serviceId],
                  status: '✓ 完成',
                  progress: 100,
                  link: link
                };
              } else if (serviceResult.status === 'failed') {
                // 失败：更新错误状态并重置进度
                updatedServiceProgress[serviceResult.serviceId] = {
                  ...updatedServiceProgress[serviceResult.serviceId],
                  status: '✗ 失败',
                  progress: 0,  // 失败时进度重置为0
                  error: serviceResult.error || '上传失败'
                };
              }
            }
          });

          // 批量更新所有服务的状态
          queueManager.updateItem(itemId, {
            serviceProgress: updatedServiceProgress
          });
        }

        // 处理上传成功
        let thumbUrl = result.primaryUrl;
        if (result.primaryService === 'weibo' && uploadManager.activePrefix.value) {
          thumbUrl = uploadManager.activePrefix.value + thumbUrl;
        }
        queueManager.markItemComplete(itemId, thumbUrl);

        // 保存到历史记录
        await uploadManager.saveHistoryItem(item.filePath, result);

        // 新增：清理重试状态
        retryingItems.value.delete(itemId);
        queueManager.updateItem(itemId, { isRetrying: false });

        // 新增：部分失败检测和 Toast 警告
        if (result.isPartialSuccess && result.partialFailures) {
          const failedServiceNames = result.partialFailures
            .map(f => {
              const nameMap: Record<string, string> = {
                weibo: '微博', r2: 'R2', tcl: 'TCL', jd: '京东',
                nowcoder: '牛客', qiyu: '七鱼', zhihu: '知乎', nami: '纳米'
              };
              return nameMap[f.serviceId] || f.serviceId;
            })
            .join('、');

          toast.warn(
            '部分图床上传失败',
            `${item.fileName} 的 ${failedServiceNames} 上传失败，但主力图床已成功`,
            5000
          );
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[重试] ${item.fileName} 上传失败:`, errorMsg);

        // 从错误消息中提取图床信息
        let failedServices: string[] = [];
        const servicePattern = /- (\w+):/g;
        let match;
        while ((match = servicePattern.exec(errorMsg)) !== null) {
          failedServices.push(match[1]);
        }

        // 【修复】显示错误Toast（复用智能错误识别逻辑）
        if (errorMsg.includes('Cookie') || errorMsg.includes('100006')) {
          const serviceName = failedServices.length > 0 ? failedServices.join('、') : '微博';
          toast.error(
            `${serviceName} Cookie 已过期`,
            '请前往设置页面更新 Cookie 后重试',
            6000
          );
        } else if (errorMsg.includes('认证失败') || errorMsg.includes('authentication')) {
          const serviceName = failedServices.length > 0 ? failedServices.join('、') : '图床';
          toast.error(
            `${serviceName}认证失败`,
            '请检查配置信息是否正确',
            5000
          );
        } else {
          toast.error(
            '重试失败',
            `${item.fileName}: ${errorMsg}`,
            5000
          );
        }

        // 新增:更新所有服务的失败状态
        const currentItem = queueManager.getItem(itemId);
        if (currentItem && currentItem.serviceProgress) {
          const updatedServiceProgress = { ...currentItem.serviceProgress };
          enabledServices.forEach(serviceId => {
            if (updatedServiceProgress[serviceId]) {
              updatedServiceProgress[serviceId] = {
                ...updatedServiceProgress[serviceId],
                status: '✗ 失败',
                progress: 0,
                error: errorMsg
              };
            }
          });
          queueManager.updateItem(itemId, {
            serviceProgress: updatedServiceProgress
          });
        }

        queueManager.markItemFailed(itemId, errorMsg);

        // 新增：清理重试状态
        retryingItems.value.delete(itemId);
        queueManager.updateItem(itemId, { isRetrying: false });
      }
    });
  }
};

// 加载配置
onMounted(async () => {
  // 加载服务按钮状态
  await uploadManager.loadServiceButtonStates();
  console.log('[UploadView] 服务按钮状态已加载');

  // 设置文件拖拽监听
  await setupTauriFileDropListener();

  // 设置重试回调
  setupRetryCallback();
});

// 组件卸载时清理监听器
onUnmounted(() => {
  // 清理所有文件拖拽监听器
  fileDropUnlisteners.value.forEach(unlisten => unlisten());
  fileDropUnlisteners.value = [];
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
          <span class="drop-hint">或点击选择文件</span>
        </div>
      </div>

      <!-- 图床选择区域 -->
      <div class="upload-controls">
        <div class="service-group-label">选择上传图床</div>
        <div class="service-tags-wrapper">
          <button
            v-for="serviceId in visibleServices"
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

      <!-- 上传队列 -->
      <div class="upload-queue-section">
        <div class="queue-header">
          <h3 class="queue-title">
            <i class="pi pi-list"></i>
            <span>上传队列</span>
          </h3>
        </div>
        <UploadQueue ref="uploadQueueRef" />
      </div>
    </div>
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
  gap: 24px;
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

/* 图床选择区域 */
.upload-controls {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 24px;
}

.service-group-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
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
