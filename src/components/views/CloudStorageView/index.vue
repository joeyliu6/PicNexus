<script setup lang="ts">
import { ref, computed, onMounted, onActivated, nextTick, watch } from 'vue';
import { useToast } from '@/composables/useToast';
import { useCloudStorage } from './composables/useCloudStorage';
import { useFileSelection } from './composables/useFileSelection';
import { useFileOperations } from './composables/useFileOperations';
import { useDragDrop } from './composables/useDragDrop';
import { useSorting } from './composables/useSorting';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import ServiceTabs from './components/ServiceTabs.vue';
import StorageToolbar from './components/StorageToolbar.vue';
import FileList from './components/FileList.vue';
import FileDetailPanel from './components/FileDetailPanel.vue';
import PreviewDialog from './components/PreviewDialog.vue';
import ContextMenu from './components/ContextMenu.vue';
import PaginationBar from './components/PaginationBar.vue';
import type { StorageObject, LinkFormat, ContextMenuItem, SortField } from './types';

const toast = useToast();

// 侧边栏始终展开
const sidebarExpanded = true;

// 核心状态
const {
  activeService,
  services,
  currentPath,
  objects,
  isLoading,
  isServiceLoading,
  error,
  stats,
  bucketName,
  searchQuery,
  pagination,
  setActiveService,
  navigateTo,
  refresh,
  goToPage,
  changePageSize,
  search,
  initServiceStatuses,
} = useCloudStorage();

// 文件选择
const {
  selectedItems,
  selectedKeys,
  toggleSelect,
  clearSelection,
  selectByRect,
  selectItems,
} = useFileSelection({ objects });

// 排序
const { sortField, sortDirection, sortedObjects, toggleSort } = useSorting(objects);

// 详情面板状态
const detailVisible = ref(false);
const detailFile = ref<StorageObject | null>(null);

// 文件操作
const {
  uploadFiles,
  deleteFiles,
  copyLinks,
  downloadFile,
  createFolder,
} = useFileOperations({
  activeService,
  currentPath,
  refresh,
  clearSelection,
});

// 拖拽区域引用
const dropZoneRef = ref<HTMLElement | null>(null);

// 拖拽上传
const { isDragging, isOver } = useDragDrop({
  dropZoneRef,
  onFilesDropped: async (files) => {
    toast.info('提示', `拖拽上传 ${files.length} 个文件暂不支持，请使用上传按钮`);
    // TODO: 实现拖拽上传
  },
});

// 预览状态
const previewVisible = ref(false);
const previewFile = ref<StorageObject | null>(null);

// 右键菜单状态
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTarget = ref<StorageObject | null>(null);

// 首次挂载标志
const isFirstMount = ref(true);

// 创建文件夹对话框状态
const createFolderDialogVisible = ref(false);
const newFolderName = ref('');
const isCreatingFolder = ref(false);

// 分页状态（computed 确保响应式）
const paginationState = computed(() => ({
  currentPage: pagination.currentPage.value,
  pageSize: pagination.pageSize.value,
  hasMore: pagination.hasMore.value,
  maxKnownPage: pagination.maxKnownPage.value,
  pageSizeOptions: pagination.pageSizeOptions,
}));

// 右键菜单项
const contextMenuItems = computed<ContextMenuItem[]>(() => {
  const target = contextMenuTarget.value;
  if (!target) return [];

  const isFile = target.type === 'file';
  const items: ContextMenuItem[] = [];

  if (isFile) {
    items.push({
      id: 'preview',
      label: '预览',
      icon: 'pi-eye',
      action: () => handlePreview(target),
    });
    items.push({
      id: 'copy-url',
      label: '复制 URL',
      icon: 'pi-link',
      action: () => handleCopyLink(target, 'url'),
    });
    items.push({
      id: 'copy-markdown',
      label: '复制 Markdown',
      icon: 'pi-file-edit',
      action: () => handleCopyLink(target, 'markdown'),
    });
    items.push({
      id: 'download',
      label: '下载',
      icon: 'pi-download',
      action: () => downloadFile(target),
    });
    items.push({ id: 'sep1', label: '', icon: '', action: () => {}, separator: true });
  } else {
    items.push({
      id: 'open',
      label: '打开文件夹',
      icon: 'pi-folder-open',
      action: () => handleOpenFolder(target),
    });
    items.push({ id: 'sep1', label: '', icon: '', action: () => {}, separator: true });
  }

  items.push({
    id: 'delete',
    label: '删除',
    icon: 'pi-trash',
    action: () => deleteFiles([target]),
    danger: true,
  });

  return items;
});

// 事件处理
const handleServiceChange = async (serviceId: typeof activeService.value) => {
  clearSelection();
  await setActiveService(serviceId);
};

const handleNavigate = async (path: string) => {
  clearSelection();
  await navigateTo(path);
};

const handleSelect = (item: StorageObject, event: MouseEvent) => {
  toggleSelect(item, event);
};

const handlePreview = (item: StorageObject) => {
  if (item.type === 'file') {
    previewFile.value = item;
    previewVisible.value = true;
  }
};

const handleCopyLink = async (item: StorageObject, format: LinkFormat) => {
  await copyLinks([item], format);
};

const handleOpenFolder = async (item: StorageObject) => {
  if (item.type === 'folder') {
    clearSelection();
    await navigateTo(item.key);
  }
};

// 详情面板操作
const handleShowDetail = (item: StorageObject) => {
  if (item.type === 'file') {
    detailFile.value = item;
    detailVisible.value = true;
  }
};

