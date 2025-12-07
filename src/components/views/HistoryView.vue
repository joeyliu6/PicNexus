<script setup lang="ts">
import { ref, computed, onMounted, onActivated, watch } from 'vue';
import { writeText } from '@tauri-apps/api/clipboard';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import DataView from 'primevue/dataview';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import SelectButton from 'primevue/selectbutton';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Image from 'primevue/image';
import Tag from 'primevue/tag';
import type { HistoryItem, ServiceType } from '../../config/types';
import { getActivePrefix } from '../../config/types';
import { useHistoryManager, type ViewMode } from '../../composables/useHistory';
import { useToast } from '../../composables/useToast';
import { useConfigManager } from '../../composables/useConfig';

const toast = useToast();
const historyManager = useHistoryManager();
const configManager = useConfigManager();

// 视图选项
const viewOptions = ref([
  { label: '表格', value: 'table' as ViewMode, icon: 'pi pi-table' },
  { label: '瀑布流', value: 'grid' as ViewMode, icon: 'pi pi-th-large' }
]);

// 图床筛选选项
const serviceOptions = [
  { label: '全部图床', value: 'all' },
  { label: '微博', value: 'weibo' },
  { label: 'R2', value: 'r2' },
  { label: 'TCL', value: 'tcl' },
  { label: '京东', value: 'jd' },
  { label: '牛客', value: 'nowcoder' },
  { label: '七鱼', value: 'qiyu' },
  { label: '知乎', value: 'zhihu' },
  { label: '纳米', value: 'nami' }
];

const selectAll = ref(false);

// 计算属性：是否全选
const isAllSelected = computed(() => {
  const currentItems = historyManager.filteredItems.value;
  if (currentItems.length === 0) return false;
  return currentItems.every(item =>
    historyManager.historyState.value.selectedItems.has(item.id)
  );
});

// 计算属性：是否部分选中
const isSomeSelected = computed(() => {
  const currentItems = historyManager.filteredItems.value;
  if (currentItems.length === 0) return false;
  const selectedCount = currentItems.filter(item =>
    historyManager.historyState.value.selectedItems.has(item.id)
  ).length;
  return selectedCount > 0 && selectedCount < currentItems.length;
});

// 处理表头复选框变化
const handleHeaderCheckboxChange = (checked: boolean) => {
  selectAll.value = checked;
  handleSelectAll();
};

// 监听视图模式变化
watch(() => historyManager.historyState.value.viewMode, (newMode) => {
  console.log('[HistoryView] 视图模式切换:', newMode);
  historyManager.switchViewMode(newMode);
});

// 监听筛选变化
watch(() => historyManager.historyState.value.currentFilter, (newFilter) => {
  console.log('[HistoryView] 图床筛选:', newFilter);
  historyManager.setFilter(newFilter);
});

// 监听搜索词变化
watch(() => historyManager.searchTerm.value, (newTerm) => {
  console.log('[HistoryView] 搜索:', newTerm);
});

// 监听选中状态变化，同步工具栏全选复选框
watch([isAllSelected, isSomeSelected], () => {
  if (isAllSelected.value) {
    selectAll.value = true;
  } else if (!isSomeSelected.value) {
    selectAll.value = false;
  }
});

// 全选/取消全选
const handleSelectAll = () => {
  historyManager.toggleSelectAll(selectAll.value);
};

// 批量复制
const handleBulkCopy = async () => {
  await historyManager.bulkCopyLinks(historyManager.selectedIds.value);
};

// 批量导出
const handleBulkExport = async () => {
  await historyManager.bulkExportJSON(historyManager.selectedIds.value);
};

// 批量删除
const handleBulkDelete = async () => {
  await historyManager.bulkDeleteRecords(historyManager.selectedIds.value);
};

// 复制单个链接
const handleCopyLink = async (item: HistoryItem) => {
  try {
    if (!item.generatedLink) {
      toast.warn('无可用链接', '该项目没有可用的链接');
      return;
    }

    // 动态应用前缀
    let finalLink = item.generatedLink;
    if (item.primaryService === 'weibo') {
      const activePrefix = getActivePrefix(configManager.config.value);
      if (activePrefix) {
        finalLink = `${activePrefix}${item.generatedLink}`;
      }
    }

    await writeText(finalLink);
    toast.success('已复制', '链接已复制到剪贴板', 1500);
  } catch (error) {
    console.error('[历史记录] 复制链接失败:', error);
    toast.error('复制失败', String(error));
  }
};

