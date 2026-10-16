<script setup lang="ts">
// 图库工具栏（GalleryScreen.dc.html，高 48）：搜索（Ctrl+F）· 图床 / ★ 收藏 / 状态 / 时间 · 计数 · 网格 / 列表。
// 生效的筛选按钮变实底并写出取值；菜单的展开态设计没画，用标准菜单（交接说明第 15 节）。
import { computed, ref } from 'vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnKbd from '@/components/pn/PnKbd.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuCheckItem from '@/components/pn/PnMenuCheckItem.vue';
import PnMenuRadioGroup from '@/components/pn/PnMenuRadioGroup.vue';
import PnSegmented from '@/components/pn/PnSegmented.vue';
import type { GalleryStatusFilter } from '@/services/database/types';
import { uiPlatform } from '@/utils/platform';
import {
  STATUS_LABELS, TIME_LABELS, filterButtons, type GalleryFilters, type GalleryTimePreset,
} from './galleryFilters';

export type GalleryViewMode = 'grid' | 'list';

const props = defineProps<{
  filters: GalleryFilters;
  hosts: readonly { id: string; name: string }[];
  count: string;
  narrow: boolean;
}>();

const emit = defineEmits<{
  'update:filters': [filters: GalleryFilters];
}>();

const view = defineModel<GalleryViewMode>('view', { required: true });

const searchKeys = uiPlatform() === 'macos' ? '⌘F' : 'Ctrl+F';
const searchInput = ref<HTMLInputElement>();
defineExpose({ focusSearch: () => searchInput.value?.focus() });

const nameOf = (hostId: string) => props.hosts.find((h) => h.id === hostId)?.name ?? hostId;
const buttons = computed(() => Object.fromEntries(filterButtons(props.filters, nameOf).map((b) => [b.key, b])));

const patch = (change: Partial<GalleryFilters>) => emit('update:filters', { ...props.filters, ...change });

const hostModel = computed({
  get: () => props.filters.host ?? '',
  set: (value: string) => patch({ host: value || null }),
});
const hostOptions = computed(() => [{ value: '', label: '全部图床' }, ...props.hosts.map((h) => ({ value: h.id, label: h.name }))]);

const STATUS_ORDER: GalleryStatusFilter[] = ['dead', 'limited', 'single', 'unchecked'];
function toggleStatus(status: GalleryStatusFilter, on: boolean): void {
  const next = new Set(props.filters.status);
  if (on) next.add(status); else next.delete(status);
  patch({ status: STATUS_ORDER.filter((s) => next.has(s)) });
}

const timeModel = computed({
  get: () => props.filters.time,
  set: (value: GalleryTimePreset) => patch({ time: value }),
});
const timeOptions = (Object.keys(TIME_LABELS) as GalleryTimePreset[]).map((value) => ({ value, label: TIME_LABELS[value] }));

const segments = [
  { value: 'grid', label: '网格', icon: 'viewGrid' },
  { value: 'list', label: '列表', icon: 'viewList' },
] as const;
</script>

<template>
  <div class="toolbar">
    <label class="toolbar__search" :class="{ 'toolbar__search--narrow': narrow }">
      <PnIcon name="search" :size="14" class="toolbar__search-icon" />
      <input
        ref="searchInput"
        class="toolbar__search-input"
        type="search"
        placeholder="搜索文件名"
        aria-label="搜索文件名"
        :value="filters.search"
        @input="patch({ search: ($event.target as HTMLInputElement).value })"
        @keydown.esc="patch({ search: '' })"
      >
      <PnKbd :keys="searchKeys" />
    </label>

    <PnMenu align="start" :width="200">
      <template #trigger>
        <button type="button" class="toolbar__filter" :class="{ 'toolbar__filter--on': buttons.host.active }" aria-haspopup="menu">
          {{ buttons.host.label }}
          <PnIcon name="chevronDown" :size="12" :stroke="2" class="toolbar__caret" />
        </button>
      </template>
      <PnMenuRadioGroup v-model="hostModel" :options="hostOptions" />
    </PnMenu>

    <button
      type="button"
      class="toolbar__filter"
      :class="{ 'toolbar__filter--on': buttons.favorites.active }"
      :aria-pressed="filters.favoritesOnly"
      @click="patch({ favoritesOnly: !filters.favoritesOnly })"
    >
      {{ buttons.favorites.label }}
    </button>

    <PnMenu align="start" :width="200">
      <template #trigger>
        <button type="button" class="toolbar__filter" :class="{ 'toolbar__filter--on': buttons.status.active }" aria-haspopup="menu">
          {{ buttons.status.label }}
          <PnIcon name="chevronDown" :size="12" :stroke="2" class="toolbar__caret" />
        </button>
      </template>
      <PnMenuCheckItem
        v-for="status in STATUS_ORDER"
        :key="status"
        keep-open
        :model-value="filters.status.includes(status)"
        @update:model-value="(on: boolean) => toggleStatus(status, on)"
      >
        {{ STATUS_LABELS[status] }}
      </PnMenuCheckItem>
    </PnMenu>

    <PnMenu align="start" :width="180">
      <template #trigger>
        <button type="button" class="toolbar__filter" :class="{ 'toolbar__filter--on': buttons.time.active }" aria-haspopup="menu">
          {{ buttons.time.label }}
          <PnIcon name="chevronDown" :size="12" :stroke="2" class="toolbar__caret" />
        </button>
      </template>
      <PnMenuRadioGroup v-model="timeModel" :options="timeOptions" />
    </PnMenu>

    <div class="toolbar__spacer" />
    <span class="toolbar__count">{{ count }}</span>
    <PnSegmented v-model="view" :segments="segments" label="视图" />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-6);
  height: var(--pn-size-toolbar-row);
  padding: 0 var(--pn-space-24);
}

.toolbar__search {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  width: var(--pn-size-gallery-search);
  height: var(--pn-size-search-box);
  box-sizing: border-box;
  margin-right: var(--pn-space-6);
  padding: 0 var(--pn-space-6) 0 var(--pn-space-search-x);
  border-radius: var(--pn-radius-md);
  background: var(--pn-field);
  box-shadow: inset 0 0 0 1px var(--pn-border-strong);
  color: var(--pn-text3);
}

.toolbar__search--narrow { width: var(--pn-size-gallery-search-narrow); }

.toolbar__search:focus-within { box-shadow: inset 0 0 0 1px var(--pn-ring); }

.toolbar__search-icon { flex: none; }

.toolbar__search-input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
}

.toolbar__search-input::placeholder { color: var(--pn-text3); }
.toolbar__search-input::-webkit-search-cancel-button { display: none; }

.toolbar__filter {
  display: flex;
  align-items: center;
  gap: var(--pn-space-6);
  height: var(--pn-size-button-md);
  padding: 0 var(--pn-space-filter-x);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text2);
  font: inherit;
  white-space: nowrap;
}

.toolbar__filter:hover { background: var(--pn-row-hover); }

.toolbar__filter--on,
.toolbar__filter--on:hover {
  background: var(--pn-selected);
  color: var(--pn-text1);
  font-weight: var(--pn-weight-medium);
}

.toolbar__caret { color: var(--pn-text3); }

.toolbar__spacer { flex: 1; }

.toolbar__count {
  margin-right: var(--pn-space-count-gap);
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  white-space: nowrap;
}
</style>
