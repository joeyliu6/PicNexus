<script setup lang="ts">
/**
 * 历史记录视图入口组件
 * 负责 Dashboard Strip 和视图切换
 */
import { ref, onMounted, onActivated, watch } from 'vue';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import type { ServiceType } from '../../config/types';
import { useConfigManager } from '../../composables/useConfig';
import { useHistoryManager } from '../../composables/useHistory';
import { debounce } from '../../utils/debounce';
import HistoryTableView from './history/HistoryTableView.vue';
import TimelineView from './TimelineView.vue';
import 'primeicons/primeicons.css';

// 视图模式类型
type ViewMode = 'table' | 'timeline';

const configManager = useConfigManager();
const historyManager = useHistoryManager();

// 当前视图模式
const currentViewMode = ref<ViewMode>('table');

// Dashboard 状态（控制条）
const currentFilter = ref<ServiceType | 'all'>('all');
const localSearchTerm = ref('');

// 统计数据（从子视图同步）
const totalCount = ref(0);
const selectedCount = ref(0);

// 视图选项
const viewOptions = [
  { label: '表格', value: 'table' as ViewMode, icon: 'pi pi-table' },
  { label: '时间轴', value: 'timeline' as ViewMode, icon: 'pi pi-calendar' }
];

// 图床筛选选项
const serviceOptions = [
  { label: '全部图床', value: 'all' },
  { label: '微博', value: 'weibo' },
  { label: 'R2', value: 'r2' },

  { label: '京东', value: 'jd' },
  { label: '牛客', value: 'nowcoder' },
  { label: '七鱼', value: 'qiyu' },
  { label: '知乎', value: 'zhihu' },
  { label: '纳米', value: 'nami' }
];

// 防抖搜索词
const debouncedSearchTerm = ref('');
const updateSearchTerm = debounce((term: string) => {
  debouncedSearchTerm.value = term;
}, 300);

// 监听搜索词变化
watch(localSearchTerm, (newTerm) => {
  updateSearchTerm(newTerm);
});

// 初始化：加载默认视图偏好
onMounted(async () => {
  try {
    const config = await configManager.loadConfig();
    const defaultMode = (config.galleryViewPreferences?.viewMode as any) === 'grid'
      ? 'table'
      : (config.galleryViewPreferences?.viewMode as ViewMode) ?? 'table';
    currentViewMode.value = defaultMode;
    console.log('[HistoryView] 加载默认视图模式:', defaultMode);
  } catch (error) {
    console.error('[HistoryView] 加载配置失败:', error);
  }
});

// KeepAlive 激活时刷新数据（解决上传后切换回来不更新的问题）
onActivated(async () => {
  console.log('[HistoryView] 视图被激活，检查数据更新');
  await historyManager.loadHistory();
});

// 切换视图模式
const switchViewMode = (mode: ViewMode) => {
  if (currentViewMode.value === mode) return;

  console.log('[HistoryView] 切换视图模式:', mode);

  // 重置 Dashboard 状态
  currentFilter.value = 'all';
  localSearchTerm.value = '';
  debouncedSearchTerm.value = '';
  selectedCount.value = 0;

  // 切换视图（v-if 会销毁旧组件，创建新组件）
  currentViewMode.value = mode;

  // 异步保存视图偏好（不阻塞 UI）
  queueMicrotask(async () => {
    try {
      const config = configManager.config.value;
      if (config) {
        const updatedConfig = {
          ...config,
          galleryViewPreferences: {
            ...config.galleryViewPreferences,
            viewMode: mode,
            gridColumnWidth: config.galleryViewPreferences?.gridColumnWidth ?? 220,
          }
        };
        await configManager.saveConfig(updatedConfig, true);
      }
    } catch (error) {
      console.error('[HistoryView] 保存视图偏好失败:', error);
    }
  });
};

// 处理筛选变化
const handleFilterChange = (filter: ServiceType | 'all') => {
  currentFilter.value = filter;
};

// 处理统计数据更新
const handleTotalCountUpdate = (count: number) => {
  totalCount.value = count;
};

const handleSelectedCountUpdate = (count: number) => {
  selectedCount.value = count;
};
</script>

