<script setup lang="ts">
import { ref, computed, onMounted, onActivated, watch, nextTick } from 'vue';
import { writeText } from '@tauri-apps/api/clipboard';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import DataView from 'primevue/dataview';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Select from 'primevue/select';
import Dialog from 'primevue/dialog';
import Tag from 'primevue/tag';
import Skeleton from 'primevue/skeleton';
import type { HistoryItem, ServiceType } from '../../config/types';
import { getActivePrefix } from '../../config/types';
import { useHistoryManager, type ViewMode } from '../../composables/useHistory';
import { useToast } from '../../composables/useToast';
import { useConfigManager } from '../../composables/useConfig';
import { debounce } from '../../utils/debounce';

// 【性能优化】DateTimeFormat 提取到组件外，全局复用
// 避免每次渲染时创建新实例，减少 GC 压力
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

const toast = useToast();
const historyManager = useHistoryManager();
const configManager = useConfigManager();

// 本地搜索词（用于防抖）
const localSearchTerm = ref('');

// 防抖更新搜索词
const debouncedSearch = debounce((term: string) => {
  historyManager.searchTerm.value = term;
}, 300);

// 缩略图 URL 缓存
const thumbUrlCache = new Map<string, string | undefined>();

// 清空缩略图缓存
const clearThumbCache = () => {
  thumbUrlCache.clear();
};

// 【性能优化】优化缓存清空策略
// 数据变化时增量清理（只删除已移除项的缓存）
watch(() => historyManager.allHistoryItems.value, (newItems) => {
  const newIds = new Set(newItems.map(i => i.id));
  for (const id of thumbUrlCache.keys()) {
    if (!newIds.has(id)) {
      thumbUrlCache.delete(id);
    }
  }
}, { deep: false });

// 只监听影响 URL 的前缀配置项，避免 deep: true 的开销
watch(
  () => configManager.config.value?.linkPrefixConfig?.enabled,
  clearThumbCache
);

watch(
  () => configManager.config.value?.linkPrefixConfig?.selectedIndex,
  clearThumbCache
);


// 视图选项
const viewOptions = ref([
  { label: '表格', value: 'table' as ViewMode, icon: 'pi pi-table' },
  { label: '瀑布流', value: 'grid' as ViewMode, icon: 'pi pi-th-large' }
]);

// Lightbox 状态
const lightboxVisible = ref(false);
const lightboxImage = ref('');
const lightboxTitle = ref('');
const lightboxItem = ref<HistoryItem | null>(null);

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

// 标志位：防止首次加载时重复刷新
const isFirstMount = ref(true);

// 【性能优化】计算属性：是否全选 - 直接使用 selectedIdsRef
const isAllSelected = computed(() => {
  const currentItems = historyManager.filteredItems.value;
  if (currentItems.length === 0) return false;
  const selectedSet = historyManager.selectedIdsRef.value;
  return currentItems.every(item => selectedSet.has(item.id));
});

// 【性能优化】计算属性：是否部分选中 - 直接使用 selectedIdsRef
const isSomeSelected = computed(() => {
  const currentItems = historyManager.filteredItems.value;
  if (currentItems.length === 0) return false;
  const selectedSet = historyManager.selectedIdsRef.value;
  const selectedCount = currentItems.filter(item => selectedSet.has(item.id)).length;
  return selectedCount > 0 && selectedCount < currentItems.length;
});

// 处理表头复选框变化
const handleHeaderCheckboxChange = (checked: boolean) => {
  selectAll.value = checked;
  handleSelectAll();
};

// 【性能优化】移除冗余 watch
// stopWatchViewMode 和 stopWatchFilter 已删除
// 视图模式通过按钮点击直接调用 switchViewMode
// 筛选器通过 Select 的 @update:model-value 直接调用 setFilter

