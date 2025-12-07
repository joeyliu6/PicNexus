<script setup lang="ts">
import { ref, computed, onMounted, onActivated } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Image from 'primevue/image';
import Dialog from 'primevue/dialog';
import ProgressSpinner from 'primevue/progressspinner';
import Message from 'primevue/message';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';

const toast = useToast();
const { confirmDelete } = useConfirm();

// R2 文件项
interface R2File {
  key: string;
  name: string;
  url: string;
  size: number;
  lastModified: Date;
  selected?: boolean;
}

const files = ref<R2File[]>([]);
const selectedFiles = ref<R2File[]>([]);
const selectAll = ref(false);
const loading = ref(false);
const errorMessage = ref('');

// 预览对话框
const previewVisible = ref(false);
const previewFile = ref<R2File | null>(null);

// 标志位：防止首次加载时重复刷新
const isFirstMount = ref(true);

// 桶信息
const bucketInfo = ref('');
const statsInfo = ref('');

// 计算选中数量
const selectedCount = computed(() => selectedFiles.value.length);

// 全选/取消全选
const handleSelectAll = () => {
  if (selectAll.value) {
    selectedFiles.value = [...files.value];
  } else {
    selectedFiles.value = [];
  }
};

// 刷新文件列表
const refreshFiles = async () => {
  loading.value = true;
  errorMessage.value = '';

  try {
    // TODO: 从 Rust 后端获取 R2 文件列表
    await new Promise(resolve => setTimeout(resolve, 1000)); // 模拟加载
    toast.info('刷新完成', 'R2 文件列表已刷新（功能待集成）');
  } catch (error) {
    errorMessage.value = String(error);
    toast.error('刷新失败', String(error));
  } finally {
    loading.value = false;
  }
};

// 批量删除
const handleBatchDelete = () => {
  if (selectedFiles.value.length === 0) {
    toast.warn('未选择文件', '请先选择要删除的文件');
    return;
  }

  confirmDelete(
    `确定要删除选中的 ${selectedFiles.value.length} 个文件吗？此操作不可撤销。`,
    async () => {
      try {
        // TODO: 调用 Rust 后端删除文件
        toast.success('删除成功', `已删除 ${selectedFiles.value.length} 个文件`);
        selectedFiles.value = [];
        selectAll.value = false;
        await refreshFiles();
      } catch (error) {
        toast.error('删除失败', String(error));
      }
    }
  );
};

// 预览文件
const handlePreview = (file: R2File) => {
  previewFile.value = file;
  previewVisible.value = true;
};

// 复制链接
const handleCopyLink = async (file: R2File) => {
  try {
    // TODO: 复制到剪贴板
    toast.success('已复制', `${file.name} 的链接已复制到剪贴板`);
  } catch (error) {
    toast.error('复制失败', String(error));
  }
};

// 删除单个文件
const handleDeleteFile = (file: R2File) => {
  confirmDelete(
    `确定要删除 "${file.name}" 吗？此操作不可撤销。`,
    async () => {
      try {
        // TODO: 调用 Rust 后端删除文件
        toast.success('删除成功', `已删除 "${file.name}"`);
        await refreshFiles();
      } catch (error) {
        toast.error('删除失败', String(error));
      }
    }
  );
};

// 格式化文件大小
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

// 格式化日期
const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

onMounted(() => {
  refreshFiles();
  isFirstMount.value = false;
});

// 视图激活时刷新文件列表（KeepAlive 缓存后的刷新）
onActivated(() => {
  if (!isFirstMount.value) {
    console.log('[R2ManagerView] 视图已激活，刷新文件列表');
    refreshFiles();
  }
});
</script>

