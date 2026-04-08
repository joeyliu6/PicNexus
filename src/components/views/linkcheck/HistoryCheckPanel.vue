<script setup lang="ts">
/**
 * HistoryCheckPanel — 链接监控面板（方案A 极简克制）
 * 全宽单列、下划线 Tab、单行列表、hover 显示 URL
 */
import { computed } from 'vue';
import Skeleton from 'primevue/skeleton';
import EmptyState from '../../common/EmptyState.vue';
import { getServiceIcon } from '../../../utils/icons';
import { getServiceDisplayName } from '../../../constants/serviceNames';
import type { StatusFilter, LinkCheckRow, BatchCheckProgress } from '../../../types/linkCheck';
import { useCheckFilter } from '../../../composables/link-check/useCheckFilter';
import { useCheckStats } from '../../../composables/link-check/useCheckStats';
import { useCheckStrategy } from '../../../composables/link-check/useCheckStrategy';

const props = defineProps<{
  checkRows: LinkCheckRow[];
  isChecking: boolean;
  isLoading: boolean;
  progress: BatchCheckProgress | null;
  progressSource: 'monitor' | 'rescue' | null;
}>();

const emit = defineEmits<{
  (e: 'check-all'): void;
  (e: 'check-subset', filter: { statusFilter?: 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'valid' | 'problems'; serviceId?: string }): void;
  (e: 'cancel-check'): void;
  (e: 'recheck-single', row: LinkCheckRow, filter: StatusFilter): void;
  (e: 'copy-url', url: string): void;
  (e: 'export-csv'): void;
  (e: 'delete-row', row: LinkCheckRow): void;
  (e: 'delete-batch', ids: string[]): void;
  (e: 'recheck-batch', ids: string[]): void;
}>();

// ---- Composables ----
const checkRows = computed(() => props.checkRows);
const progress = computed(() => props.progress);

const {
  statusFilter, selectedServiceId, showServiceMenu, searchInput, searchQuery,
  searchFocused, showCheckMenu, progressHover,
  scopedRows, filteredRows, visibleRows,
  currentPage, totalPages, pageInput, handlePageInput, bottomSummary,
  selectedIds, hasSelection, selectedCount, isAllSelected,
  toggleSelect, toggleSelectAll, clearSelection,
} = useCheckFilter({ checkRows });

const { stats, serviceList, progressPercent, progressTooltip } = useCheckStats({ scopedRows, checkRows, progress });

const {
  smartCheckLabel, smartCheckTooltip, showDropdownArrow, buildDropdownItems, resolveSmartCheck,
  statusDotColor, errorBadgeClass, errorLabel, recheckLabel, errorTooltip,
} = useCheckStrategy({ stats, statusFilter });

// ---- 下拉菜单选项（桥接 composable 与 emit） ----
const dropdownItems = computed(() =>
  buildDropdownItems().map((item) => ({
    ...item,
    action: () => {
      if (item.action === 'check-all') emit('check-all');
      else emit('check-subset', { statusFilter: item.filter as 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'problems' });
      showCheckMenu.value = false;
    },
  })),
);

function handleSmartCheck() {
  showCheckMenu.value = false;
  const result = resolveSmartCheck();
  if (result.action === 'check-all') emit('check-all');
  else emit('check-subset', { statusFilter: result.filter as 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'problems' });
}

function handleCopyUrl(row: LinkCheckRow) {
  emit('copy-url', row.url);
}

function handleRecheck(row: LinkCheckRow) {
  emit('recheck-single', row, statusFilter.value);
}

function handleDeleteBatch() {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  emit('delete-batch', ids);
  clearSelection();
}

function handleRecheckBatch() {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  emit('recheck-batch', ids);
  clearSelection();
}
</script>

