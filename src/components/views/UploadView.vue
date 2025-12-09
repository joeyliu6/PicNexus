<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { listen } from '@tauri-apps/api/event';
import Button from 'primevue/button';
import UploadQueue from '../UploadQueue.vue';
import type { ServiceType } from '../../config/types';
import { useToast } from '../../composables/useToast';
import { useUploadManager } from '../../composables/useUpload';
import { UploadQueueManager } from '../../uploadQueue';
import { MultiServiceUploader } from '../../core/MultiServiceUploader';

const toast = useToast();

// 创建上传队列管理器实例
const queueManager = new UploadQueueManager();

// 使用上传管理器
const uploadManager = useUploadManager(queueManager);

// 引用
const uploadQueueRef = ref<InstanceType<typeof UploadQueue>>();

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

// 服务图标映射
const serviceIcons: Record<ServiceType, string> = {
  weibo: 'pi pi-eye',
  r2: 'pi pi-cloud',
  tcl: 'pi pi-server',
  jd: 'pi pi-shopping-bag',
  nowcoder: 'pi pi-code',
  qiyu: 'pi pi-comments',
  zhihu: 'pi pi-book',
  nami: 'pi pi-upload'
};

// 获取服务图标
const getServiceIcon = (serviceId: ServiceType): string => {
  return serviceIcons[serviceId] || 'pi pi-image';
};

// 可见的服务（在可用服务列表中的）
const visibleServices = computed(() => {
  return allServices.filter(serviceId =>
    uploadManager.availableServices.value.includes(serviceId)
  );
});

// 选中数量
const selectedCount = computed(() => uploadManager.selectedServices.value.length);

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
    await listen<string[]>('tauri://file-drop', async (event) => {
      const filePaths = event.payload;
      console.log('[上传] 收到拖拽文件:', filePaths);
      await uploadManager.handleFilesUpload(filePaths);
      isDragging.value = false;
    });

    // 监听拖拽悬停事件
    await listen('tauri://file-drop-hover', () => {
      isDragging.value = true;
    });

    // 监听拖拽取消事件
    await listen('tauri://file-drop-cancelled', () => {
      isDragging.value = false;
    });

    console.log('[上传] Tauri 文件拖拽监听器已设置');
  } catch (error) {
    console.error('[上传] 设置 Tauri 文件拖拽监听器失败:', error);
  }
}

// 设置重试回调
const setupRetryCallback = () => {
  if (uploadQueueRef.value) {
    uploadQueueRef.value.setRetryCallback(async (itemId: string) => {
      const item = queueManager.getItem(itemId);
      if (!item) {
        toast.error('重试失败', '找不到队列项');
        return;
      }

      console.log(`[上传] 重试上传: ${item.fileName}`);
      toast.info('重试中', `正在重新上传 ${item.fileName}`);

      // 【关键修复】不调用 handleFilesUpload，直接在原地重新上传
      // 避免触发 isFileInQueue() 的重复检测

      // 重置状态
      queueManager.resetItemForRetry(itemId);

      // 获取启用的服务
      const enabledServices = item.enabledServices || [];

      try {
        // 直接调用 MultiServiceUploader
        const uploader = new MultiServiceUploader(
          queueManager,
          toast,
          uploadManager.activePrefix.value
        );

        const result = await uploader.uploadToMultipleServices(
          item.filePath,
          enabledServices,
          itemId
        );

        // 处理上传成功
        let thumbUrl = result.primaryUrl;
        if (result.primaryService === 'weibo' && uploadManager.activePrefix.value) {
          thumbUrl = uploadManager.activePrefix.value + thumbUrl;
        }
        queueManager.markItemComplete(itemId, thumbUrl);

        // 保存到历史记录
        await uploadManager.saveHistoryItem(item.filePath, result);

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

        queueManager.markItemFailed(itemId, errorMsg);
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
