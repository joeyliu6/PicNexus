<script setup lang="ts">
/**
 * 链接检测列表上方的工具条：「有问题 / 全部」二选一 + 图床筛选 + 搜索
 *
 * 只留两个视图：用户要么想看出了问题的图，要么想翻全部；「失效 / 超时 / 可疑」这类细分
 * 由每行那句白话交代，不再做成筛选按钮让用户自己拼。
 */
import { getServiceDisplayName } from '@/constants/serviceNames';
import { serviceNameTooltip } from '@/utils/serviceNameFit';
import ServiceLogo from '@/components/common/ServiceLogo.vue';
import type { ImageListView } from '@/composables/link-check/useImageList';

defineProps<{
  problemCount: number;
  allCount: number;
  serviceList: { id: string; count: number }[];
}>();

const view = defineModel<ImageListView>('view', { required: true });
const serviceId = defineModel<string | null>('serviceId', { required: true });
const searchInput = defineModel<string>('searchInput', { required: true });
const showServiceMenu = defineModel<boolean>('showServiceMenu', { required: true });

function pickService(id: string | null): void {
  serviceId.value = id;
  showServiceMenu.value = false;
}
</script>

<template>
  <div class="check-toolbar">
    <div class="view-switch" role="tablist" aria-label="列表范围">
      <button
        type="button"
        role="tab"
        class="view-option"
        :class="{ active: view === 'problems' }"
        :aria-selected="view === 'problems'"
        @click="view = 'problems'"
      >
        有问题
        <span class="view-count">{{ problemCount.toLocaleString() }}</span>
      </button>
      <button
        type="button"
        role="tab"
        class="view-option"
        :class="{ active: view === 'all' }"
        :aria-selected="view === 'all'"
        @click="view = 'all'"
      >
        全部
        <span class="view-count">{{ allCount.toLocaleString() }}</span>
      </button>
    </div>

    <div class="toolbar-spacer"></div>

    <div v-if="serviceList.length > 1" class="service-filter" @click.stop>
      <button
        type="button"
        class="filter-trigger"
        :class="{ active: !!serviceId }"
        v-tooltip.top="serviceId ? serviceNameTooltip(getServiceDisplayName(serviceId)) : null"
        @click="showServiceMenu = !showServiceMenu"
      >
        <template v-if="serviceId">
          <ServiceLogo :service-id="serviceId" class="badge-icon" />
          <span class="trigger-label">{{ getServiceDisplayName(serviceId) }}</span>
        </template>
        <template v-else>
          <i class="pi pi-images trigger-icon" aria-hidden="true"></i>
          全部图床
        </template>
        <i class="pi pi-chevron-down trigger-caret" aria-hidden="true"></i>
      </button>

      <Transition name="dropdown">
        <div v-if="showServiceMenu" class="service-dropdown">
          <div class="service-dropdown-item" :class="{ active: !serviceId }" @click="pickService(null)">
            <span class="sdi-label">全部图床</span>
          </div>
          <div
            v-for="service in serviceList"
            :key="service.id"
            class="service-dropdown-item"
            :class="{ active: serviceId === service.id }"
            v-tooltip.top="serviceNameTooltip(getServiceDisplayName(service.id), null, 160)"
            @click="pickService(service.id)"
          >
            <span class="sdi-label">
              <ServiceLogo :service-id="service.id" class="badge-icon" />
              <span class="sdi-name">{{ getServiceDisplayName(service.id) }}</span>
            </span>
            <span class="sdi-count">{{ service.count.toLocaleString() }} 张</span>
          </div>
        </div>
      </Transition>
    </div>

    <div class="search-field">
      <i class="pi pi-search search-field-icon" aria-hidden="true"></i>
      <input
        v-model="searchInput"
        type="text"
        class="search-field-input"
        placeholder="搜索文件名或链接"
        aria-label="搜索文件名或链接"
      />
      <button
        v-show="searchInput"
        type="button"
        class="search-field-clear"
        aria-label="清除搜索"
        @click="searchInput = ''"
      >
        <i class="pi pi-times" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.check-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  flex-shrink: 0;
}

.toolbar-spacer {
  flex: 1;
}

/* ---- 二选一 ---- */
.view-switch {
  display: inline-flex;
  padding: var(--space-2xs);
  border-radius: var(--radius-md);
  background: var(--bg-input);
}

.view-option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  height: 26px;
  padding: 0 var(--space-md);
  border: none;
  border-radius: var(--radius-sm-md);
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.view-option:hover {
  color: var(--text-main);
}

.view-option.active {
  background: var(--bg-card);
  color: var(--text-main);
  box-shadow: var(--shadow-sm);
}

.view-count {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.view-option.active .view-count {
  color: var(--text-muted);
}

/* ---- 图床筛选 ---- */
.service-filter {
  position: relative;
  flex-shrink: 0;
}

.filter-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  height: 30px;
  padding: 0 var(--space-sm-md);
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  background: var(--bg-input);
  color: var(--text-muted);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--duration-fast), border-color var(--duration-fast);
}

.filter-trigger:hover {
  background: var(--hover-overlay);
  border-color: var(--border-subtle);
}

.filter-trigger.active {
  background: var(--primary-alpha-10);
  color: var(--primary);
  border-color: var(--primary-alpha-10);
}

.trigger-icon,
.trigger-caret {
  font-size: var(--text-2xs);
}

/* 120px 见 docs/design/tokens.md#service-name-truncation */
.trigger-label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge-icon {
  display: inline-flex;
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  font-size: var(--text-2xs);
  color: var(--text-muted);
}

.service-dropdown {
  position: absolute;
  top: calc(100% + var(--space-xs-sm));
  right: 0;
  min-width: 180px;
  max-width: 280px;
  padding: var(--space-xs) 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-float);
  z-index: var(--z-dropdown);
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

.service-dropdown-item.active {
  background: var(--primary-alpha-10);
}

.sdi-label {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
  white-space: nowrap;
}

.sdi-label .badge-icon {
  width: 14px;
  height: 14px;
  font-size: var(--text-xs);
}

/* 160px 见 docs/design/tokens.md#service-name-truncation */
.sdi-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sdi-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

/* ---- 搜索 ---- */
.search-field {
  display: flex;
  align-items: center;
  flex: 0 1 240px;
  min-width: 140px;
  height: 30px;
  padding: 0 var(--space-xs) 0 var(--space-sm-md);
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  background: var(--bg-input);
  transition: border-color var(--duration-fast);
}

.search-field:focus-within {
  border-color: var(--primary);
}

.search-field-icon {
  margin-right: var(--space-xs-sm);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.search-field:focus-within .search-field-icon {
  color: var(--primary);
}

.search-field-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-sm);
}

.search-field-input::placeholder {
  color: var(--text-tertiary);
}

.search-field-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  cursor: pointer;
}

.search-field-clear:hover {
  background: var(--hover-overlay);
  color: var(--text-main);
}
</style>