<template>
  <div class="monitor-panel" @click="showCheckMenu = false; showServiceMenu = false">
    <!-- 芯片栏：统计 + 筛选 + 进度 + 搜索 -->
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
            <i class="pi pi-images" style="font-size: 10px"></i>
            全部图床
          </template>
          <i class="pi pi-chevron-down" style="font-size: 8px; margin-left: 2px"></i>
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

    <!-- 链接列表 -->
    <div class="link-list-wrap">
      <!-- 加载骨架屏 -->
      <div v-if="isLoading && stats.total === 0" class="link-list">
        <div v-for="i in 15" :key="'sk-' + i" class="link-row skeleton-row">
          <Skeleton width="6px" height="6px" shape="circle" />
          <Skeleton width="28%" height="14px" border-radius="4px" />
          <span class="link-spacer"></span>
          <Skeleton width="56px" height="18px" border-radius="4px" />
          <Skeleton width="32px" height="14px" border-radius="3px" />
          <Skeleton width="18px" height="18px" shape="circle" />
          <Skeleton width="18px" height="18px" shape="circle" />
        </div>
      </div>

      <!-- Hero 空状态：从未检测过 -->
      <div v-else-if="stats.total > 0 && stats.checked === 0 && !isChecking" class="hero-empty">
        <div class="hero-icon">
          <i class="pi pi-shield"></i>
        </div>
        <h3 class="hero-title">检查你的图片链接</h3>
        <p class="hero-desc">扫描全部上传历史，发现失效和异常链接</p>
        <button class="hero-cta" @click="emit('check-all')">
          <i class="pi pi-play"></i> 开始全面检测
        </button>
        <span class="hero-meta">共 {{ stats.total.toLocaleString() }} 个链接待检测</span>
      </div>

      <!-- 普通空状态：筛选无结果 -->
      <EmptyState
        v-else-if="filteredRows.length === 0 && (stats.checked > 0 || isChecking)"
        icon="pi pi-check-circle"
        title="没有问题链接"
        description="当前筛选条件下没有匹配结果"
      />

      <!-- 真正的空：无数据 -->
      <EmptyState
        v-else-if="stats.total === 0 && !isLoading"
        icon="pi pi-shield"
        title="暂无数据"
        description="尚无上传历史记录"
      />

      <TransitionGroup v-else tag="div" name="row-list" class="link-list">
        <div
          v-for="row in visibleRows" :key="row.historyId + row.serviceId"
          class="link-row" :class="{ 'row-selected': selectedIds.has(row.historyId), 'fading-out': row.fadingOut }"
          @click="!isChecking && toggleSelect(row.historyId)"
        >
          <span class="status-dot" :style="{ background: statusDotColor(row) }"></span>
          <span
            class="link-filename"
            :class="{ 'filename-selected': selectedIds.has(row.historyId) }"
          >{{ row.fileName }}</span>
          <span class="link-spacer"></span>
          <span
            v-tooltip.top="'点击复制链接'"
            class="service-badge"
            @click.stop="handleCopyUrl(row)"
          >
            <span class="badge-icon" v-html="getServiceIcon(row.serviceId)"></span>
            <span class="badge-label">{{ getServiceDisplayName(row.serviceId) }}</span>
          </span>
          <span
            v-tooltip.top="errorTooltip(row)"
            class="error-badge"
            :class="errorBadgeClass(row)"
          >
            {{ errorLabel(row) }}
          </span>
          <!-- 右侧操作区：recheck-slot + delete-btn 收紧间距 -->
          <div class="row-actions">
            <div class="recheck-slot">
              <span
                v-if="row.recheckResult"
                class="recheck-result-badge"
                :class="{
                  'badge-fading':     row.recheckBadgeFading,
                  'badge-valid':      row.recheckResult.is_valid,
                  'badge-suspicious': row.recheckResult.error_type === 'suspicious' || row.recheckResult.browser_might_work,
                  'badge-timeout':    row.recheckResult.error_type === 'timeout',
                  'badge-invalid':    !row.recheckResult.is_valid && row.recheckResult.error_type !== 'timeout' && row.recheckResult.error_type !== 'suspicious' && !row.recheckResult.browser_might_work,
                }"
              >{{ recheckLabel(row.recheckResult) }}</span>
              <button
                v-else
                class="recheck-btn"
                :class="{ spinning: row.recheckLoading }"
                v-tooltip.top="'重新检测'"
                @click.stop="handleRecheck(row)"
              >
                <i class="pi pi-refresh"></i>
              </button>
            </div>
            <button
              class="delete-btn"
              :disabled="isChecking"
              v-tooltip.top="'删除此记录'"
              @click.stop="emit('delete-row', row)"
            >
              <i class="pi pi-trash"></i>
            </button>
          </div>
        </div>
      </TransitionGroup>
    </div>

    <!-- 底部 -->
    <div class="bottom">
      <!-- 极简进度条（仅在监控自身检测时显示，防止被文档修复串扰） -->
      <div
        v-if="isChecking && progressSource !== 'rescue'"
        class="progress-bar"
        role="progressbar"
        :aria-valuenow="progressPercent"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="progressTooltip"
        @mouseenter="progressHover = true"
        @mouseleave="progressHover = false"
      >
        <Transition name="fade">
          <div v-if="progressHover" class="progress-tooltip">{{ progressTooltip }}</div>
        </Transition>
        <div class="progress-bar-inner">
          <div class="progress-bar-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
      </div>
      <div class="bottom-main">
        <!-- 选中模式：底栏左侧保留分页，右侧显示批量操作 -->
        <template v-if="hasSelection && !isChecking">
          <div class="pagination">
            <button class="page-btn" :disabled="currentPage <= 1" @click="currentPage--">
              <i class="pi pi-chevron-left"></i>
            </button>
            <span class="page-info">
              <input
                class="page-input" type="text"
                v-model="pageInput"
                @keydown.enter="handlePageInput($event)"
                @blur="handlePageInput($event)"
                @focus="($event.target as HTMLInputElement).select()"
              />
              / {{ totalPages }}
            </span>
            <button class="page-btn" :disabled="currentPage >= totalPages" @click="currentPage++">
              <i class="pi pi-chevron-right"></i>
            </button>
          </div>
          <div class="batch-bottom-right">
            <span class="batch-count">已选 {{ selectedCount }} 条记录</span>
            <button class="btn-ghost btn-sm" @click="toggleSelectAll">
              {{ isAllSelected ? '取消全选' : '全选' }}
            </button>
            <button class="btn-ghost btn-sm" @click="clearSelection">取消选择</button>
            <button class="btn-primary btn-sm" @click="handleRecheckBatch" :disabled="isChecking">
              <i class="pi pi-refresh"></i> 重新检测
            </button>
            <button class="btn-danger btn-sm" @click="handleDeleteBatch" :disabled="isChecking">
              <i class="pi pi-trash"></i> 删除选中
            </button>
          </div>
        </template>

        <!-- 正常模式 -->
        <template v-else>
          <div class="pagination">
            <button class="page-btn" :disabled="currentPage <= 1" @click="currentPage--">
              <i class="pi pi-chevron-left"></i>
            </button>
            <span class="page-info">
              <input
                class="page-input" type="text"
                v-model="pageInput"
                @keydown.enter="handlePageInput($event)"
                @blur="handlePageInput($event)"
                @focus="($event.target as HTMLInputElement).select()"
              />
              / {{ totalPages }}
            </span>
            <button class="page-btn" :disabled="currentPage >= totalPages" @click="currentPage++">
              <i class="pi pi-chevron-right"></i>
            </button>
          </div>
          <span class="page-summary">
            <template v-if="isLoading && stats.total === 0">
              <Skeleton width="64px" height="14px" border-radius="4px" />
            </template>
            <template v-else>{{ bottomSummary }}</template>
          </span>
          <div class="bottom-actions" @click.stop>
            <button v-tooltip.top="'导出检测结果为 CSV 文件'" class="btn-ghost" @click="emit('export-csv')">
              <i class="pi pi-download"></i> 导出
            </button>
            <span class="action-divider"></span>
            <div v-if="!isChecking" class="check-btn-group" :class="{ 'has-dropdown': showDropdownArrow }">
              <button v-tooltip.top="smartCheckTooltip" class="btn-primary" @click="handleSmartCheck">
                <svg viewBox="0 0 16 16" fill="currentColor" width="10" height="10" style="flex-shrink:0;display:block"><path d="M3 2l10 6-10 6V2z"/></svg> {{ smartCheckLabel }}
              </button>
              <button
                v-if="showDropdownArrow"
                class="btn-primary check-toggle"
                @click="showCheckMenu = !showCheckMenu"
              >
                <i class="pi pi-chevron-down" style="font-size: 10px"></i>
              </button>
              <Transition name="dropdown">
                <div v-if="showCheckMenu && showDropdownArrow" class="check-dropdown">
                  <div
                    v-for="(item, idx) in dropdownItems" :key="idx"
                    class="check-dropdown-item"
                    @click="item.action()"
                  >
                    <div class="dropdown-text">
                      <span class="dropdown-label">{{ item.label }}</span>
                      <span class="dropdown-desc">{{ item.desc }}</span>
                    </div>
                  </div>
                </div>
              </Transition>
            </div>
            <button v-else class="btn-danger" @click="emit('cancel-check')">
              <i class="pi pi-stop"></i> 取消
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.monitor-panel {
  display: flex; flex-direction: column; height: 100%; gap: 14px;
  padding: 20px 0 20px 24px; overflow: hidden;
}