// 监听本地搜索词变化（防抖）- 保留，用于搜索功能
watch(localSearchTerm, (newTerm) => {
  debouncedSearch(newTerm);
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

// 清空历史
const handleClearHistory = async () => {
  await historyManager.clearHistory();
};

// 加载历史记录
onMounted(async () => {
  console.log('[HistoryView] 组件已挂载，开始加载历史记录');
  await historyManager.loadHistory();  // 首次加载（或使用缓存）
  await nextTick();
  isFirstMount.value = false;
});

// 【性能优化】视图激活时检查是否需要刷新
onActivated(async () => {
  // 只有数据为空时才加载，否则使用缓存
  if (!isFirstMount.value && historyManager.allHistoryItems.value.length === 0) {
    console.log('[HistoryView] 视图已激活，数据为空，刷新历史记录');
    await historyManager.loadHistory();
  }
});

// 注意：不再清理 watchers，因为使用单例模式后状态是共享的
// watchers 需要保持活跃以响应 UI 交互

// 【性能优化】格式化时间 - 使用预创建的 formatter
const formatTime = (timestamp: number) => dateFormatter.format(new Date(timestamp));

// 在浏览器中打开链接
const openInBrowser = async (item: HistoryItem) => {
  try {
    if (!item.generatedLink) {
      toast.warn('无可用链接', '该项目没有可用的链接');
      return;
    }

    // 动态应用前缀（与 handleCopyLink 逻辑一致）
    let finalLink = item.generatedLink;
    if (item.primaryService === 'weibo') {
      const activePrefix = getActivePrefix(configManager.config.value);
      if (activePrefix) {
        finalLink = `${activePrefix}${item.generatedLink}`;
      }
    }

    // 使用 Tauri 的 shell 打开链接
    const { open } = await import('@tauri-apps/api/shell');
    await open(finalLink);
  } catch (error) {
    console.error('[历史记录] 打开链接失败:', error);
    toast.error('打开失败', String(error));
  }
};

// 获取缩略图 URL（带缓存）
const getThumbUrl = (item: HistoryItem): string | undefined => {
  // 检查缓存
  if (thumbUrlCache.has(item.id)) {
    return thumbUrlCache.get(item.id);
  }

  let result: string | undefined;

  if (!item.results || item.results.length === 0) {
    result = undefined;
  } else {
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

        result = thumbUrl;
      } else {
        // 其他图床直接使用 URL
        result = primaryResult.result.url;
      }
    } else {
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

          result = thumbUrl;
        } else {
          result = anySuccess.result.url;
        }
      }
    }
  }

  // 缓存结果
  thumbUrlCache.set(item.id, result);
  return result;
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

// 获取所有成功上传的图床
const getSuccessfulServices = (item: HistoryItem): ServiceType[] => {
  return item.results
    .filter(r => r.status === 'success')
    .map(r => r.serviceId);
};

// 获取特定图床的链接（经过处理的链接）
const getServiceLink = (item: HistoryItem, serviceId: ServiceType): string | null => {
  const result = item.results.find(r => r.serviceId === serviceId && r.status === 'success');
  if (!result?.result?.url) return null;

  let link = result.result.url;

  // 微博图床需要应用前缀配置（与 handleCopyLink 函数逻辑一致）
  if (serviceId === 'weibo') {
    const activePrefix = getActivePrefix(configManager.config.value);
    if (activePrefix) {
      link = `${activePrefix}${link}`;
    }
  }

  return link;
};

// 复制特定图床的链接
const handleCopyServiceLink = async (item: HistoryItem, serviceId: ServiceType) => {
  try {
    const link = getServiceLink(item, serviceId);
    if (!link) {
      toast.warn('无可用链接', `${getServiceName(serviceId)} 图床没有可用的链接`);
      return;
    }

    await writeText(link);
    toast.success('已复制', `${getServiceName(serviceId)} 链接已复制到剪贴板`, 1500);
  } catch (error) {
    console.error(`[历史记录] 复制 ${serviceId} 链接失败:`, error);
    toast.error('复制失败', String(error));
  }
};

// === Lightbox 相关函数 ===

