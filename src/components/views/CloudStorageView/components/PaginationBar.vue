<script setup lang="ts">
import { computed } from 'vue';
import Paginator, { type PageState } from 'primevue/paginator';

const props = defineProps<{
  currentPage: number;
  pageSize: number;
  totalItems: number;
  selectedCount: number;
  hasMore: boolean;
  loading: boolean;
  maxKnownPage: number;
  pageSizeOptions: number[];
}>();

const emit = defineEmits<{
  'page-change': [page: number];
  'page-size-change': [size: number];
}>();

// 游标分页适配：使用 maxKnownPage 稳定页码显示
const computedTotalRecords = computed(() => {
  const knownPages = props.maxKnownPage;
  const extraPage = props.hasMore ? 1 : 0;
  return (knownPages + extraPage) * props.pageSize;
});

// 计算 first（起始索引）
const first = computed(() => (props.currentPage - 1) * props.pageSize);

// 处理分页变化
function handlePageChange(event: PageState) {
  const newPage = Math.floor(event.first / event.rows) + 1;
  if (newPage !== props.currentPage) {
    emit('page-change', newPage);
  }
}
</script>

<template>
  <div class="pagination-bar">
    <Paginator
      :first="first"
      :rows="pageSize"
      :totalRecords="computedTotalRecords"
      :pageLinkSize="5"
      template="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink"
      :pt="{
        root: { class: 'minimal-paginator' }
      }"
      @page="handlePageChange"
    />
  </div>
</template>

<style scoped>
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

/* 极简分页样式 */
:deep(.minimal-paginator) {
  background: transparent;
  border: none;
  padding: 0;
  gap: 4px;
}

:deep(.minimal-paginator .p-paginator-first),
:deep(.minimal-paginator .p-paginator-prev),
:deep(.minimal-paginator .p-paginator-next),
:deep(.minimal-paginator .p-paginator-last) {
  min-width: 32px;
  height: 32px;
  border-radius: 6px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
}

:deep(.minimal-paginator .p-paginator-first:hover:not(:disabled)),
:deep(.minimal-paginator .p-paginator-prev:hover:not(:disabled)),
:deep(.minimal-paginator .p-paginator-next:hover:not(:disabled)),
:deep(.minimal-paginator .p-paginator-last:hover:not(:disabled)) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

:deep(.minimal-paginator .p-paginator-first:disabled),
:deep(.minimal-paginator .p-paginator-prev:disabled),
:deep(.minimal-paginator .p-paginator-next:disabled),
:deep(.minimal-paginator .p-paginator-last:disabled) {
  opacity: 0.4;
}

:deep(.minimal-paginator .p-paginator-page) {
  min-width: 32px;
  height: 32px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
}

:deep(.minimal-paginator .p-paginator-page:hover:not(.p-highlight)) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

:deep(.minimal-paginator .p-paginator-page.p-highlight) {
  background: var(--primary);
  color: white;
  border-radius: 50%;
}
</style>