/* ===== 底部操作按钮 ===== */
.bottom-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.action-divider {
  width: 1px; height: 16px; background: var(--border-subtle); flex-shrink: 0;
}

/* ===== 按钮 ===== */
.btn-ghost, .btn-primary, .btn-danger {
  display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 11px;
  border-radius: 7px; font-size: 12px; font-weight: 500; cursor: pointer;
  white-space: nowrap; transition: background var(--duration-fast), opacity var(--duration-fast); border: none;
}
.btn-ghost i, .btn-primary i, .btn-danger i { font-size: var(--text-2xs-xs); }
.btn-ghost { background: var(--bg-input); color: var(--text-muted); }
.btn-ghost:hover { background: var(--hover-overlay); color: var(--text-main); }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { opacity: 0.9; }
.btn-danger { background: var(--error-alpha-15); color: var(--error); border: 1px solid transparent; }
.btn-danger:hover { background: var(--error-alpha-8); border-color: var(--error-alpha-15); box-shadow: none; }

.check-btn-group { display: flex; position: relative; }
.check-btn-group.has-dropdown .btn-primary:first-child { border-radius: 7px 0 0 7px; }
.check-toggle { border-radius: 0 7px 7px 0; padding: 0 7px; border-left: 1px solid var(--primary-alpha-15); }
.check-dropdown {
  position: absolute; bottom: calc(100% + 6px); right: 0; min-width: 220px;
  background: var(--bg-card); border-radius: 10px; padding: 4px 0;
  box-shadow: var(--shadow-float); z-index: var(--z-dropdown, 100);
  border: 1px solid var(--border-subtle); overflow: hidden;
}
.check-dropdown-item {
  display: flex; flex-direction: row; align-items: center; gap: 8px;
  padding: 7px 14px; cursor: pointer; transition: background var(--duration-micro);
}
.check-dropdown-item:not(:last-child) { border-bottom: 1px solid var(--border-subtle); }
.check-dropdown-item:hover { background: var(--hover-overlay-subtle); }
.dropdown-text { display: flex; flex-direction: column; gap: 2px; }
.dropdown-label { font-size: 13px; font-weight: 500; color: var(--text-main); }
.dropdown-desc { font-size: var(--text-2xs-xs); color: var(--text-tertiary); }

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
  font-size: 12px; font-weight: 500; cursor: pointer;
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

