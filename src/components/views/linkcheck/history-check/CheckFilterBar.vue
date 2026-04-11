<script setup lang="ts">
/**
 * CheckFilterBar — 链接监控面板的筛选栏
 * 状态 chips + 图床筛选下拉 + 搜索框
 * 从 HistoryCheckPanel.vue 抽出，纯 UI 展示，状态通过 defineModel 回传父级
 */
import Skeleton from 'primevue/skeleton';
import { getServiceIcon } from '../../../../utils/icons';
import { getServiceDisplayName } from '../../../../constants/serviceNames';
import type { StatusFilter } from '../../../../types/linkCheck';
import type { CheckStatsResult } from '../../../../composables/link-check/useCheckStats';

defineProps<{
  stats: CheckStatsResult;
  serviceList: { id: string; count: number }[];
  isLoading: boolean;
}>();

const statusFilter = defineModel<StatusFilter>('statusFilter', { required: true });
const selectedServiceId = defineModel<string | null>('selectedServiceId', { required: true });
const showServiceMenu = defineModel<boolean>('showServiceMenu', { required: true });
const searchInput = defineModel<string>('searchInput', { required: true });
const searchQuery = defineModel<string>('searchQuery', { required: true });
const searchFocused = defineModel<boolean>('searchFocused', { required: true });
</script>

<template>
  <div class="chip-bar">
    <div class="chip-group">
      <template v-if="isLoading && stats.total === 0">
        <Skeleton width="52px" height="24px" border-radius="20px" />
        <Skeleton width="65px" height="24px" border-radius="20px" />
        <Skeleton width="75px" height="24px" border-radius="20px" />
        <Skeleton width="52px" height="24px" border-radius="20px" />
        <Skeleton width="52px" height="24px" border-radius="20px" />
      </template>
      <template v-else>
        <button
          class="filter-chip chip--error" :class="{ active: statusFilter === 'invalid' }"
          :aria-pressed="statusFilter === 'invalid'"
          @click="statusFilter = statusFilter === 'invalid' ? null : 'invalid'"
        >
          <span class="chip-dot" style="background: var(--error)"></span>
          失效 {{ stats.invalid }}
        </button>
        <button
          v-if="stats.suspicious > 0"
          class="filter-chip chip--suspicious" :class="{ active: statusFilter === 'suspicious' }"
          :aria-pressed="statusFilter === 'suspicious'"
          @click="statusFilter = statusFilter === 'suspicious' ? null : 'suspicious'"
        >
          <span class="chip-dot" style="background: var(--pending)"></span>
          可疑 {{ stats.suspicious }}
        </button>
        <button
          v-if="stats.timeout > 0"
          class="filter-chip chip--timeout" :class="{ active: statusFilter === 'timeout' }"
          :aria-pressed="statusFilter === 'timeout'"
          @click="statusFilter = statusFilter === 'timeout' ? null : 'timeout'"
        >
          <span class="chip-dot" style="background: var(--warning)"></span>
          超时 {{ stats.timeout }}
        </button>
        <button
          v-if="stats.unchecked > 0"
          class="filter-chip chip--unchecked" :class="{ active: statusFilter === 'unchecked' }"
          :aria-pressed="statusFilter === 'unchecked'"
          @click="statusFilter = statusFilter === 'unchecked' ? null : 'unchecked'"
        >
          <span class="chip-dot" style="background: var(--text-tertiary)"></span>
          未检测 {{ stats.unchecked }}
        </button>
        <button
          class="filter-chip chip--valid" :class="{ active: statusFilter === 'valid' }"
          :aria-pressed="statusFilter === 'valid'"
          @click="statusFilter = statusFilter === 'valid' ? null : 'valid'"
        >
          <span class="chip-dot" style="background: var(--success)"></span>
          正常 {{ stats.valid }}
        </button>
        <button
          class="filter-chip chip--all" :class="{ active: statusFilter === 'all' }"
          :aria-pressed="statusFilter === 'all'"
          @click="statusFilter = statusFilter === 'all' ? null : 'all'"
        >
          全部 {{ stats.total }}
        </button>
      </template>
    </div>
    <div class="chip-spacer"></div>
    <!-- 图床筛选 -->
    <div v-if="serviceList.length > 1" class="service-filter" @click.stop>
      <button
        class="filter-chip" :class="{ active: !!selectedServiceId }"
        @click="showServiceMenu = !showServiceMenu"
      >
        <template v-if="selectedServiceId">
          <span class="badge-icon" v-html="getServiceIcon(selectedServiceId)"></span>
          {{ getServiceDisplayName(selectedServiceId) }}
        </template>
        <template v-else>
          <i class="pi pi-images" style="font-size: var(--text-2xs)"></i>
          全部图床
        </template>
        <i class="pi pi-chevron-down" style="font-size: var(--text-2xs); margin-left: 2px"></i>
      </button>
      <Transition name="dropdown">
        <div v-if="showServiceMenu" class="service-dropdown">
          <div
            class="service-dropdown-item" :class="{ active: !selectedServiceId }"
            @click="selectedServiceId = null; showServiceMenu = false"
          >
            <span class="sdi-label">全部图床</span>
            <span class="sdi-count">{{ stats.total.toLocaleString() }}</span>
          </div>
          <div
            v-for="svc in serviceList" :key="svc.id"
            class="service-dropdown-item" :class="{ active: selectedServiceId === svc.id }"
            @click="selectedServiceId = svc.id; showServiceMenu = false"
          >
            <span class="sdi-label">
              <span class="badge-icon" v-html="getServiceIcon(svc.id)"></span>
              {{ getServiceDisplayName(svc.id) }}
            </span>
            <span class="sdi-count">{{ svc.count.toLocaleString() }}</span>
          </div>
        </div>
      </Transition>
    </div>

    <div class="search-field" :class="{ focused: searchFocused }">
      <i class="pi pi-search search-field-icon"></i>
      <input
        v-model="searchInput" type="text" class="search-field-input"
        placeholder="搜索文件名..."
        aria-label="搜索链接文件名"
        @focus="searchFocused = true"
        @blur="searchFocused = false"
      />
      <i
        v-show="searchInput"
        class="pi pi-times search-field-clear"
        @click="searchInput = ''; searchQuery = ''"
      ></i>
    </div>
  </div>
