<script setup lang="ts">
import { computed } from 'vue';
import ProgressSpinner from 'primevue/progressspinner';
import Message from 'primevue/message';
import FileTableRow from './FileTableRow.vue';
import EmptyState from './EmptyState.vue';
import type { StorageObject, SortField, SortDirection } from '../types';

const props = withDefaults(
  defineProps<{
    items: StorageObject[];
    selectedKeys: Set<string>;
    loading: boolean;
    error: string | null;
    sortField: SortField;
    sortDirection: SortDirection;
  }>(),
  {}
);

const emit = defineEmits<{
  select: [item: StorageObject, event: MouseEvent];
  selectAll: [checked: boolean];
  preview: [item: StorageObject];
  open: [item: StorageObject];
  sort: [field: SortField];
  delete: [item: StorageObject];
  copyLink: [item: StorageObject];
  upload: [];
}>();

const allSelected = computed(() => {
  if (props.items.length === 0) return false;
  return props.items.every((item) => props.selectedKeys.has(item.key));
});

const someSelected = computed(() => {
  if (props.items.length === 0) return false;
  const selectedCount = props.items.filter((item) => props.selectedKeys.has(item.key)).length;
  return selectedCount > 0 && selectedCount < props.items.length;
});

const handleSelectAll = () => {
  emit('selectAll', !allSelected.value);
};

const getSortIcon = (field: SortField) => {
  if (props.sortField !== field) return 'pi-sort-alt';
  return props.sortDirection === 'asc' ? 'pi-sort-amount-up-alt' : 'pi-sort-amount-down';
};

const isSelected = (item: StorageObject) => props.selectedKeys.has(item.key);
</script>

<template>
  <div class="file-table-wrapper">
    <div v-if="loading && items.length === 0" class="table-skeleton">
      <div v-for="i in 8" :key="i" class="skeleton-row">
        <div class="skeleton-cell checkbox"></div>
        <div class="skeleton-cell name"></div>
        <div class="skeleton-cell type"></div>
        <div class="skeleton-cell size"></div>
        <div class="skeleton-cell date"></div>
        <div class="skeleton-cell actions"></div>
      </div>
    </div>

    <Message v-else-if="error && items.length === 0" severity="error" :closable="false">
      {{ error }}
    </Message>

    <EmptyState
      v-else-if="items.length === 0"
      icon="pi-inbox"
      title="暂无文件"
      description="上传图片到云存储后将在此显示"
      actionLabel="上传文件"
      actionIcon="pi-upload"
      @action="emit('upload')"
    />

    <div v-else class="table-container">
      <table class="file-table">
        <thead>
          <tr>
            <th class="col-checkbox">
              <div
                class="header-checkbox"
                :class="{ checked: allSelected, indeterminate: someSelected }"
                @click="handleSelectAll"
              >
                <i v-if="allSelected" class="pi pi-check"></i>
                <i v-else-if="someSelected" class="pi pi-minus"></i>
              </div>
            </th>
            <th class="col-name sortable" @click="emit('sort', 'name')">
              <span>对象</span>
              <i :class="['pi', getSortIcon('name')]"></i>
            </th>
            <th class="col-type">类型</th>
            <th class="col-size sortable" @click="emit('sort', 'size')">
              <span>大小</span>
              <i :class="['pi', getSortIcon('size')]"></i>
            </th>
            <th class="col-date sortable" @click="emit('sort', 'lastModified')">
              <span>已修改</span>
              <i :class="['pi', getSortIcon('lastModified')]"></i>
            </th>
            <th class="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          <FileTableRow
            v-for="item in items"
            :key="item.key"
            :item="item"
            :selected="isSelected(item)"
            @select="(i, e) => emit('select', i, e)"
            @preview="(i) => emit('preview', i)"
            @open="(i) => emit('open', i)"
            @delete="(i) => emit('delete', i)"
            @copy-link="(i) => emit('copyLink', i)"
          />
        </tbody>
      </table>
    </div>

    <div v-if="loading && items.length > 0" class="loading-more">
      <ProgressSpinner style="width: 20px; height: 20px" />
      <span>加载更多...</span>
    </div>
  </div>
</template>

<style scoped>
.file-table-wrapper {
  height: 100%;
  background: var(--bg-card);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.table-container {
  flex: 1;
  overflow: auto;
}

.file-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.file-table thead {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg-app);
}

.file-table th {
  padding: 12px 16px;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 2px solid var(--border-subtle);
  white-space: nowrap;
  user-select: none;
}

.file-table th.sortable {
  cursor: pointer;
  transition: color 0.2s;
}

.file-table th.sortable:hover {
  color: var(--text-primary);
}

.file-table th.sortable span {
  margin-right: 6px;
}

.file-table th.sortable .pi {
  font-size: 12px;
  opacity: 0.5;
}

.file-table th.sortable:hover .pi {
  opacity: 1;
}

.col-checkbox { width: 48px; }
.col-name { min-width: 200px; }
.col-type { width: 120px; }
.col-size { width: 100px; text-align: right !important; }
.col-date { width: 180px; }
.col-actions { width: 48px; }

.header-checkbox {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-subtle);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  background: transparent;
}

.header-checkbox:hover { border-color: var(--primary); }

.header-checkbox.checked,
.header-checkbox.indeterminate {
  background: var(--primary);
  border-color: var(--primary);
}

.header-checkbox .pi {
  font-size: 12px;
  color: white;
  font-weight: 600;
}

.table-skeleton { padding: 16px; }

.skeleton-row {
  display: flex;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.skeleton-cell {
  background: linear-gradient(90deg, var(--bg-app) 25%, var(--bg-secondary) 50%, var(--bg-app) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
  height: 16px;
}

.skeleton-cell.checkbox { width: 20px; height: 20px; flex-shrink: 0; }
.skeleton-cell.name { flex: 1; }
.skeleton-cell.type { width: 80px; flex-shrink: 0; }
.skeleton-cell.size { width: 60px; flex-shrink: 0; }
.skeleton-cell.date { width: 120px; flex-shrink: 0; }
.skeleton-cell.actions { width: 24px; flex-shrink: 0; }

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 13px;
  border-top: 1px solid var(--border-subtle);
}

@media (max-width: 1200px) { .col-type { display: none; } }
@media (max-width: 900px) { .col-date { display: none; } }
</style>
