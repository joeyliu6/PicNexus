<script setup lang="ts">
/**
 * 历史记录视图入口组件
 * 负责 Dashboard Strip 和视图切换
 */
import { ref, onActivated, onDeactivated, watch, nextTick } from 'vue';
import Select from 'primevue/select';
import InputText from 'primevue/inputtext';
import type { ServiceType } from '../../config/types';
import { SERVICE_DISPLAY_NAMES } from '../../constants/serviceNames';
import { useHistoryManager } from '../../composables/useHistory';
import { debounce } from '../../utils/debounce';
import HistoryTableView from './history/HistoryTableView.vue';
import TimelineView from './TimelineView.vue';
import FavoritesView from './FavoritesView.vue';
import 'primeicons/primeicons.css';

type ViewMode = 'table' | 'timeline' | 'favorites';

const historyManager = useHistoryManager();

const currentViewMode = ref<ViewMode>('table');

const currentFilter = ref<ServiceType | 'all'>('all');
const localSearchTerm = ref('');

const totalCount = ref(0);
const selectedCount = ref(0);

const activationTrigger = ref(0);

const historyContainerRef = ref<HTMLElement | null>(null);
let savedTableScrollTop = 0;

const viewOptions = [
  { label: '表格', value: 'table' as ViewMode, icon: 'pi pi-table' },
  { label: '时间轴', value: 'timeline' as ViewMode, icon: 'pi pi-calendar' },
  { label: '收藏', value: 'favorites' as ViewMode, icon: 'pi pi-star' },
];

const serviceOptions: Array<{ label: string; value: ServiceType | 'all' }> = [
  { label: '全部来源', value: 'all' },
  ...Object.entries(SERVICE_DISPLAY_NAMES).map(([id, name]) => ({
    label: name, value: id as ServiceType
  }))
];

// 防抖搜索词
const debouncedSearchTerm = ref('');
const updateSearchTerm = debounce((term: string) => {
  debouncedSearchTerm.value = term;
}, 300);

watch(localSearchTerm, updateSearchTerm);

// KeepAlive 激活时刷新数据（解决上传后切换回来不更新的问题）
onActivated(async () => {
  // 通知子视图激活状态变化
  activationTrigger.value++;
  await historyManager.loadHistory();
  // 恢复表格滚动位置（数据加载后等 DOM flush 再设置）
  if (currentViewMode.value === 'table' && savedTableScrollTop > 0) {
    await nextTick();
    if (historyContainerRef.value) {
      historyContainerRef.value.scrollTop = savedTableScrollTop;
    }
  }
});

onDeactivated(() => {
  if (currentViewMode.value === 'table') {
    savedTableScrollTop = historyContainerRef.value?.scrollTop ?? savedTableScrollTop;
  }
});

// 同层 v-show 切换（table ↔ timeline）时保存/恢复滚动位置
watch(currentViewMode, async (newMode, oldMode) => {
  if (oldMode === 'table') {
    // v-show 切换前 DOM 尚未隐藏，此时 scrollTop 仍可读
    savedTableScrollTop = historyContainerRef.value?.scrollTop ?? savedTableScrollTop;
  }
  if (newMode === 'table' && savedTableScrollTop > 0) {
    // 等 HistoryTableView display:block 渲染完成，容器高度恢复后再设置
    await nextTick();
    if (historyContainerRef.value) {
      historyContainerRef.value.scrollTop = savedTableScrollTop;
    }
  }
});

// 切换视图模式
const switchViewMode = (mode: ViewMode) => {
  if (currentViewMode.value === mode) return;

  selectedCount.value = 0;

  currentViewMode.value = mode;
};

const handleFilterChange = (filter: ServiceType | 'all') => {
  currentFilter.value = filter;
};

const clearSearch = () => {
  localSearchTerm.value = '';
  debouncedSearchTerm.value = '';
};

const handleTotalCountUpdate = (count: number) => {
  totalCount.value = count;
};

const handleSelectedCountUpdate = (count: number) => {
  selectedCount.value = count;
};
</script>

<template>
  <div class="history-view">
    <!-- 顶部导航栏 -->
    <div class="dashboard-strip">
      <!-- 左侧：标签页导航 -->
      <div class="tab-nav">
        <button
          v-for="opt in viewOptions"
          :key="opt.value"
          class="tab-btn"
          :class="{ active: currentViewMode === opt.value }"
          @click="switchViewMode(opt.value)"
        >
          <i :class="opt.icon"></i>
          <span>{{ opt.label }}</span>
        </button>
      </div>

      <!-- 右侧：所有控件共存 -->
      <div class="strip-right">
        <Select
          :model-value="currentFilter"
          @update:model-value="handleFilterChange"
          :options="serviceOptions"
          optionLabel="label"
          optionValue="value"
          class="filter-chip"
        />

        <div class="search-field">
          <i class="pi pi-search search-field-icon"></i>
          <InputText
            v-model="localSearchTerm"
            placeholder="搜索文件名..."
            class="search-field-input"
          />
          <i
            v-show="localSearchTerm"
            class="pi pi-times search-field-clear"
            @click="clearSearch"
          ></i>
        </div>

        <Transition name="sel-fade">
          <div v-if="selectedCount > 0" class="selection-badge">
            <i class="pi pi-check-circle"></i>
            <span>已选 {{ selectedCount }} 张</span>
          </div>
        </Transition>

        <div class="stat-badge">
          <span class="stat-val">{{ totalCount.toLocaleString() }}</span>
          <span class="stat-unit">张</span>
        </div>
      </div>
    </div>

    <!-- 视图容器（可滚动） -->
    <div ref="historyContainerRef" class="history-container" :class="{ 'no-padding': currentViewMode !== 'table' }">
      <!-- 表格视图 -->
      <HistoryTableView
        v-show="currentViewMode === 'table'"
        :visible="currentViewMode === 'table'"
        :filter="currentFilter"
        :search-term="debouncedSearchTerm"
        @update:total-count="handleTotalCountUpdate"
        @update:selected-count="handleSelectedCountUpdate"
      />

      <!-- 时间轴视图 -->
      <TimelineView
        v-show="currentViewMode === 'timeline'"
        :visible="currentViewMode === 'timeline'"
        :activation-trigger="activationTrigger"
        :filter="currentFilter"
        :search-term="debouncedSearchTerm"
        @update:total-count="handleTotalCountUpdate"
        @update:selected-count="handleSelectedCountUpdate"
      />

      <!-- 收藏视图 -->
      <FavoritesView
        v-show="currentViewMode === 'favorites'"
        :visible="currentViewMode === 'favorites'"
        :activation-trigger="activationTrigger"
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
  height: 48px;
  background-color: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  z-index: 10;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

