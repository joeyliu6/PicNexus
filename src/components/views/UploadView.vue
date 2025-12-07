<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { listen } from '@tauri-apps/api/event';
import Button from 'primevue/button';
import UploadQueue from '../UploadQueue.vue';
import type { ServiceType } from '../../config/types';
import { useToast } from '../../composables/useToast';
import { useUploadManager } from '../../composables/useUpload';
import { UploadQueueManager } from '../../uploadQueue';

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

// 加载配置
onMounted(async () => {
  // 加载服务按钮状态
  await uploadManager.loadServiceButtonStates();
  console.log('[UploadView] 服务按钮状态已加载');

  // 设置文件拖拽监听
  await setupTauriFileDropListener();
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
        <div class="controls-header">
          <h3 class="controls-title">选择上传图床</h3>
          <span class="selection-badge">已选择 {{ selectedCount }} 个</span>
        </div>
        <p class="controls-hint">可选择任意数量的图床，上传时将并发处理（最多同时3个）</p>

        <div class="service-buttons">
          <Button
            v-for="serviceId in visibleServices"
            :key="serviceId"
            :label="serviceLabels[serviceId]"
            :disabled="!uploadManager.isServiceAvailable.value(serviceId)"
            :outlined="!uploadManager.isServiceSelected.value(serviceId)"
            :severity="uploadManager.isServiceSelected.value(serviceId) ? 'success' : 'secondary'"
            @click="toggleService(serviceId)"
            v-tooltip.top="!uploadManager.serviceConfigStatus.value[serviceId] ? '请先在设置中配置' : ''"
            class="service-btn"
            :class="{ 'service-selected': uploadManager.isServiceSelected.value(serviceId) }"
          >
            <template #icon>
              <i :class="uploadManager.isServiceSelected.value(serviceId) ? 'pi pi-check-circle' : 'pi pi-circle'"></i>
            </template>
          </Button>
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
  max-width: 1200px;
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

.controls-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.controls-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.selection-badge {
  padding: 4px 12px;
  background: var(--primary);
  color: var(--text-on-primary);
  border-radius: 16px;
  font-size: 0.85rem;
  font-weight: 600;
}

.controls-hint {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin: 0 0 16px 0;
}

.service-buttons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}

.service-btn {
  min-width: 120px;
  justify-content: center;
}

.service-btn.service-selected {
  font-weight: 600;
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