// 获取大图 URL（微博使用 large 尺寸）
const getLargeImageUrl = (item: HistoryItem): string => {
  const result = item.results.find(r =>
    r.serviceId === item.primaryService && r.status === 'success'
  );

  if (!result?.result?.url) return '';

  // 微博图床：使用 large 尺寸（而非 bmiddle）
  if (result.serviceId === 'weibo' && result.result.fileKey) {
    let largeUrl = `https://tvax1.sinaimg.cn/large/${result.result.fileKey}.jpg`;

    const activePrefix = getActivePrefix(configManager.config.value);
    if (activePrefix) {
      largeUrl = `${activePrefix}${largeUrl}`;
    }

    return largeUrl;
  }

  return result.result.url;
};

// 打开 Lightbox
const openLightbox = (item: HistoryItem): void => {
  lightboxItem.value = item;
  lightboxImage.value = getLargeImageUrl(item);
  lightboxTitle.value = item.localFileName;
  lightboxVisible.value = true;
};

// 从 Lightbox 删除单项
const deleteSingleItem = async (item: HistoryItem): Promise<void> => {
  try {
    await historyManager.deleteHistoryItem(item.id);
    lightboxVisible.value = false;
    toast.success('删除成功', '已删除 1 条记录');
  } catch (error) {
    console.error('[历史记录] 删除失败:', error);
    toast.error('删除失败', String(error));
  }
};

// === 网格视图辅助函数 ===

// 【性能优化】检查网格项是否选中 - 直接使用 selectedIdsRef
const isGridSelected = (item: HistoryItem): boolean => {
  return historyManager.selectedIdsRef.value.has(item.id);
};

// 切换网格项选中状态
const toggleGridSelection = (item: HistoryItem): void => {
  historyManager.toggleSelection(item.id);
};

// 获取预览图 URL（复用 getThumbUrl）
const getPreviewUrl = (item: HistoryItem): string | undefined => {
  return getThumbUrl(item);
};
</script>

