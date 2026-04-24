<script setup lang="ts">
import { ref, computed } from 'vue';
import { getServiceDisplayName } from '../../../../../constants/serviceNames';
import { getServiceIcon } from '../../../../../utils/icons';
import MigrateStatusFilterChips, {
  type MigrateStatusFilter,
  type MigrateStatusCounts,
} from './chips/MigrateStatusFilterChips.vue';
import type { SourceServiceOption } from '../composables/useFilterBar';

interface Props {
  counts: MigrateStatusCounts;
  showProcessing: boolean;
  sourceServiceOptions: SourceServiceOption[];
}

defineProps<Props>();

const activeFilter = defineModel<MigrateStatusFilter>('activeFilter', { required: true });
const selectedSourceServiceId = defineModel<string | null>('selectedSourceServiceId', { required: true });
const showServiceMenu = defineModel<boolean>('showServiceMenu', { required: true });
const searchInput = defineModel<string>('searchInput', { required: true });

const searchFocused = ref(false);

const selectedServiceLabel = computed(() => {
  if (!selectedSourceServiceId.value) return null;
  return getServiceDisplayName(selectedSourceServiceId.value) || selectedSourceServiceId.value;
});

const selectedServiceIcon = computed(() => {
  if (!selectedSourceServiceId.value) return null;
  return getServiceIcon(selectedSourceServiceId.value);
});

function selectService(id: string | null) {
  selectedSourceServiceId.value = id;
  showServiceMenu.value = false;
}
</script>

<template>
  <div class="mf-bar">
    <MigrateStatusFilterChips
      v-model="activeFilter"
      :counts="counts"
      :show-processing="showProcessing"
    />
    <span class="mf-bar__spacer" />

    <!-- 来源图床筛选 -->
    <div v-if="sourceServiceOptions.length > 1" class="mf-service-filter" @click.stop>
      <button
        class="mf-filter-chip"
        :class="{ 'mf-filter-chip--active': !!selectedSourceServiceId }"
        type="button"
        @click="showServiceMenu = !showServiceMenu"
      >
        <template v-if="selectedSourceServiceId">
          <span class="mf-badge-icon" v-html="selectedServiceIcon" />
          {{ selectedServiceLabel }}
        </template>
        <template v-else>
          <i class="pi pi-images" style="font-size: var(--text-2xs)" aria-hidden="true" />
          全部图床
        </template>
        <i
          class="pi pi-chevron-down mf-chevron"
          :class="{ 'mf-chevron--open': showServiceMenu }"
          aria-hidden="true"
        />
      </button>
      <Transition name="mf-dropdown">
        <div v-if="showServiceMenu" class="mf-service-dropdown">
          <div
            class="mf-sdi"
            :class="{ 'mf-sdi--active': !selectedSourceServiceId }"
            @click="selectService(null)"
          >
            <span class="mf-sdi-label">全部图床</span>
          </div>
          <div
            v-for="opt in sourceServiceOptions"
            :key="opt.serviceId"
            class="mf-sdi"
            :class="{ 'mf-sdi--active': selectedSourceServiceId === opt.serviceId }"
            @click="selectService(opt.serviceId)"
          >
            <span class="mf-sdi-label">
              <span class="mf-badge-icon" v-html="getServiceIcon(opt.serviceId)" />
              {{ opt.label }}
            </span>
            <span class="mf-sdi-count">{{ opt.count.toLocaleString() }}</span>
          </div>
        </div>
      </Transition>
    </div>

    <!-- 搜索框 -->
    <div class="mf-search" :class="{ 'mf-search--focused': searchFocused }">
      <i class="pi pi-search mf-search__icon" aria-hidden="true" />
      <input
        v-model="searchInput"
        class="mf-search__input"
        type="text"
        placeholder="搜索文件名…"
        @focus="searchFocused = true"
        @blur="searchFocused = false"
      />
      <button
        v-show="searchInput"
        class="mf-search__clear"
        type="button"
        tabindex="-1"
        @mousedown.prevent
        @click="searchInput = ''"
      >
        <i class="pi pi-times" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.mf-bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
  flex-wrap: wrap;
  padding-right: var(--space-xl);
}

.mf-bar__spacer { flex: 1; }

/* ── 来源图床筛选 ── */
.mf-service-filter {
  position: relative;
  flex-shrink: 0;
}

.mf-filter-chip {
  display: inline-flex;
  align-items: center;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px chip icon spacing has no exact token */
  gap: 5px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 26px chip height matches existing monitor controls */
  height: 26px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 10px horizontal chip padding has no exact token */
  padding: 0 10px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 13px pill radius preserves chip silhouette */
  border-radius: 13px;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  background: var(--bg-input);
  color: var(--text-muted);
  border: 1px solid transparent;
  transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast);
  white-space: nowrap;
}

.mf-filter-chip:hover {
  background: var(--hover-overlay);
  border-color: var(--border-subtle);
}

.mf-filter-chip--active {
  background: var(--primary-alpha-10);
  color: var(--primary);
  border-color: var(--primary-alpha-10);
}

.mf-badge-icon {
  width: 12px;
  height: 12px;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  color: currentcolor;
}

.mf-badge-icon :deep(svg) { width: 100%; height: 100%; }

.mf-chevron {
  font-size: var(--text-2xs);
  transition: transform var(--duration-fast);
}

.mf-chevron--open { transform: rotate(180deg); }

.mf-service-dropdown {
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

.mf-sdi {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md-lg);
  cursor: pointer;
  transition: background var(--duration-micro);
}

.mf-sdi:hover { background: var(--hover-overlay); }
.mf-sdi--active { background: var(--primary-alpha-10); }

.mf-sdi-label {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
}

.mf-sdi-label .mf-badge-icon {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
}

.mf-sdi-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

/* ── 搜索框 ── */
.mf-search {
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
  flex-shrink: 0;
}

.mf-search--focused { border-color: var(--primary); }

.mf-search__icon {
  color: var(--text-secondary);
  font-size: var(--text-xs);
  flex-shrink: 0;
  opacity: 0.5;
  margin-right: var(--space-xs-sm);
  transition: opacity var(--duration-fast), color var(--duration-fast);
}

.mf-search--focused .mf-search__icon {
  opacity: 0.8;
  color: var(--primary);
}

.mf-search__input {
  flex: 1;
  background: transparent;
  border: none;
  box-shadow: none;
  outline: none;
  color: var(--text-main);
  font-size: var(--text-sm);
  padding: 0;
  height: 100%;
  min-width: 0;
}

.mf-search__input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

.mf-search__clear {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: var(--text-2xs);
  cursor: pointer;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  padding: 0;
  opacity: 0.5;
  transition: color var(--duration-fast), background var(--duration-fast), opacity var(--duration-fast);
}

.mf-search__clear:hover {
  color: var(--text-main);
  background: var(--hover-overlay);
  opacity: 1;
}

/* ── 下拉动画 ── */
.mf-dropdown-enter-active,
.mf-dropdown-leave-active {
  transition: opacity var(--duration-normal) ease, transform var(--duration-normal) ease;
}

.mf-dropdown-enter-from,
.mf-dropdown-leave-to {
  opacity: 0;
  transform: translateY(var(--space-sm));
}
</style>