<template>
  <div class="history-view">
    <!-- Dashboard Strip（固定顶部） -->
    <div class="dashboard-strip">
      <!-- 左侧控制区 -->
      <div class="controls-area">
        <span class="view-title">上传历史</span>

        <!-- 视图切换器 -->
        <div class="view-switcher">
          <button
            v-for="opt in viewOptions"
            :key="opt.value"
            class="switch-btn"
            :class="{ active: currentViewMode === opt.value }"
            @click="switchViewMode(opt.value)"
            :title="opt.label"
          >
            <i :class="opt.icon"></i>
          </button>
        </div>

        <!-- 图床筛选 -->
        <Select
          :model-value="currentFilter"
          @update:model-value="handleFilterChange"
          :options="serviceOptions"
          optionLabel="label"
          optionValue="value"
          class="filter-select"
        />

        <!-- 搜索框 -->
        <IconField iconPosition="left" class="search-field">
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="localSearchTerm"
            placeholder="搜索文件名..."
            class="search-input-prime"
          />
          <InputIcon
            v-if="localSearchTerm"
            class="pi pi-times clear-icon"
            @click="localSearchTerm = ''"
          />
        </IconField>
      </div>

      <!-- 右侧统计区 -->
      <div class="stats-area">
        <div class="stat-item">
          <span class="stat-val">{{ totalCount }}</span>
          <span class="stat-key">总数</span>
        </div>
        <template v-if="selectedCount > 0">
          <div class="v-divider"></div>
          <div class="stat-item selected">
            <span class="stat-val">{{ selectedCount }}</span>
            <span class="stat-key">已选</span>
          </div>
        </template>
      </div>
    </div>

    <!-- 视图容器（可滚动） -->
    <div class="history-container" :class="{ 'no-padding': currentViewMode === 'timeline' }">
      <!-- 表格视图 -->
      <HistoryTableView
        v-if="currentViewMode === 'table'"
        :filter="currentFilter"
        :search-term="debouncedSearchTerm"
        @update:total-count="handleTotalCountUpdate"
        @update:selected-count="handleSelectedCountUpdate"
      />

      <!-- 时间轴视图 -->
      <TimelineView
        v-else
        :filter="currentFilter"
        :search-term="debouncedSearchTerm"
        @update:total-count="handleTotalCountUpdate"
        @update:selected-count="handleSelectedCountUpdate"
      />
    </div>
  </div>
</template>

<style scoped>
.history-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-app);
}

.history-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  overflow-x: hidden;
  padding: 20px 24px;
}

.history-container.no-padding {
  padding: 0;
}

/* history-container 滚动条样式 */
.history-container::-webkit-scrollbar-track {
  background: transparent;
}

/* === Dashboard Strip === */
.dashboard-strip {
  flex-shrink: 0;
  height: 60px;
  background-color: var(--bg-card);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  z-index: 10;
}

/* 左侧控制区 */
.controls-area {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* 右侧统计区 */
.stats-area {
  display: flex;
  align-items: center;
  gap: 24px;
}

/* 统计项 */
.stat-item {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1;
}

.stat-val {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.stat-key {
  font-size: 10px;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin-top: 2px;
}

.stat-item.selected .stat-val {
  color: var(--primary);
}

/* 竖线分隔符 */
.v-divider {
  width: 1px;
  height: 24px;
  background-color: var(--border-subtle);
}

/* 视图标题 */
.view-title {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 16px;
  white-space: nowrap;
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

/* 搜索框 */
.search-field {
  width: 280px;
  transition: width 0.3s ease;
}

.search-field:focus-within {
  width: 320px;
}

:deep(.search-input-prime.p-inputtext) {
  background: var(--bg-input);
  border: 1px solid transparent;
  border-radius: 20px;
  padding: 0.5rem 2.5rem;
  font-size: 13px;
  color: var(--text-primary);
  transition: all 0.2s;
  height: 32px;
}

:deep(.search-input-prime.p-inputtext:focus) {
  background: var(--bg-card);
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

:deep(.search-input-prime.p-inputtext::placeholder) {
  color: var(--text-secondary);
}

:deep(.search-field .p-icon) {
  color: var(--text-secondary);
  font-size: 13px;
}

:deep(.search-field .pi-times) {
  cursor: pointer;
}

:deep(.search-field .pi-times:hover) {
  color: var(--text-primary);
}

/* 筛选下拉 */
.filter-select {
  width: 140px;
}

:deep(.filter-select.p-select) {
  height: 32px;
  border-radius: 20px;
  border: 1px solid transparent;
  background: var(--bg-input);
  font-size: 13px;
  transition: all 0.2s;
}

:deep(.filter-select.p-select:hover) {
  border-color: var(--border-subtle);
}

:deep(.filter-select.p-select.p-focus) {
  background: var(--bg-card);
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

:deep(.filter-select .p-select-label) {
  padding: 0.5rem 1rem;
  font-size: 13px;
}
</style>
