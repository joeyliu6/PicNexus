<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import InputText from 'primevue/inputtext';
import type { ServiceType } from '../../../config/types';
import { getServiceDisplayName } from '../../../constants/serviceNames';
import { getServiceIcon } from '../../../utils/icons';
import { debounce } from '../../../utils/debounce';

export type ViewMode = 'table' | 'timeline' | 'favorites';

const props = defineProps<{
  viewMode: ViewMode;
  filter: ServiceType | 'all';
  totalCount: number;
  serviceCounts: Array<{ id: string; count: number }>;
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

// 图床下拉菜单开关（自包含，文档点击关闭）
const showServiceMenu = ref(false);
const serviceFilterRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);

function closeMenu(refocusTrigger = true) {
  if (!showServiceMenu.value) return;
  showServiceMenu.value = false;
  // Esc/Enter 后焦点要回到 trigger，避免 tab 链断裂
  if (refocusTrigger) triggerRef.value?.focus();
}

function selectOption(filter: ServiceType | 'all') {
  handleFilterChange(filter);
  triggerRef.value?.focus();
}

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
  // filter 切换前先把 pending 的 search 同步吐给父级；
  // Vue 本 tick 内 batch 两次 emit，父级 watch([filter, searchTerm]) 只会触发一次 loadCurrentPage
  updateSearchTerm.immediate(localSearchTerm.value);
  emit('update:filter', filter);
  showServiceMenu.value = false;
}

function clearSearch() {
  updateSearchTerm.cancel();
  localSearchTerm.value = '';
  emit('update:searchTerm', '');
}

function handleDocumentClick(event: MouseEvent) {
  if (!showServiceMenu.value) return;
  const target = event.target as Node | null;
  if (target && serviceFilterRef.value && serviceFilterRef.value.contains(target)) return;
  showServiceMenu.value = false;
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
});

onUnmounted(() => {
  updateSearchTerm.cancel();
  document.removeEventListener('click', handleDocumentClick);
});
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
      <div ref="serviceFilterRef" class="service-filter" @keydown.esc.stop="closeMenu()">
        <button
          ref="triggerRef"
          class="filter-chip"
          :class="{ active: filter !== 'all' }"
          aria-haspopup="listbox"
          :aria-expanded="showServiceMenu"
          @click="showServiceMenu = !showServiceMenu"
        >
          <template v-if="filter !== 'all'">
            <span class="badge-icon" v-html="getServiceIcon(filter)"></span>
            {{ getServiceDisplayName(filter) }}
          </template>
          <template v-else>
            <i class="pi pi-images" style="font-size: var(--text-2xs)"></i>
            全部图床
          </template>
          <i class="pi pi-chevron-down" style="font-size: var(--text-2xs); margin-left: var(--space-2xs)"></i>
        </button>

        <Transition name="dropdown">
          <div v-if="showServiceMenu" class="service-dropdown" role="listbox" aria-label="按图床筛选">
            <div
              class="service-dropdown-item"
              :class="{ active: filter === 'all' }"
              role="option"
              tabindex="0"
              :aria-selected="filter === 'all'"
              @click="selectOption('all')"
              @keydown.enter.prevent="selectOption('all')"
              @keydown.space.prevent="selectOption('all')"
            >
              <span class="sdi-label">全部图床</span>
              <span class="sdi-count">{{ totalCount.toLocaleString() }}</span>
            </div>

            <div
              v-for="service in serviceCounts"
              :key="service.id"
              class="service-dropdown-item"
              :class="{ active: filter === service.id }"
              role="option"
              tabindex="0"
              :aria-selected="filter === service.id"
              @click="selectOption(service.id as ServiceType)"
              @keydown.enter.prevent="selectOption(service.id as ServiceType)"
              @keydown.space.prevent="selectOption(service.id as ServiceType)"
            >
              <span class="sdi-label">
                <span class="badge-icon" v-html="getServiceIcon(service.id)"></span>
                {{ getServiceDisplayName(service.id) }}
              </span>
              <span class="sdi-count">{{ service.count.toLocaleString() }}</span>
            </div>
          </div>
        </Transition>
      </div>

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
  border-bottom: 1px solid var(--border-subtle);
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

/* 图床筛选（参照 link-check CheckFilterBar 的 chip + 下拉） */
.service-filter {
  position: relative;
  flex-shrink: 0;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  height: 28px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 14px 药丸圆角（高度一半） */
  border-radius: 14px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 10px 内边距与 link-check chip 对齐 */
  padding: 0 10px;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  background: var(--bg-input);
  color: var(--text-muted);
  border: 1px solid transparent;
  transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast);
  white-space: nowrap;
  font-family: inherit;
}

.filter-chip:hover {
  background: var(--hover-overlay);
  border-color: var(--border-subtle);
}

.filter-chip.active {
  background: var(--primary-alpha-10);
  color: var(--primary);
  border-color: var(--primary-alpha-10);
}

.badge-icon {
  display: inline-flex;
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  color: var(--text-muted);
}

.badge-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.service-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 180px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: var(--space-xs) 0;
  box-shadow: var(--shadow-float);
  z-index: var(--z-dropdown);
  border: 1px solid var(--border-subtle);
  overflow: hidden;
}

.service-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md-lg);
  cursor: pointer;
  transition: background var(--duration-micro);
}

.service-dropdown-item:hover {
  background: var(--hover-overlay);
}

.service-dropdown-item:focus-visible {
  background: var(--hover-overlay);
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}

.service-dropdown-item.active {
  background: var(--primary-alpha-10);
}

.sdi-label {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
  white-space: nowrap;
}

.sdi-label .badge-icon {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
}

.sdi-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all var(--duration-normal) ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(8px);
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
