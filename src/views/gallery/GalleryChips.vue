<script setup lang="ts">
// 生效的筛选条件（GalleryScreen.dc.html，行高 36）：每个是可单独移除的小标签，末尾「清除全部」。
import PnIcon from '@/components/pn/PnIcon.vue';
import { EMPTY_FILTERS, type FilterChip, type GalleryFilters } from './galleryFilters';

const props = defineProps<{
  chips: readonly FilterChip[];
  filters: GalleryFilters;
}>();

const emit = defineEmits<{
  'update:filters': [filters: GalleryFilters];
}>();
</script>

<template>
  <div class="chips" aria-label="生效的筛选">
    <span v-for="chip in chips" :key="chip.label" class="chips__chip">
      {{ chip.label }}
      <button type="button" class="chips__remove" aria-label="移除这个筛选" @click="emit('update:filters', chip.remove(props.filters))">
        <PnIcon name="close" :size="10" :stroke="2.2" />
      </button>
    </span>
    <button type="button" class="chips__clear" @click="emit('update:filters', EMPTY_FILTERS)">清除全部</button>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-6);
  height: var(--pn-size-filter-row);
  padding: 0 var(--pn-space-24);
}

.chips__chip {
  display: flex;
  align-items: center;
  gap: var(--pn-space-4);
  height: var(--pn-size-filter-chip);
  padding: 0 var(--pn-space-4) 0 var(--pn-space-search-x);
  border-radius: var(--pn-size-filter-chip);
  background: var(--pn-brand-soft);
  color: var(--pn-brand-text);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
  white-space: nowrap;
}

.chips__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-filter-chip-remove);
  height: var(--pn-size-filter-chip-remove);
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--pn-brand-text);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.chips__remove:hover { background: var(--pn-chip-remove-hover); }
.chips__remove:active { background: var(--pn-chip-remove-press); }

.chips__clear {
  height: var(--pn-size-filter-chip);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: transparent;
  color: var(--pn-text2);
  font: inherit;
  font-size: var(--pn-text-footnote);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.chips__clear:hover { background: var(--pn-ghost-hover); }
.chips__clear:active { background: var(--pn-ghost-press); }
</style>