// 删除单项
const handleDeleteItem = async (item: HistoryItem) => {
  await historyManager.deleteHistoryItem(item.id);
};

// 清空历史
const handleClearHistory = async () => {
  await historyManager.clearHistory();
};

// 加载历史记录
onMounted(async () => {
  console.log('[HistoryView] 组件已挂载，开始加载历史记录');
  await historyManager.loadHistory();
});

// 视图激活时刷新历史记录（KeepAlive 缓存后的刷新）
onActivated(async () => {
  console.log('[HistoryView] 视图已激活，刷新历史记录');
  await historyManager.loadHistory();
});

// 格式化时间
const formatTime = (timestamp: number) => {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
};

// 获取缩略图 URL
const getThumbUrl = (item: HistoryItem): string | undefined => {
  if (!item.results || item.results.length === 0) {
    return undefined;
  }

  // 优先使用主力图床的结果
  const primaryResult = item.results.find(r => r.serviceId === item.primaryService && r.status === 'success');
  if (primaryResult?.result?.url) {
    // 对于微博图床，使用中等尺寸缩略图
    if (primaryResult.serviceId === 'weibo' && primaryResult.result.fileKey) {
      let thumbUrl = `https://tvax1.sinaimg.cn/bmiddle/${primaryResult.result.fileKey}.jpg`;

      // 应用链接前缀（如果启用）
      const activePrefix = getActivePrefix(configManager.config.value);
      if (activePrefix) {
        thumbUrl = `${activePrefix}${thumbUrl}`;
      }

      return thumbUrl;
    }
    // 其他图床直接使用 URL
    return primaryResult.result.url;
  }

  // 如果主力图床没有结果，使用任何成功的结果
  const anySuccess = item.results.find(r => r.status === 'success' && r.result?.url);
  if (anySuccess?.result?.url) {
    // 对于微博图床，使用中等尺寸缩略图
    if (anySuccess.serviceId === 'weibo' && anySuccess.result.fileKey) {
      let thumbUrl = `https://tvax1.sinaimg.cn/bmiddle/${anySuccess.result.fileKey}.jpg`;

      // 应用链接前缀（如果启用）
      const activePrefix = getActivePrefix(configManager.config.value);
      if (activePrefix) {
        thumbUrl = `${activePrefix}${thumbUrl}`;
      }

      return thumbUrl;
    }
    return anySuccess.result.url;
  }

  return undefined;
};