<template>
  <div class="history-view">
    <div class="history-container">
      <!-- Dashboard Strip -->
      <div class="dashboard-strip">
        <!-- 左侧区域：标题 + 视图切换 -->
        <div class="strip-left">
          <span class="view-title">上传历史</span>
          <div class="v-divider"></div>

          <div class="view-switcher">
            <button
              v-for="opt in viewOptions"
              :key="opt.value"
              class="switch-btn"
              :class="{ active: historyManager.historyState.value.viewMode === opt.value }"
              @click="historyManager.switchViewMode(opt.value)"
              :title="opt.label"
            >
              <i :class="opt.icon"></i>
            </button>
          </div>
        </div>

        <!-- 中间区域：搜索 + 筛选 -->
        <div class="strip-center">
          <div class="search-bar">
            <i class="pi pi-search search-icon"></i>
            <input
              v-model="localSearchTerm"
              type="text"
              placeholder="搜索文件名..."
              class="search-input"
            />
            <i
              v-if="localSearchTerm"
              class="pi pi-times clear-icon"
              @click="localSearchTerm = ''; historyManager.searchTerm.value = ''"
            ></i>
          </div>

          <Select
            :model-value="historyManager.historyState.value.currentFilter"
            @update:model-value="historyManager.setFilter($event)"
            :options="serviceOptions"
            optionLabel="label"
            optionValue="value"
            class="filter-select"
          />
        </div>

        <!-- 右侧区域：统计/批量操作 + 清空 -->
        <div class="strip-right">
          <!-- 未选中：显示统计 -->
          <span class="stats-text" v-if="!historyManager.hasSelection.value">
            共 {{ historyManager.filteredItems.value.length }} 项
          </span>

          <!-- 选中：显示批量操作 -->
          <div v-else class="batch-actions">
            <span class="selected-count">已选 {{ historyManager.selectedIds.value.length }}</span>
            <Button
              icon="pi pi-copy"
              text
              rounded
              size="small"
              @click="handleBulkCopy"
              v-tooltip.bottom="'批量复制链接'"
            />
            <Button
              icon="pi pi-download"
              text
              rounded
              size="small"
              @click="handleBulkExport"
              v-tooltip.bottom="'导出 JSON'"
            />
            <Button
              icon="pi pi-trash"
              severity="danger"
              text
              rounded
              size="small"
              @click="handleBulkDelete"
              v-tooltip.bottom="'批量删除'"
            />
            <Button
              icon="pi pi-times"
              text
              rounded
              size="small"
              @click="historyManager.clearSelection()"
              v-tooltip.bottom="'取消选择'"
            />
          </div>

          <div class="v-divider"></div>

          <Button
            icon="pi pi-trash"
            class="icon-only-btn danger-hover"
            text
            rounded
            @click="handleClearHistory"
            v-tooltip.bottom="'清空所有历史'"
          />
        </div>
      </div>

      <!-- 加载状态骨架屏 -->
      <div v-if="historyManager.isLoading.value" class="loading-skeleton">
        <div class="skeleton-header">
          <Skeleton width="3rem" height="1.5rem" />
          <Skeleton width="60px" height="36px" />
          <Skeleton width="200px" height="1.5rem" />
          <Skeleton width="180px" height="1.5rem" />
          <Skeleton width="120px" height="1.5rem" />
        </div>
        <div v-for="i in 8" :key="i" class="skeleton-row">
          <Skeleton width="1.5rem" height="1.5rem" />
          <Skeleton width="36px" height="36px" />
          <Skeleton width="70%" height="1rem" />
          <Skeleton width="100px" height="1.5rem" />
          <Skeleton width="60px" height="1.5rem" />
        </div>
      </div>

      <!-- 表格视图 -->
      <DataTable
        v-else-if="historyManager.historyState.value.viewMode === 'table'"
        key="table-view"
        :value="historyManager.filteredItems.value"
        dataKey="id"
        paginator
        :rows="20"
        :rowsPerPageOptions="[10, 20, 50, 100]"
        sortField="timestamp"
        :sortOrder="-1"
        class="history-table minimal-table"
        :emptyMessage="historyManager.allHistoryItems.value.length === 0 ? '暂无历史记录' : '未找到匹配的记录'"
      >
        <template #empty>
          <div class="empty-state">
            <i class="pi pi-folder-open"></i>
            <p>没有找到相关记录</p>
          </div>
        </template>

        <!-- 复选框列 -->
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
              :model-value="historyManager.selectedIdsRef.value.has(slotProps.data.id)"
              @update:model-value="historyManager.toggleSelection(slotProps.data.id)"
              :binary="true"
            />
          </template>
        </Column>

        <!-- 预览列（36px 缩略图） -->
        <Column header="预览" style="width: 60px">
          <template #body="slotProps">
            <div class="thumb-box" @click="openLightbox(slotProps.data)">
              <img
                v-if="getThumbUrl(slotProps.data)"
                :src="getThumbUrl(slotProps.data)"
                :alt="slotProps.data.localFileName"
                loading="lazy"
                @error="(e: any) => e.target.src = '/placeholder.png'"
              />
              <i v-else class="pi pi-image thumb-placeholder"></i>
            </div>
          </template>
        </Column>

        <!-- 文件名列 -->
        <Column field="localFileName" header="文件名" sortable style="min-width: 200px">
          <template #body="slotProps">
            <div class="filename-cell">
              <span class="fname" :title="slotProps.data.localFileName">
                {{ slotProps.data.localFileName }}
              </span>
              <span class="fdate">{{ formatTime(slotProps.data.timestamp) }}</span>
            </div>
          </template>
        </Column>

        <!-- 已传图床列 -->
        <Column header="已传图床" style="width: 180px">
          <template #body="slotProps">
            <div class="service-badges">
              <Tag
                v-for="serviceId in getSuccessfulServices(slotProps.data)"
                :key="serviceId"
                :value="getServiceName(serviceId)"
                severity="secondary"
                class="mini-tag"
                @click="handleCopyServiceLink(slotProps.data, serviceId)"
                v-tooltip.top="`点击复制${getServiceName(serviceId)}链接`"
              />
            </div>
          </template>
        </Column>

        <!-- 链接操作列 -->
        <Column header="链接" style="width: 120px; text-align: center;">
          <template #body="slotProps">
            <div class="link-actions">
              <Button
                icon="pi pi-copy"
                text
                rounded
                size="small"
                class="action-icon-btn"
                @click="handleCopyLink(slotProps.data)"
                v-tooltip.top="'复制链接'"
              />
              <Button
                icon="pi pi-external-link"
                text
                rounded
                size="small"
                class="action-icon-btn"
                @click="openLightbox(slotProps.data)"
                v-tooltip.top="'查看大图'"
              />
            </div>
          </template>
        </Column>
      </DataTable>

      <!-- 网格视图（Instagram 风格） -->
      <DataView
        v-else-if="!historyManager.isLoading.value"
        key="grid-view"
        :value="historyManager.filteredItems.value"
        layout="grid"
        paginator
        :rows="24"
        class="history-grid-view"
      >
        <template #empty>
          <div class="empty-state">
            <i class="pi pi-folder-open"></i>
            <p>{{ historyManager.allHistoryItems.value.length === 0 ? '暂无历史记录' : '未找到匹配的记录' }}</p>
          </div>
        </template>

        <template #grid="slotProps">
          <div class="instagram-grid">
            <div
              v-for="item in slotProps.items"
              :key="item.id"
              class="grid-tile"
              :class="{ selected: isGridSelected(item) }"
              @click="toggleGridSelection(item)"
            >
              <!-- 图片区域 -->
              <div class="tile-image">
                <img
                  v-if="getPreviewUrl(item)"
                  :src="getPreviewUrl(item)"
                  :alt="item.localFileName"
                  loading="lazy"
                  @click.stop="openLightbox(item)"
                  @error="(e: any) => e.target.src = '/placeholder.png'"
                />
                <div v-else class="tile-placeholder">
                  <i class="pi pi-image"></i>
                </div>
              </div>

              <!-- 选中指示器 -->
              <div v-if="isGridSelected(item)" class="tile-selection-overlay">
                <i class="pi pi-check-circle"></i>
              </div>

              <!-- HUD 悬浮层 -->
              <div class="tile-hud">
                <div class="hud-top">
                  <span class="hud-filename" :title="item.localFileName">
                    {{ item.localFileName }}
                  </span>
                </div>
                <div class="hud-bottom">
                  <button
                    @click.stop="handleCopyLink(item)"
                    :title="'复制链接'"
                  >
                    <i class="pi pi-copy"></i>
                  </button>
                  <button
                    @click.stop="openLightbox(item)"
                    :title="'查看大图'"
                  >
                    <i class="pi pi-eye"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </DataView>

      <!-- Lightbox 图片查看器 -->
      <Dialog
        v-model:visible="lightboxVisible"
        modal
        :dismissableMask="true"
        :showHeader="false"
        class="lightbox-dialog"
        :style="{ width: 'auto', maxWidth: '90vw', background: 'transparent', boxShadow: 'none', border: 'none' }"
        :contentStyle="{ padding: 0, background: 'transparent' }"
      >
        <div class="lightbox-container" @click="lightboxVisible = false">
          <img :src="lightboxImage" class="lightbox-img" @click.stop />

          <div class="lightbox-caption" @click.stop>
            <div class="lightbox-info">
              <span class="lightbox-title">{{ lightboxTitle }}</span>
              <span class="lightbox-time" v-if="lightboxItem">{{ formatTime(lightboxItem.timestamp) }}</span>
            </div>

            <div class="lightbox-actions" v-if="lightboxItem">
              <Button
                icon="pi pi-copy"
                text
                rounded
                class="text-white"
                @click="handleCopyLink(lightboxItem)"
                v-tooltip.top="'复制链接'"
              />
              <Button
                icon="pi pi-external-link"
                text
                rounded
                class="text-white"
                @click="openInBrowser(lightboxItem)"
                v-tooltip.top="'在浏览器打开'"
              />
              <Button
                icon="pi pi-trash"
                severity="danger"
                text
                rounded
                class="text-white"
                @click="deleteSingleItem(lightboxItem)"
                v-tooltip.top="'删除'"
              />
            </div>
          </div>
        </div>
      </Dialog>

    </div>
  </div>