/* ===== 极简进度条 ===== */
.progress-bar {
  width: 100%; flex-shrink: 0; cursor: default;
  padding: 5px 0; position: relative;
}
.progress-tooltip {
  position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
  padding: 4px 10px; border-radius: 6px; white-space: nowrap;
  font-size: var(--text-2xs-xs); color: var(--text-main); font-variant-numeric: tabular-nums;
  background: var(--bg-card); box-shadow: var(--shadow-float);
  border: 1px solid var(--border-subtle); pointer-events: none;
}
.fade-enter-active { transition: opacity var(--duration-fast); }
.fade-leave-active { transition: opacity var(--duration-micro); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.progress-bar-inner {
  width: 100%; height: 3px; background: var(--bg-input);
  border-radius: 1.5px; overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), var(--primary-light, #60a5fa));
  transition: width var(--duration-slower) var(--ease-standard);
  position: relative; overflow: hidden;
}
.progress-bar-fill::after {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
  animation: k-sweep 1.5s ease-in-out infinite;
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
.sdi-label { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--text-main); }
.sdi-label .badge-icon { width: 14px; height: 14px; color: var(--text-muted); }
.sdi-count { font-size: var(--text-2xs-xs); color: var(--text-tertiary); font-family: var(--font-mono, 'JetBrains Mono', monospace); }

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
  color: var(--text-secondary); font-size: 12px; flex-shrink: 0;
  opacity: 0.5; margin-right: 6px; transition: opacity var(--duration-fast), color var(--duration-fast);
}
.search-field.focused .search-field-icon { opacity: 0.8; color: var(--primary); }
.search-field-input {
  flex: 1; background: transparent; border: none; box-shadow: none; outline: none;
  color: var(--text-primary); font-size: 12.5px; padding: 0; height: 100%; min-width: 0;
}
.search-field-input::placeholder { color: var(--text-secondary); opacity: 0.5; }
.search-field-clear {
  color: var(--text-secondary); font-size: 10px; cursor: pointer; flex-shrink: 0;
  width: 20px; height: 20px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  transition: all var(--duration-fast); opacity: 0.5;
}
.search-field-clear:hover { color: var(--text-primary); background: var(--hover-overlay); opacity: 1; }