<template>
  <div class="r2-manager-view">
    <div class="r2-manager-container">
      <!-- 工具栏 -->
      <div class="r2-toolbar">
        <div class="r2-toolbar-title">
          <i class="pi pi-cloud"></i>
          <span>R2 存储管理</span>
        </div>

        <div class="r2-toolbar-controls">
          <div class="r2-select-all">
            <Checkbox
              v-model="selectAll"
              @change="handleSelectAll"
              :binary="true"
              inputId="r2-select-all"
            />
            <label for="r2-select-all">全选</label>
          </div>

          <Button
            :label="`删除 (${selectedCount})`"
            icon="pi pi-trash"
            @click="handleBatchDelete"
            :disabled="selectedCount === 0"
            severity="danger"
            outlined
            size="small"
          />

          <div class="r2-toolbar-info">
            <span class="r2-info-text">{{ bucketInfo }}</span>
            <span class="r2-stats-text">{{ statsInfo }}</span>
          </div>

          <Button
            label="刷新"
            icon="pi pi-refresh"
            @click="refreshFiles"
            :loading="loading"
            outlined
          />
        </div>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="r2-loading">
        <ProgressSpinner />
        <p>加载中...</p>
      </div>

      <!-- 错误信息 -->
      <Message v-if="errorMessage && !loading" severity="error" :closable="false">
        {{ errorMessage }}
      </Message>

      <!-- 文件网格 -->
      <div v-if="!loading && !errorMessage" class="r2-grid">
        <div v-if="files.length === 0" class="r2-empty">
          <i class="pi pi-inbox empty-icon"></i>
          <p>暂无文件</p>
          <p class="empty-hint">上传图片到 R2 后将在此显示</p>
        </div>

        <div
          v-for="file in files"
          :key="file.key"
          class="r2-grid-item"
        >
          <Checkbox
            v-model="file.selected"
            :binary="true"
            class="r2-item-checkbox"
          />

          <div class="r2-item-preview" @click="handlePreview(file)">
            <img :src="file.url" :alt="file.name" class="r2-item-image" />
          </div>

          <div class="r2-item-info">
            <p class="r2-item-name" :title="file.name">{{ file.name }}</p>
            <p class="r2-item-size">{{ formatSize(file.size) }}</p>
          </div>

          <div class="r2-item-actions">
            <Button
              icon="pi pi-eye"
              @click="handlePreview(file)"
              size="small"
              text
              rounded
              v-tooltip.top="'预览'"
            />
            <Button
              icon="pi pi-copy"
              @click="handleCopyLink(file)"
              size="small"
              text
              rounded
              v-tooltip.top="'复制链接'"
            />
            <Button
              icon="pi pi-trash"
              @click="handleDeleteFile(file)"
              severity="danger"
              size="small"
              text
              rounded
              v-tooltip.top="'删除'"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 预览对话框 -->
    <Dialog
      v-model:visible="previewVisible"
      :modal="true"
      :dismissableMask="true"
      :closable="true"
      class="r2-preview-dialog"
      :style="{ width: '80vw', maxWidth: '1000px' }"
    >
      <template #header>
        <span>{{ previewFile?.name }}</span>
      </template>

      <div v-if="previewFile" class="r2-preview-content">
        <img :src="previewFile.url" :alt="previewFile.name" class="r2-preview-image" />

        <div class="r2-preview-info">
          <p><strong>文件名：</strong>{{ previewFile.name }}</p>
          <p><strong>大小：</strong>{{ formatSize(previewFile.size) }}</p>
          <p><strong>最后修改：</strong>{{ formatDate(previewFile.lastModified) }}</p>
        </div>
      </div>

      <template #footer>
        <Button
          label="复制链接"
          icon="pi pi-copy"
          @click="previewFile && handleCopyLink(previewFile)"
          outlined
        />
        <Button
          label="删除"
          icon="pi pi-trash"
          @click="previewFile && handleDeleteFile(previewFile); previewVisible = false"
          severity="danger"
          outlined
        />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.r2-manager-view {
  height: 100%;
  overflow-y: auto;
  padding: 20px;
  background: var(--bg-app);
}

.r2-manager-container {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 工具栏 */
.r2-toolbar {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.r2-toolbar-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.r2-toolbar-title i {
  font-size: 1.5rem;
  color: var(--primary);
}

.r2-toolbar-controls {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.r2-select-all {
  display: flex;
  align-items: center;
  gap: 8px;
}

.r2-select-all label {
  cursor: pointer;
  user-select: none;
  color: var(--text-primary);
}

.r2-toolbar-info {
  display: flex;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

/* 加载和错误状态 */
.r2-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  background: var(--bg-card);
  border-radius: 12px;
  gap: 16px;
}

.r2-loading p {
  color: var(--text-secondary);
  margin: 0;
}

/* 文件网格 */
.r2-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  background: var(--bg-card);
  border-radius: 12px;
  padding: 20px;
}

.r2-empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary);
}

.empty-icon {
  font-size: 4rem;
  opacity: 0.5;
  margin-bottom: 16px;
}

.empty-hint {
  font-size: 0.9rem;
  margin-top: 8px;
}

.r2-grid-item {
  position: relative;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s;
}

.r2-grid-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-float);
}

.r2-item-checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  background: var(--bg-card);
  padding: 4px;
  border-radius: 4px;
}

.r2-item-preview {
  width: 100%;
  aspect-ratio: 1;
  cursor: pointer;
  overflow: hidden;
}

.r2-item-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.2s;
}

.r2-item-preview:hover .r2-item-image {
  transform: scale(1.05);
}

.r2-item-info {
  padding: 12px;
}

.r2-item-name {
  margin: 0 0 4px 0;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.r2-item-size {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.r2-item-actions {
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 8px;
  background: var(--bg-app);
  border-top: 1px solid var(--border-subtle);
}

/* 预览对话框 */
.r2-preview-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.r2-preview-image {
  width: 100%;
  height: auto;
  max-height: 60vh;
  object-fit: contain;
  border-radius: 8px;
}

.r2-preview-info {
  padding: 16px;
  background: var(--bg-input);
  border-radius: 8px;
}

.r2-preview-info p {
  margin: 8px 0;
  font-size: 0.95rem;
  color: var(--text-primary);
}

.r2-preview-info strong {
  color: var(--text-secondary);
  font-weight: 500;
}

/* 滚动条 */
.r2-manager-view::-webkit-scrollbar {
  width: 8px;
}

.r2-manager-view::-webkit-scrollbar-track {
  background: var(--bg-input);
}

.r2-manager-view::-webkit-scrollbar-thumb {
  background: var(--border-subtle);
  border-radius: 4px;
}

.r2-manager-view::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}
</style>