const handleCloseDetail = () => {
  detailVisible.value = false;
};

// 排序操作
const handleSort = (field: SortField) => {
  toggleSort(field);
};

// 全选操作
const handleSelectAll = (checked: boolean) => {
  if (checked) {
    selectItems(objects.value);
  } else {
    clearSelection();
  }
};

const handleBatchDelete = () => {
  if (selectedItems.value.length === 0) return;
  deleteFiles(selectedItems.value);
};

const handleCreateFolder = async () => {
  newFolderName.value = '';
  createFolderDialogVisible.value = true;
};

const confirmCreateFolder = async () => {
  const folderName = newFolderName.value.trim();
  if (!folderName) return;

  isCreatingFolder.value = true;
  try {
    await createFolder(folderName);
    createFolderDialogVisible.value = false;
    newFolderName.value = '';
  } finally {
    isCreatingFolder.value = false;
  }
};

const handleBatchCopyLink = async (format: LinkFormat) => {
  await copyLinks(selectedItems.value, format);
};

const handleBatchDownload = () => {
  const files = selectedItems.value.filter((i) => i.type === 'file');
  if (files.length === 1) {
    downloadFile(files[0]);
  }
};

const handleMarqueeSelect = (rect: { left: number; top: number; width: number; height: number }, positions: { key: string; left: number; top: number; width: number; height: number }[]) => {
  selectByRect(rect, positions);
};

// 生命周期
onMounted(async () => {
  await initServiceStatuses();
  await refresh();
  await nextTick();
  isFirstMount.value = false;
});

onActivated(() => {
  if (!isFirstMount.value) {
    refresh();
  }
});

// 路径变化时清空选择
watch(currentPath, () => {
  clearSelection();
});
</script>

<template>
  <div ref="dropZoneRef" class="cloud-storage-layout">
    <!-- 左侧：服务侧边栏（始终展开） -->
    <aside class="sidebar-area expanded">
      <ServiceTabs
        :services="services"
        :active-service="activeService"
        :expanded="sidebarExpanded"
        :is-loading="isServiceLoading"
        @change="handleServiceChange"
      />
    </aside>

    <!-- 右侧：主内容区 -->
    <main class="main-area">
      <!-- 顶部工具栏 -->
      <header class="toolbar-header">
        <StorageToolbar
          :current-path="currentPath"
          :bucket-name="bucketName"
          :stats="stats"
          :loading="isLoading"
          :search-query="searchQuery"
          :selected-count="selectedItems.length"
          @navigate="handleNavigate"
          @refresh="refresh"
          @upload="uploadFiles"
          @search="search"
          @delete="handleBatchDelete"
          @createFolder="handleCreateFolder"
        />
      </header>

      <!-- 内容区域 -->
      <div class="content-body">
        <FileList
          :items="sortedObjects"
          :selected-keys="selectedKeys"
          :loading="isLoading"
          :error="error"
          :is-dragging="isDragging || isOver"
          :all-selected="selectedKeys.size === objects.length && objects.length > 0"
          @select="handleSelect"
          @preview="handlePreview"
          @copy-link="(item) => handleCopyLink(item, 'url')"
          @delete="(item) => deleteFiles([item])"
          @open="handleOpenFolder"
          @upload="uploadFiles"
          @show-detail="handleShowDetail"
          @select-all="handleSelectAll"
        />
      </div>

      <!-- 分页栏 -->
      <footer class="pagination-footer">
        <PaginationBar
          :current-page="paginationState.currentPage"
          :page-size="paginationState.pageSize"
          :total-items="objects.length"
          :selected-count="selectedItems.length"
          :has-more="paginationState.hasMore"
          :loading="isLoading"
          :max-known-page="paginationState.maxKnownPage"
          :page-size-options="paginationState.pageSizeOptions"
          @page-change="goToPage"
          @page-size-change="changePageSize"
        />
      </footer>

    </main>

    <!-- 详情抽屉（浮层） -->
    <FileDetailPanel
      :file="detailFile"
      :visible="detailVisible"
      @close="handleCloseDetail"
      @download="downloadFile"
      @delete="(f) => { deleteFiles([f]); handleCloseDetail(); }"
      @copy-link="handleCopyLink"
    />

    <!-- 预览对话框 -->
    <PreviewDialog
      v-model:visible="previewVisible"
      :file="previewFile"
      @copy-link="handleCopyLink"
      @delete="(file) => deleteFiles([file])"
      @download="downloadFile"
    />

    <!-- 右键菜单 -->
    <ContextMenu
      v-model:visible="contextMenuVisible"
      :items="contextMenuItems"
      :x="contextMenuX"
      :y="contextMenuY"
    />
  </div>
</template>

<style scoped>
.cloud-storage-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: var(--bg-app);
}

/* 左侧侧边栏 - 始终展开 */
.sidebar-area {
  flex-shrink: 0;
  width: 200px;
  background: var(--bg-card);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 右侧主内容区 */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  min-width: 0;
}

/* 工具栏头部 */
.toolbar-header {
  flex-shrink: 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-subtle);
}

/* 内容区域 */
.content-body {
  flex: 1;
  overflow: hidden;
  padding: 16px;
  padding-bottom: 0;
}

/* 分页栏 */
.pagination-footer {
  flex-shrink: 0;
  height: 56px;
  background: var(--bg-card);
  border-top: 1px solid var(--border-subtle);
}
</style>