/* ===== 链接列表（单行紧凑） ===== */
.link-list-wrap {
  flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
}
.link-list { flex: 1; overflow-y: auto; }

.link-row {
  display: flex; align-items: center; gap: 10px; padding: 0 16px 0 11px;
  height: 40px; cursor: pointer;
  border-bottom: 1px solid var(--primary-alpha-5);
  transition: background var(--duration-micro);
}
.skeleton-row { pointer-events: none; }
.link-row:last-child { border-bottom: none; }
.link-row:hover { background: var(--hover-overlay-subtle); }

.status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

.link-filename {
  font-size: 13px; font-weight: 500; color: var(--text-main);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex-shrink: 1; min-width: 0;
}

/* 图床图标 badge */
.service-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 4px;
  cursor: pointer; flex-shrink: 0;
  transition: background var(--duration-micro);
}
.service-badge:hover { background: var(--primary-alpha-8); }
.badge-icon {
  width: 14px; height: 14px;
  display: inline-flex; flex-shrink: 0;
  color: var(--text-muted);
}
.badge-icon :deep(svg) { width: 100%; height: 100%; }
.badge-label {
  font-size: var(--text-2xs-xs); font-weight: 500; color: var(--text-muted);
}
/* 错误标签 badge */
.error-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 36px;
  padding: 1px 6px; border-radius: 4px;
  font-size: 10px; font-weight: 600;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  flex-shrink: 0; cursor: default;
}
.error-badge--success { background: var(--success-alpha-10); color: var(--success); }
.error-badge--unchecked { background: var(--hover-overlay-subtle); color: var(--text-tertiary); }
.error-badge--error { background: var(--error-alpha-10); color: var(--error); }
.error-badge--warning { background: var(--warning-alpha-8); color: var(--warning); }
.error-badge--suspicious { background: var(--pending-alpha-8); color: var(--pending); }
.link-spacer { flex: 1; }

/* 文件名选中 */
.link-filename.filename-selected {
  color: var(--primary);
  font-weight: 600;
}
.link-row.row-selected { background: var(--primary-alpha-8) !important; }
.link-row.row-selected:hover { background: var(--primary-alpha-12) !important; }

/* 重检 + 删除按钮共用样式 */
.recheck-btn, .delete-btn {
  display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  border: none; border-radius: 5px; background: transparent; color: var(--text-tertiary);
  cursor: pointer; transition: background var(--duration-micro), color var(--duration-micro); font-size: var(--text-2xs-xs);
  flex-shrink: 0;
}
/* recheck-btn / delete-btn 透明度由父级 row-actions 统一控制 */
.recheck-btn, .delete-btn { opacity: 1; }
.recheck-btn:hover { background: var(--primary-alpha-8); color: var(--primary); }
.delete-btn:hover { background: var(--error-alpha-10); color: var(--error); }
.delete-btn:disabled { opacity: 0.1; cursor: default; pointer-events: none; }
/* 行离场动画（Case B 重检 / 删除：整行淡出 + 高度收缩，下方行平滑上移） */
.link-row.fading-out {
  opacity: 0;
  height: 0 !important;
  border-bottom-width: 0 !important;
  overflow: hidden;
  transition: opacity var(--duration-medium) ease, height var(--duration-slow) ease, border-bottom-width var(--duration-normal) ease;
  pointer-events: none;
}

