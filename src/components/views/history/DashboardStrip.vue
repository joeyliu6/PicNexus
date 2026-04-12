<script setup lang="ts">
import { ref, watch } from 'vue';
import Select from 'primevue/select';
import InputText from 'primevue/inputtext';
import type { ServiceType } from '../../../config/types';
import { SERVICE_DISPLAY_NAMES } from '../../../constants/serviceNames';
import { debounce } from '../../../utils/debounce';

export type ViewMode = 'table' | 'timeline' | 'favorites';

const props = defineProps<{
  viewMode: ViewMode;
  filter: ServiceType | 'all';
  totalCount: number;
  selectedCount: number;
}>();

const emit = defineEmits<{
  'update:viewMode': [mode: ViewMode];
  'update:filter': [filter: ServiceType | 'all'];
  'update:searchTerm': [term: string];
}>();

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
const localSearchTerm = ref('');
const updateSearchTerm = debounce((term: string) => {
  emit('update:searchTerm', term);
}, 300);

watch(localSearchTerm, updateSearchTerm);

function switchViewMode(mode: ViewMode) {
  if (props.viewMode === mode) return;
  emit('update:viewMode', mode);
}

function handleFilterChange(filter: ServiceType | 'all') {
  emit('update:filter', filter);
}

function clearSearch() {
  localSearchTerm.value = '';
  emit('update:searchTerm', '');
}
</script>

<template>
  <div class="dashboard-strip">
    <!-- 左侧：标签页导航 -->
    <div class="tab-nav">
      <button
        v-for="opt in viewOptions"
        :key="opt.value"
        class="tab-btn"
        :class="{ active: viewMode === opt.value }"
        @click="switchViewMode(opt.value)"
      >
        <i :class="opt.icon"></i>
        <span>{{ opt.label }}</span>
      </button>
    </div>

    <!-- 右侧：所有控件共存 -->
    <div class="strip-right">
      <Select
        :model-value="filter"
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
</template>

<style scoped>
/* === Dashboard Strip === */
.dashboard-strip {
  flex-shrink: 0;
  height: 48px;
  background-color: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-md);
  z-index: 10;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- box-shadow 含 rgb 色值 */
  box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
}

/* 标签页导航 */
.tab-nav {
  display: flex;
  gap: var(--space-2xs);
  height: 100%;
  align-items: stretch;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  padding: 0 var(--space-md-lg);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
  position: relative;
  transition: color var(--duration-fast), background var(--duration-fast);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  font-family: inherit;
}

.tab-btn i {
  font-size: var(--text-base);
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
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1px 为指示条微圆角 */
  border-radius: 1px 1px 0 0;
}

/* 右侧操作区 */
.strip-right {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 1;
  min-width: 0;
}

/* 图床筛选 chip */
.filter-chip {
  flex-shrink: 0;
}

:deep(.filter-chip.p-select) {
  height: 28px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 14px 为药丸形圆角（高度一半） */
  border-radius: 14px;
  border: none;
  background: var(--primary-alpha-8);
  font-size: var(--text-xs);
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
  padding: 0 var(--space-xs-sm) 0 var(--space-sm-md);
  font-size: var(--text-xs);
  color: var(--primary);
  font-weight: var(--weight-medium);
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
  border-radius: var(--radius-md);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- box-shadow 含 rgb 色值 */
  box-shadow: 0 4px 16px rgb(0 0 0 / 12%);
  border: 1px solid var(--border-subtle);
  padding: var(--space-xs);
  min-width: 120px;
}

:deep(.p-select-overlay .p-select-option) {
  font-size: var(--text-xs);
  padding: var(--space-xs-sm) var(--space-sm-md);
  border-radius: var(--radius-sm-md);
  color: var(--text-primary);
  transition: background var(--duration-micro);
}

:deep(.p-select-overlay .p-select-option:hover) {
  background: var(--hover-overlay);
}

:deep(.p-select-overlay .p-select-option.p-selected) {
  background: var(--primary-alpha-10);
  color: var(--primary);
  font-weight: var(--weight-medium);
}

:deep(.p-select-overlay .p-select-option.p-selected:hover) {
  background: var(--primary-alpha-15);
}

/* 始终可见的搜索栏 */
.search-field {
  display: flex;
  align-items: center;
  background: var(--bg-input);
  border-radius: var(--radius-xl);
  height: 32px;
  padding: 0 var(--space-sm) 0 var(--space-sm-md);
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
  font-size: var(--text-xs);
  flex-shrink: 0;
  opacity: 0.5;
  margin-right: var(--space-xs-sm);
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
  font-size: var(--text-sm);
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
  font-size: var(--text-2xs);
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
  gap: var(--space-xs);
  height: 28px;
  padding: 0 var(--space-sm-md);
  background: var(--primary-alpha-12);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 14px 为药丸形圆角（高度一半） */
  border-radius: 14px;
  color: var(--primary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  flex-shrink: 0;
}

.selection-badge i {
  font-size: var(--text-xs);
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
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 14px 为药丸形圆角（高度一半） */
  border-radius: 14px;
  padding: 0 var(--space-md);
  height: 28px;
}

.stat-val {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

.stat-unit {
  font-size: var(--text-xs);
  font-weight: var(--weight-regular);
  color: var(--primary);
  opacity: 0.7;
  margin-left: var(--space-2xs);
}
</style>