</template>

<style scoped>
/* ===== 芯片栏 ===== */
.chip-bar {
  display: flex; align-items: center; gap: 10px; flex-shrink: 0;
  padding-right: 24px;
}
.chip-group { display: flex; gap: 6px; }
.chip-spacer { flex: 1; }

.filter-chip {
  display: inline-flex; align-items: center; gap: 5px;
  height: 26px; padding: 0 10px; border-radius: 13px;
  font-size: var(--text-xs); font-weight: 500; cursor: pointer;
  background: var(--bg-input); color: var(--text-muted);
  border: 1px solid transparent;
  transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast);
  white-space: nowrap;
}

.filter-chip:hover {
  background: var(--hover-overlay); border-color: var(--border-subtle);
}

.filter-chip.chip--error.active {
  background: var(--error-alpha-15); color: var(--error); border-color: var(--error-alpha-15);
}

.filter-chip.chip--suspicious.active {
  background: var(--pending-alpha-8); color: var(--pending); border-color: var(--pending-alpha-8);
}

.filter-chip.chip--timeout.active {
  background: var(--warning-alpha-8); color: var(--warning); border-color: var(--warning-alpha-8);
}
.chip-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

.filter-chip.chip--unchecked.active {
  background: var(--bg-input); color: var(--text-main); border-color: var(--border-subtle);
}

.filter-chip.chip--valid.active {
  background: var(--success-alpha-10); color: var(--success); border-color: var(--success-alpha-10);
}

.filter-chip.chip--all.active {
  background: var(--primary-alpha-10); color: var(--primary); border-color: var(--primary-alpha-10);
}

/* 图床筛选下拉 */
.service-filter { position: relative; flex-shrink: 0; }
.service-filter .filter-chip { gap: 4px; }
.service-filter .filter-chip.active { background: var(--primary-alpha-10); color: var(--primary); border-color: var(--primary-alpha-10); }
.service-filter .badge-icon { width: 12px; height: 12px; display: inline-flex; }

.service-dropdown {
  position: absolute; top: calc(100% + 6px); right: 0; min-width: 180px;
  background: var(--bg-card); border-radius: 10px; padding: 4px 0;
  box-shadow: var(--shadow-float); z-index: var(--z-dropdown, 100);
  border: 1px solid var(--border-subtle); overflow: hidden;
}

.service-dropdown-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 14px; cursor: pointer; transition: background var(--duration-micro);
}
.service-dropdown-item:hover { background: var(--hover-overlay); }
.service-dropdown-item.active { background: var(--primary-alpha-10); }
.sdi-label { display: flex; align-items: center; gap: 6px; font-size: var(--text-sm); font-weight: 500; color: var(--text-main); }
.sdi-label .badge-icon { width: 14px; height: 14px; color: var(--text-muted); }
.sdi-count { font-size: var(--text-2xs-xs); color: var(--text-tertiary); font-family: var(--font-mono, 'JetBrains Mono', monospace); }

.badge-icon {
  display: inline-flex; flex-shrink: 0;
  color: var(--text-muted);
}
.badge-icon :deep(svg) { width: 100%; height: 100%; }

/* 搜索框（药片型，与浏览界面对齐） */
.search-field {
  display: flex; align-items: center;
  background: var(--bg-input); border-radius: 16px;
  height: 32px; padding: 0 8px 0 10px;
  min-width: 140px; max-width: 260px; flex: 1;
  border: 1px solid transparent;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
  flex-shrink: 0;
}
.search-field.focused { border-color: var(--primary); }

.search-field-icon {
  color: var(--text-secondary); font-size: var(--text-xs); flex-shrink: 0;
  opacity: 0.5; margin-right: 6px; transition: opacity var(--duration-fast), color var(--duration-fast);
}
.search-field.focused .search-field-icon { opacity: 0.8; color: var(--primary); }

.search-field-input {
  flex: 1; background: transparent; border: none; box-shadow: none; outline: none;
  color: var(--text-primary); font-size: var(--text-sm); padding: 0; height: 100%; min-width: 0;
}
.search-field-input::placeholder { color: var(--text-secondary); opacity: 0.5; }

.search-field-clear {
  color: var(--text-secondary); font-size: var(--text-2xs); cursor: pointer; flex-shrink: 0;
  width: 20px; height: 20px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  transition: all var(--duration-fast); opacity: 0.5;
}
.search-field-clear:hover { color: var(--text-primary); background: var(--hover-overlay); opacity: 1; }

/* 下拉动画（复用 settings-shared 定义） */
.dropdown-enter-active, .dropdown-leave-active { transition: all var(--duration-normal) ease; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(8px); }
</style>