/* spinning 时用 CSS 圆弧替代字体图标，彻底消除字形不居中导致的晃动 */
.recheck-btn.spinning .pi {
  width: 12px;
  height: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.recheck-btn.spinning .pi::before {
  content: '' !important;
  display: block;
  width: 12px;
  height: 12px;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: k-spin 0.7s linear infinite;
  flex-shrink: 0;
}

/* 右侧操作区：recheck + delete 整体收紧 */
.row-actions {
  display: flex; align-items: center; gap: 4px; flex-shrink: 0;
}

/* 按钮位置固定宽度槽，防止 badge ↔ button 切换时布局抖动 */
.recheck-slot {
  width: 36px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.link-row:not(:hover) .row-actions { opacity: 0.2; }
.link-row:hover .row-actions { opacity: 1; }
.row-actions:has(.recheck-result-badge) { opacity: 1 !important; }

/* 按钮位置结果徽章 */
.recheck-result-badge {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 20px; border-radius: 4px;
  font-size: 10px; font-weight: 600; letter-spacing: 0.02em;
  flex-shrink: 0; cursor: default;
  opacity: 1; transition: opacity var(--duration-medium) ease;
}
.recheck-result-badge.badge-fading     { opacity: 0; }
.recheck-result-badge.badge-valid      { background: var(--success-alpha-15, rgba(34, 197, 94, 0.15)); color: var(--success, #22c55e); }
.recheck-result-badge.badge-invalid    { background: var(--error-alpha-10); color: var(--error); }
.recheck-result-badge.badge-timeout    { background: var(--warning-alpha-8); color: var(--warning); }
.recheck-result-badge.badge-suspicious { background: var(--pending-alpha-8); color: var(--pending); }

/* 底栏批量操作模式 */
.batch-bottom-right { display: flex; align-items: center; gap: 8px; }
.batch-count { font-size: 12px; color: var(--text-muted); font-weight: 500; }

/* 行入场动画（leave 由 fadingOut class 自行处理，此处只定义 enter） */
.row-list-enter-active {
  transition: opacity var(--duration-normal) ease, transform var(--duration-normal) ease;
}
.row-list-enter-from {
  opacity: 0;
  transform: translateY(-5px);
}

/* 下拉动画（复用 settings-shared 定义） */
.dropdown-enter-active, .dropdown-leave-active { transition: all var(--duration-normal) ease; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(8px); }

/* ===== Hero 空状态（首次检测） ===== */
.hero-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; flex: 1; padding: 40px 0;
}
.hero-icon {
  width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;
  border-radius: 16px; background: var(--primary-alpha-10); margin-bottom: 4px;
}
.hero-icon .pi { font-size: 24px; color: var(--primary); }
.hero-title { font-size: 18px; font-weight: 700; color: var(--text-main); margin: 0; }
.hero-desc { font-size: 13px; color: var(--text-muted); margin: 0; }
.hero-cta {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 28px; margin-top: 8px;
  background: var(--primary); color: #fff; border: none; border-radius: 10px;
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: opacity var(--duration-fast), transform var(--duration-micro);
}
.hero-cta:hover { opacity: 0.9; }
.hero-cta:active { transform: scale(0.97); }
.hero-meta { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }

/* ===== 底部 ===== */
.bottom { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; padding-right: 24px; }
.bottom-main {
  display: flex; align-items: center; justify-content: space-between;
}
.page-summary { font-size: 12px; color: var(--text-tertiary); white-space: nowrap; }
.pagination { display: flex; align-items: center; gap: 4px; margin-right: 10px; }
.page-btn {
  display: flex; align-items: center; justify-content: center; width: 26px; height: 26px;
  border: none; border-radius: 5px; background: var(--bg-input); color: var(--text-muted);
  cursor: pointer; transition: background var(--duration-micro), color var(--duration-micro); font-size: 12px;
}
.page-btn:hover:not(:disabled) { background: var(--primary-alpha-8); color: var(--primary); }
.page-btn:disabled { opacity: 0.3; cursor: default; }
.page-info {
  font-size: 12px; color: var(--text-muted);
  display: inline-flex; align-items: center; gap: 4px; margin: 0 4px;
}
.page-input {
  width: 32px; height: 22px; text-align: center; border: 1px solid var(--border-subtle);
  border-radius: 4px; background: var(--bg-input); color: var(--text-main); font-size: 12px;
  outline: none;
}
.page-input::placeholder { color: var(--text-main); opacity: 0.6; }
.page-input:focus { border-color: var(--primary); }



</style>