</template>

<style scoped>
/* CSS 变量 */
.history-view {
  --thumbnail-size: 60px;
}

.history-view {
  height: 100%;
  overflow-y: auto;
  padding: 20px;
  background: var(--bg-app);
  min-height: 400px; /* 临时调试：确保最小高度 */
}

.history-container {
  max-width: 850px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* === Dashboard Strip（顶部控制条）=== */
.dashboard-strip {
  flex-shrink: 0;
  height: 60px;
  background-color: var(--bg-card);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  z-index: 10;
}

.strip-left,
.strip-center,
.strip-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.strip-center {
  flex: 1;
  justify-content: center;
  max-width: 600px;
}

/* 视图标题 */
.view-title {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 15px;
  white-space: nowrap;
}

/* 竖线分隔符 */
.v-divider {
  width: 1px;
  height: 20px;
  background-color: var(--border-subtle);
}

/* 视图切换器 */
.view-switcher {
  display: flex;
  background: var(--bg-input);
  border-radius: 6px;
  padding: 2px;
  border: 1px solid var(--border-subtle);
}

.switch-btn {
  border: none;
  background: transparent;
  width: 32px;
  height: 28px;
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.switch-btn:hover {
  color: var(--text-primary);
}

.switch-btn.active {
  background-color: var(--bg-card);
  color: var(--primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

/* 搜索框（胶囊样式） */
.search-bar {
  display: flex;
  align-items: center;
  background-color: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  padding: 0 12px;
  width: 280px;
  height: 32px;
  transition: all 0.2s;
}

.search-bar:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  width: 320px;
}

.search-input {
  border: none;
  background: transparent;
  outline: none;
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
  margin: 0 8px;
}

.search-icon,
.clear-icon {
  color: var(--text-secondary);
  font-size: 13px;
}

.clear-icon {
  cursor: pointer;
}

.clear-icon:hover {
  color: var(--text-primary);
}

/* 筛选下拉 */
.filter-select {
  height: 32px;
  border-radius: 6px !important;
  font-size: 13px !important;
  width: 140px;
}

/* 统计与操作 */
.stats-text {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  animation: fadeIn 0.2s ease;
}

.selected-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
  background: rgba(59, 130, 246, 0.1);
  padding: 2px 8px;
  border-radius: 10px;
}

.icon-only-btn {
  width: 32px;
  height: 32px;
}

.danger-hover:hover {
  color: var(--error) !important;
  background: rgba(239, 68, 68, 0.1) !important;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* === 表格视图（极简风格）=== */
.history-table {
  background: var(--bg-card);
  border-radius: 12px;
  overflow: hidden;
}

.minimal-table {
  height: 100%;
}

/* 表头样式 */
:deep(.minimal-table .p-datatable-thead > tr > th) {
  background: var(--bg-card) !important;
  border-bottom: 2px solid var(--border-subtle) !important;
  padding: 10px 16px !important;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
}

/* 行样式 */
:deep(.minimal-table .p-datatable-tbody > tr) {
  background: transparent !important;
}

:deep(.minimal-table .p-datatable-tbody > tr:nth-child(even)) {
  background: rgba(0, 0, 0, 0.015) !important;
}

:deep(.minimal-table .p-datatable-tbody > tr:hover) {
  background: var(--hover-overlay-subtle) !important;
}

/* 单元格样式 */
:deep(.minimal-table .p-datatable-tbody > tr > td) {
  padding: 8px 16px !important;
  border-bottom: 1px solid var(--border-subtle) !important;
  font-size: 13px;
  vertical-align: middle;
}

/* 缩略图盒子（36px 正方形） */
.thumb-box {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  cursor: zoom-in;
  background: var(--bg-input);
  display: inline-block;
}

.thumb-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-placeholder {
  font-size: 1.5rem;
  color: var(--text-muted);
  opacity: 0.5;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

/* 文件名单元格 */
.filename-cell {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.fname {
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fdate {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

/* 服务徽章 */
.service-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.mini-tag {
  font-size: 11px !important;
  padding: 2px 6px !important;
  height: auto !important;
  cursor: pointer;
  transition: all 0.2s;
}

.mini-tag:hover {
  transform: translateY(-1px);
  filter: brightness(1.1);
}

/* 链接操作 */
.link-actions {
  display: flex;
  justify-content: center;
  gap: 4px;
}

.action-icon-btn {
  color: var(--text-secondary) !important;
  width: 28px !important;
  height: 28px !important;
}

.action-icon-btn:hover {
  color: var(--primary) !important;
  background: rgba(59, 130, 246, 0.1) !important;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--text-muted);
  gap: 16px;
}

.empty-state i {
  font-size: 48px;
  opacity: 0.5;
}

/* 图床按钮容器（保留用于兼容） */
.service-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

/* 图床按钮样式 */
.service-tag-btn {
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.875rem;
  border-radius: 4px !important;
}

.service-tag-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  filter: brightness(1.1);
}

/* === 网格视图（Instagram 风格）=== */
.history-grid-view {
  background: var(--bg-card);
  border-radius: 12px;
  overflow: hidden;
  padding: 20px;
}

:deep(.history-grid-view .p-dataview-content) {
  background: transparent;
}

/* Instagram 网格容器 */
.instagram-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;  /* 用户指定 12px */
  width: 100%;
}

/* 网格格子（正方形） */
.grid-tile {
  position: relative;
  aspect-ratio: 1;  /* 正方形 */
  overflow: hidden;
  cursor: pointer;
  background: var(--bg-input);
  border-radius: 8px;
  transition: transform 0.2s;
}

.grid-tile:hover {
  z-index: 2;
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

/* 选中状态：蓝色边框框住 */
.grid-tile.selected {
  box-shadow: inset 0 0 0 3px var(--primary);
}

/* 图片铺满 */
.tile-image {
  width: 100%;
  height: 100%;
}

.tile-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.tile-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 3rem;
  opacity: 0.3;
}

/* 选中指示器 */
.tile-selection-overlay {
  position: absolute;
  top: 6px;
  right: 6px;
  color: var(--primary);
  background: white;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

/* HUD 悬浮层（默认隐藏） */
.tile-hud {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  top: 0;
  background: rgba(0, 0, 0, 0.4);
  opacity: 0;
  transition: opacity 0.2s;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 10px;
}

.grid-tile:hover .tile-hud {
  opacity: 1;
}

/* HUD 顶部（文件名） */
.hud-top {
  text-align: left;
}

.hud-filename {
  color: white;
  font-size: 11px;
  font-weight: 500;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* HUD 底部（操作按钮） */
.hud-bottom {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.hud-bottom button {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.4);
  color: white;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.hud-bottom button:hover {
  background: white;
  color: black;
}

/* 移动端：HUD 始终显示 */
@media (hover: none) {
  .tile-hud {
    opacity: 1;
    background: linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.4) 0%,
      rgba(0, 0, 0, 0.6) 100%
    );
  }
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

/* === Lightbox 图片查看器 === */
:deep(.lightbox-dialog .p-dialog-mask) {
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(10px);
}

:deep(.lightbox-dialog .p-dialog) {
  background: transparent;
  border: none;
  box-shadow: none;
}

:deep(.lightbox-dialog .p-dialog-content) {
  padding: 0;
  background: transparent;
}

.lightbox-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  cursor: pointer;
}

.lightbox-img {
  max-width: 100%;
  max-height: 80vh;
  border-radius: 4px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  cursor: default;
}

.lightbox-caption {
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 8px 16px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  backdrop-filter: blur(10px);
  cursor: default;
}

.lightbox-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lightbox-title {
  font-size: 14px;
  font-weight: 500;
}

.lightbox-time {
  font-size: 11px;
  opacity: 0.8;
  font-family: var(--font-mono);
}

.lightbox-actions {
  display: flex;
  gap: 8px;
}

.text-white {
  color: white !important;
}

.text-white:hover {
  background: rgba(255, 255, 255, 0.2) !important;
}

/* === 加载骨架屏 === */
.loading-skeleton {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skeleton-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  border-bottom: 2px solid var(--border-subtle);
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.skeleton-row:last-child {
  border-bottom: none;
}
</style>
