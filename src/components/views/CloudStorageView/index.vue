<script setup lang="ts">
import { ref, computed, onMounted, onActivated, nextTick, watch } from 'vue';
import { useToast } from '@/composables/useToast';
import { useCloudStorage } from './composables/useCloudStorage';
import { useFileSelection } from './composables/useFileSelection';
import { useFileOperations } from './composables/useFileOperations';
import { useDragDrop } from './composables/useDragDrop';
import { useSorting } from './composables/useSorting';
import ServiceTabs from './components/ServiceTabs.vue';
import StorageToolbar from './components/StorageToolbar.vue';
import FileGrid from './components/FileGrid.vue';
import FileTable from './components/FileTable.vue';
import FileDetailPanel from './components/FileDetailPanel.vue';
import FloatingActionBar from './components/FloatingActionBar.vue';
import PreviewDialog from './components/PreviewDialog.vue';
import ContextMenu from './components/ContextMenu.vue';
import type { StorageObject, LinkFormat, ContextMenuItem, ViewMode, SortField } from './types';

const toast = useToast();

// 视图模式（持久化到 localStorage）
const STORAGE_KEY = 'cloud-storage-view-mode';
const viewMode = ref<ViewMode>((localStorage.getItem(STORAGE_KEY) as ViewMode) || 'grid');

watch(viewMode, (newMode) => {
  localStorage.setItem(STORAGE_KEY, newMode);
});

// 核心状态
const {
  activeService,
  services,
  currentPath,
  objects,
  isLoading,
  error,
  stats,
  hasMore,
  searchQuery,
  setActiveService,
  navigateTo,
  refresh,
  loadMore,
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

// 计算存储桶名称
const bucketName = computed(() => stats.value?.bucketName || '');

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
    <!-- 左侧：服务侧边栏 -->
    <aside class="sidebar-area">
      <div class="sidebar-header">
        <i class="pi pi-cloud"></i>
        <span>云存储</span>
      </div>
      <ServiceTabs
        :services="services"
        :active-service="activeService"
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
          :view-mode="viewMode"
          @navigate="handleNavigate"
          @refresh="refresh"
          @upload="uploadFiles"
          @search="search"
          @update:view-mode="viewMode = $event"
        />
      </header>

      <!-- 内容区域 -->
      <div class="content-body">
        <!-- 表格视图 -->
        <FileTable
          v-if="viewMode === 'table'"
          :items="sortedObjects"
          :selected-keys="selectedKeys"
          :loading="isLoading"
          :error="error"
          :sort-field="sortField"
          :sort-direction="sortDirection"
          @select="handleSelect"
          @select-all="handleSelectAll"
          @preview="handleShowDetail"
          @open="handleOpenFolder"
          @sort="handleSort"
          @delete="(item) => deleteFiles([item])"
          @copy-link="(item) => handleCopyLink(item, 'url')"
          @upload="uploadFiles"
        />

        <!-- 网格/列表视图 -->
        <FileGrid
          v-else
          :items="sortedObjects"
          :selected-keys="selectedKeys"
          :loading="isLoading"
          :error="error"
          :has-more="hasMore"
          :is-dragging="isDragging || isOver"
          :view-mode="viewMode"
          @select="handleSelect"
          @preview="handlePreview"
          @copy-link="(item) => handleCopyLink(item, 'url')"
          @delete="(item) => deleteFiles([item])"
          @open="handleOpenFolder"
          @load-more="loadMore"
          @upload="uploadFiles"
          @marquee-select="handleMarqueeSelect"
          @contextmenu.prevent="() => {}"
        />
      </div>

      <!-- 详情侧边栏 -->
      <FileDetailPanel
        :file="detailFile"
        :visible="detailVisible"
        @close="handleCloseDetail"
        @download="downloadFile"
        @delete="(f) => { deleteFiles([f]); handleCloseDetail(); }"
        @copy-link="handleCopyLink"
      />

      <!-- 浮动操作栏 -->
      <FloatingActionBar
        :selected-items="selectedItems"
        :visible="selectedItems.length > 0"
        @delete="handleBatchDelete"
        @copy-link="handleBatchCopyLink"
        @download="handleBatchDownload"
        @close="clearSelection"
      />

      <!-- 底部状态栏 -->
      <footer class="status-bar">
        <div class="status-left">
          <span class="status-count">{{ objects.length }} 个项目</span>
          <span v-if="selectedItems.length > 0" class="status-selected">
            已选择 {{ selectedItems.length }} 个
          </span>
        </div>
        <div class="status-right">
          <span class="status-indicator" :class="services.find(s => s.serviceId === activeService)?.status"></span>
          <span class="status-service">{{ services.find(s => s.serviceId === activeService)?.serviceName }}</span>
        </div>
      </footer>
    </main>

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

/* 左侧侧边栏 */
.sidebar-area {
  flex-shrink: 0;
  width: 200px;
  background: var(--bg-card);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 16px 16px;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
}

.sidebar-header i {
  font-size: 1.25rem;
  color: var(--primary);
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
  padding: 20px;
}

/* 底部状态栏 */
.status-bar {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 24px;
  background: var(--bg-card);
  border-top: 1px solid var(--border-subtle);
  font-size: 12px;
  color: var(--text-muted);
}

.status-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-selected {
  color: var(--primary);
  font-weight: 500;
}

.status-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}

.status-indicator.connected {
  background: var(--success);
}

.status-indicator.connecting {
  background: var(--warning);
}

.status-indicator.error {
  background: var(--error);
}

.status-service {
  font-weight: 500;
  color: var(--text-secondary);
}
</style>