/* 标签页导航 */
.tab-nav {
  display: flex;
  gap: 2px;
  height: 100%;
  align-items: stretch;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  position: relative;
  transition: color var(--duration-fast), background var(--duration-fast);
  border-radius: 8px 8px 0 0;
  font-family: inherit;
}

.tab-btn i {
  font-size: 14px;
}

.tab-btn:hover {
  color: var(--text-primary);
  background: var(--hover-overlay);
}

.tab-btn.active {
  color: var(--primary);
}

.tab-btn.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 8px;
  right: 8px;
  height: 2px;
  background: var(--primary);
  border-radius: 1px 1px 0 0;
}

/* 右侧操作区 */
.strip-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 1;
  min-width: 0;
}

/* 图床筛选 chip */
.filter-chip {
  flex-shrink: 0;
}

:deep(.filter-chip.p-select) {
  height: 28px;
  border-radius: 14px;
  border: none;
  background: var(--primary-alpha-8);
  font-size: 12px;
  transition: background var(--duration-fast);
}

:deep(.filter-chip.p-select:hover) {
  background: var(--primary-alpha-15);
}

:deep(.filter-chip.p-select.p-focus) {
  background: var(--primary-alpha-15);
  box-shadow: none;
}

:deep(.filter-chip .p-select-label) {
  padding: 0 6px 0 10px;
  font-size: 12px;
  color: var(--primary);
  font-weight: 500;
  line-height: 28px;
}

:deep(.filter-chip .p-select-dropdown) {
  width: 20px;
  color: var(--primary);
}

:deep(.filter-chip .p-select-dropdown .p-icon) {
  width: 10px;
  height: 10px;
}

/* 下拉面板样式 */
:deep(.p-select-overlay) {
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  border: 1px solid var(--border-subtle);
  padding: 4px;
  min-width: 120px;
}

:deep(.p-select-overlay .p-select-option) {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--text-primary);
  transition: background var(--duration-micro);
}

:deep(.p-select-overlay .p-select-option:hover) {
  background: var(--hover-overlay);
}

:deep(.p-select-overlay .p-select-option.p-selected) {
  background: var(--primary-alpha-10);
  color: var(--primary);
  font-weight: 500;
}

:deep(.p-select-overlay .p-select-option.p-selected:hover) {
  background: var(--primary-alpha-15);
}

/* 始终可见的搜索栏 */
.search-field {
  display: flex;
  align-items: center;
  background: var(--bg-input);
  border-radius: 16px;
  height: 32px;
  padding: 0 8px 0 10px;
  min-width: 140px;
  max-width: 260px;
  flex: 1;
  border: 1px solid transparent;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}

.search-field:focus-within {
  border-color: var(--primary);
  box-shadow: none;
}

.search-field-icon {
  color: var(--text-secondary);
  font-size: 12px;
  flex-shrink: 0;
  opacity: 0.5;
  margin-right: 6px;
}

.search-field:focus-within .search-field-icon {
  opacity: 0.8;
  color: var(--primary);
}

:deep(.search-field-input.p-inputtext) {
  flex: 1;
  background: transparent;
  border: none;
  box-shadow: none;
  outline: none;
  color: var(--text-primary);
  font-size: 12.5px;
  padding: 0 !important;
  height: 100%;
  font-family: inherit;
  min-width: 0;
}

:deep(.search-field-input.p-inputtext:enabled:focus),
:deep(.search-field-input.p-inputtext:enabled:hover) {
  border: none;
  box-shadow: none;
  outline: none;
}

.search-field-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

.search-field-clear {
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast);
  opacity: 0.5;
}

.search-field-clear:hover {
  color: var(--text-primary);
  background: var(--hover-overlay);
  opacity: 1;
}

/* 选中徽章 */
.selection-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  background: var(--primary-alpha-12);
  border-radius: 14px;
  color: var(--primary);
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
}

.selection-badge i {
  font-size: 12px;
}

.sel-fade-enter-active,
.sel-fade-leave-active {
  transition: opacity var(--duration-normal), transform var(--duration-normal);
}

.sel-fade-enter-from,
.sel-fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* 总数徽章 */
.stat-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-alpha-8);
  border-radius: 14px;
  padding: 0 12px;
  height: 28px;
}

.stat-val {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

.stat-unit {
  font-size: var(--text-2xs-xs);
  font-weight: 400;
  color: var(--primary);
  opacity: 0.7;
  margin-left: 2px;
}
</style>