// 获取服务标签颜色
const getServiceSeverity = (service: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | undefined => {
  const severityMap: Record<string, any> = {
    weibo: 'info',
    r2: 'success',
    tcl: 'warn',
    jd: 'danger',
    nowcoder: 'secondary',
    qiyu: 'info',
    zhihu: 'info',
    nami: 'success'
  };
  return severityMap[service] || 'secondary';
};

// 获取服务名称
const getServiceName = (serviceId: ServiceType): string => {
  const serviceNames: Record<ServiceType, string> = {
    weibo: '微博',
    r2: 'R2',
    tcl: 'TCL',
    jd: '京东',
    nowcoder: '牛客',
    qiyu: '七鱼',
    zhihu: '知乎',
    nami: '纳米'
  };
  return serviceNames[serviceId] || serviceId;
};
</script>

<template>
  <div class="history-view">
    <div class="history-container">
      <!-- 工具栏 -->
      <div class="history-toolbar">
        <!-- 第一行：批量操作 + 视图切换 -->
        <div class="toolbar-row">
          <div class="bulk-actions">
            <Checkbox
              v-model="selectAll"
              @change="handleSelectAll"
              :binary="true"
              :indeterminate="isSomeSelected && !isAllSelected"
              inputId="select-all"
            />
            <label for="select-all" class="select-all-label">全选</label>

            <Button
              label="批量复制"
              icon="pi pi-copy"
              @click="handleBulkCopy"
              :disabled="!historyManager.hasSelection.value"
              size="small"
              outlined
            />
            <Button
              label="导出 JSON"
              icon="pi pi-download"
              @click="handleBulkExport"
              :disabled="!historyManager.hasSelection.value"
              size="small"
              outlined
            />
            <Button
              label="批量删除"
              icon="pi pi-trash"
              @click="handleBulkDelete"
              :disabled="!historyManager.hasSelection.value"
              severity="danger"
              size="small"
              outlined
            />
          </div>

          <SelectButton
            v-model="historyManager.historyState.value.viewMode"
            :options="viewOptions"
            optionLabel="label"
            optionValue="value"
            class="view-mode-toggle"
          >
            <template #option="slotProps">
              <i :class="slotProps.option.icon"></i>
            </template>
          </SelectButton>
        </div>

        <!-- 第二行：筛选和搜索 -->
        <div class="filter-search-row">
          <Select
            v-model="historyManager.historyState.value.currentFilter"
            :options="serviceOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="筛选图床"
            class="service-filter"
          />

          <div class="search-wrapper">
            <i class="pi pi-search search-icon"></i>
            <InputText
              v-model="historyManager.searchTerm.value"
              placeholder="搜索本地文件名..."
              class="search-input"
            />
          </div>
        </div>
      </div>

      <!-- 表格视图 -->
      <DataTable
        v-if="historyManager.historyState.value.viewMode === 'table'"
        key="table-view"
        :value="historyManager.filteredItems.value"
        dataKey="id"
        paginator
        :rows="20"
        :rowsPerPageOptions="[10, 20, 50, 100]"
        sortField="timestamp"
        :sortOrder="-1"
        class="history-table"
        :emptyMessage="historyManager.allHistoryItems.value.length === 0 ? '暂无历史记录' : '未找到匹配的记录'"
      >
        <!-- 自定义复选框列 -->
        <Column headerStyle="width: 3rem">
          <template #header>
            <Checkbox
              :model-value="isAllSelected"
              @update:model-value="handleHeaderCheckboxChange"
              :binary="true"
              :indeterminate="isSomeSelected && !isAllSelected"
            />
          </template>
          <template #body="slotProps">
            <Checkbox
              :model-value="historyManager.historyState.value.selectedItems.has(slotProps.data.id)"
              @update:model-value="historyManager.toggleSelection(slotProps.data.id)"
              :binary="true"
            />
          </template>
        </Column>

        <Column field="thumbUrl" header="预览" style="width: 80px">
          <template #body="slotProps">
            <Image
              v-if="getThumbUrl(slotProps.data)"
              :src="getThumbUrl(slotProps.data)"
              :alt="slotProps.data.localFileName"
              preview
              class="preview-thumbnail"
            />
            <i v-else class="pi pi-image preview-placeholder"></i>
          </template>
        </Column>

        <Column field="localFileName" header="本地文件名" sortable>
          <template #body="slotProps">
            <span class="file-name" :title="slotProps.data.localFileName">
              {{ slotProps.data.localFileName }}
            </span>
          </template>
        </Column>

        <Column field="primaryService" header="主图床" sortable style="width: 100px">
          <template #body="slotProps">
            <Tag
              :value="getServiceName(slotProps.data.primaryService)"
              :severity="getServiceSeverity(slotProps.data.primaryService)"
            />
          </template>
        </Column>

        <Column field="timestamp" header="上传时间" sortable style="width: 180px">
          <template #body="slotProps">
            <span class="timestamp">{{ formatTime(slotProps.data.timestamp) }}</span>
          </template>
        </Column>

        <Column header="操作" style="width: 120px">
          <template #body="slotProps">
            <div class="action-buttons">
              <Button
                icon="pi pi-copy"
                @click="handleCopyLink(slotProps.data)"
                size="small"
                text
                rounded
                v-tooltip.top="'复制主链接'"
              />
              <Button
                icon="pi pi-trash"
                @click="handleDeleteItem(slotProps.data)"
                severity="danger"
                size="small"
                text
                rounded
                v-tooltip.top="'删除'"
              />
            </div>
          </template>
        </Column>
      </DataTable>

      <!-- 瀑布流视图 -->
      <DataView
        v-else
        key="grid-view"
        :value="historyManager.filteredItems.value"
        layout="grid"
        paginator
        :rows="24"
        class="history-grid"
      >
        <template #empty>
          <div class="grid-empty">
            <i class="pi pi-images empty-icon"></i>
            <p>{{ historyManager.allHistoryItems.value.length === 0 ? '暂无历史记录' : '未找到匹配的记录' }}</p>
          </div>
        </template>

        <template #grid="slotProps">
          {{ console.log('[DataView Grid] slotProps:', slotProps) }}
          {{ console.log('[DataView Grid] slotProps.items:', slotProps.items) }}
          <div class="grid-container">
            <div v-for="item in slotProps.items" :key="item.id" class="grid-item">
              <div class="grid-item-card">
                <Checkbox
                  :model-value="historyManager.historyState.value.selectedItems.has(item.id)"
                  @update:model-value="historyManager.toggleSelection(item.id)"
                  :binary="true"
                  class="grid-item-checkbox"
                />

                <Image
                  v-if="getThumbUrl(item)"
                  :src="getThumbUrl(item)"
                  :alt="item.localFileName"
                  preview
                  class="grid-item-image"
                />
                <div v-else class="grid-item-placeholder">
                  <i class="pi pi-image"></i>
                </div>

                <div class="grid-item-info">
                  <p class="grid-item-name" :title="item.localFileName">
                    {{ item.localFileName }}
                  </p>
                  <div class="grid-item-meta">
                    <Tag
                      :value="getServiceName(item.primaryService)"
                      :severity="getServiceSeverity(item.primaryService)"
                      size="small"
                    />
                    <span class="grid-item-time">{{ formatTime(item.timestamp) }}</span>
                  </div>
                </div>

                <div class="grid-item-actions">
                  <Button
                    icon="pi pi-copy"
                    @click="handleCopyLink(item)"
                    size="small"
                    text
                    rounded
                  />
                  <Button
                    icon="pi pi-trash"
                    @click="handleDeleteItem(item)"
                    severity="danger"
                    size="small"
                    text
                    rounded
                  />
                </div>
              </div>
            </div>
          </div>
        </template>
      </DataView>

      <!-- 底部操作栏 -->
      <div class="history-footer">
        <Button
          label="清空历史"
          icon="pi pi-trash"
          @click="handleClearHistory"
          severity="danger"
          outlined
        />
        <p class="footer-hint">
          💡 提示：导出和同步功能已移至"备份与同步中心"
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-view {
  height: 100%;
  overflow-y: auto;
  padding: 20px;
  background: var(--bg-app);
  min-height: 400px; /* 临时调试：确保最小高度 */
}

.history-container {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 工具栏 */
.history-toolbar {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.bulk-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.select-all-label {
  margin-right: 8px;
  cursor: pointer;
  user-select: none;
  color: var(--text-primary);
}

.view-mode-toggle {
  flex-shrink: 0;
}

.filter-search-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.service-filter {
  min-width: 150px;
}

.search-wrapper {
  flex: 1;
  position: relative;
  max-width: 400px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding-left: 40px;
}

/* 表格视图 */
.history-table {
  background: var(--bg-card);
  border-radius: 12px;
  overflow: hidden;
  min-height: 200px; /* 临时调试：确保表格可见 */
}

/* 修复 PrimeVue DataTable 空状态样式 */
:deep(.p-datatable-empty-message) {
  color: var(--text-secondary) !important;
  text-align: center;
  padding: 60px 20px;
  font-size: 1rem;
}

:deep(.p-datatable-emptymessage td) {
  color: var(--text-secondary) !important;
}

.preview-thumbnail {
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 6px;
  cursor: pointer;
}

.preview-placeholder {
  font-size: 2rem;
  color: var(--text-muted);
  opacity: 0.5;
}

.file-name {
  display: block;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timestamp {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.action-buttons {
  display: flex;
  gap: 4px;
}

/* 瀑布流视图 */
.history-grid {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 20px;
  min-height: 200px; /* 临时调试：确保瀑布流可见 */
}

:deep(.p-dataview-content) {
  background: transparent;
}

.grid-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  width: 100%;
}

.grid-empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary) !important;
  font-size: 1rem;
}

.grid-empty p {
  color: var(--text-secondary) !important;
  margin: 0;
}

.empty-icon {
  font-size: 4rem;
  color: var(--text-secondary) !important;
  opacity: 0.5;
  margin-bottom: 16px;
}

.grid-item-card {
  position: relative;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s;
}

.grid-item-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-float);
}

.grid-item-checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  background: var(--bg-card);
  padding: 4px;
  border-radius: 4px;
}

.grid-item-image {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  cursor: pointer;
}

.grid-item-placeholder {
  width: 100%;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-app);
  color: var(--text-muted);
  font-size: 3rem;
  opacity: 0.5;
}

.grid-item-info {
  padding: 12px;
}

.grid-item-name {
  margin: 0 0 8px 0;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grid-item-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.grid-item-time {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.grid-item-actions {
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 8px;
  background: var(--bg-app);
  border-top: 1px solid var(--border-subtle);
}

/* 底部 */
.history-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
}

.footer-hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

/* 滚动条 */
.history-view::-webkit-scrollbar {
  width: 8px;
}

.history-view::-webkit-scrollbar-track {
  background: var(--bg-input);
}

.history-view::-webkit-scrollbar-thumb {
  background: var(--border-subtle);
  border-radius: 4px;
}

.history-view::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}
</style>
