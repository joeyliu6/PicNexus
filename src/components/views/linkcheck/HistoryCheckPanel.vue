<script setup lang="ts">
/**
 * HistoryCheckPanel — 链接监控面板（方案A 极简克制）
 * 全宽单列、下划线 Tab、单行列表、hover 显示 URL
 */
import { ref, computed, watch } from 'vue';
import Checkbox from 'primevue/checkbox';
import Skeleton from 'primevue/skeleton';
import { getServiceIcon } from '../../../utils/icons';
import { getServiceDisplayName } from '../../../constants/serviceNames';
import type { LinkCheckRow, BatchCheckProgress } from '../../../types/linkCheck';

const props = defineProps<{
  checkRows: LinkCheckRow[];
  isChecking: boolean;
  isLoading: boolean;
  progress: BatchCheckProgress | null;
}>();

const emit = defineEmits<{
  (e: 'check-all'): void;
  (e: 'check-subset', filter: { statusFilter?: 'unchecked' | 'invalid'; serviceId?: string }): void;
  (e: 'cancel-check'): void;
  (e: 'recheck-single', row: LinkCheckRow): void;
  (e: 'copy-url', url: string): void;
  (e: 'export-csv'): void;
  (e: 'open-md-rescue'): void;
  (e: 'delete-row', row: LinkCheckRow): void;
  (e: 'delete-batch', ids: string[]): void;
}>();

// ============================================
// 筛选 + 分页
// ============================================

type StatusFilter = 'invalid' | 'suspicious' | 'timeout' | 'unchecked' | 'valid' | 'all' | null;
const statusFilter = ref<StatusFilter>(null);
const selectedServiceId = ref<string | null>(null);
const showServiceMenu = ref(false);
const searchQuery = ref('');
const PAGE_SIZE = 100;
const currentPage = ref(1);
const showCheckMenu = ref(false);
const searchFocused = ref(false);
const progressHover = ref(false);

watch(statusFilter, () => { currentPage.value = 1; });
watch(selectedServiceId, () => { currentPage.value = 1; });
watch(searchQuery, () => { currentPage.value = 1; });

// 作用域行：只应用图床 + 搜索筛选，不含状态筛选（供 stats 和 filteredRows 共用）
const scopedRows = computed(() => {
  let rows: LinkCheckRow[] = props.checkRows;
  if (selectedServiceId.value) {
    rows = rows.filter((row) => row.serviceId === selectedServiceId.value);
  }
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    rows = rows.filter((row) =>
      row.url.toLowerCase().includes(q) || row.fileName.toLowerCase().includes(q) || row.serviceId.toLowerCase().includes(q),
    );
  }
  return rows;
});

const stats = computed(() => {
  const rows = scopedRows.value;
  const valid = rows.filter((r) => r.checkResult?.is_valid).length;
  const invalid = rows.filter(
    (r) => r.checkResult && !r.checkResult.is_valid
      && r.checkResult.error_type !== 'timeout' && r.checkResult.error_type !== 'suspicious',
  ).length;
  const timeout = rows.filter((r) => r.checkResult?.error_type === 'timeout').length;
  const suspicious = rows.filter((r) => r.checkResult?.error_type === 'suspicious').length;
  const unchecked = rows.filter((r) => !r.checkResult).length;
  const checked = rows.length - unchecked;
  const problems = invalid + timeout + suspicious;
  return { total: rows.length, valid, invalid, timeout, suspicious, unchecked, checked, problems };
});

// 按图床统计
const serviceList = computed(() => {
  const map = new Map<string, number>();
  for (const row of props.checkRows) {
    map.set(row.serviceId, (map.get(row.serviceId) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);
});

const filteredRows = computed(() => {
  // 图床 + 搜索筛选已在 scopedRows 完成，这里只做状态筛选 + 排序
  let rows = scopedRows.value.filter((row) => {
    const r = row.checkResult;
    switch (statusFilter.value) {
      case null: return r && !r.is_valid;
      case 'invalid': return r && !r.is_valid && r.error_type !== 'timeout' && r.error_type !== 'suspicious';
      case 'suspicious': return r?.error_type === 'suspicious';
      case 'timeout': return r?.error_type === 'timeout';
      case 'unchecked': return !r;
      case 'valid': return r?.is_valid;
      case 'all': return true;
      default: return true;
    }
  });
  // 按严重程度排序：失效 > 超时 > 可疑
  const severity: Record<string, number> = { http_4xx: 0, http_5xx: 1, network: 2, timeout: 3, suspicious: 4, success: 5 };
  rows = [...rows].sort((a, b) =>
    (severity[a.checkResult?.error_type ?? 'success'] ?? 5) - (severity[b.checkResult?.error_type ?? 'success'] ?? 5),
  );
  return rows;
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / PAGE_SIZE)));
const visibleRows = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return filteredRows.value.slice(start, start + PAGE_SIZE);
});

const progressPercent = computed(() => {
  if (stats.value.total === 0) return 0;
  // 历史已检测 + 本轮已检测 = 整体完成度
  const currentChecked = stats.value.checked + (props.progress?.checked ?? 0);
  return Math.min(100, Math.round((currentChecked / stats.value.total) * 100));
});

const progressTooltip = computed(() => {
  if (props.progress && props.progress.total > 0) {
    return `本次已检测 ${props.progress.checked.toLocaleString()} / ${props.progress.total.toLocaleString()} 条`;
  }
  return '准备检测...';
});

// ============================================
// 智能检测
// ============================================

const smartCheckLabel = computed(() => {
  if (stats.value.unchecked === stats.value.total) return '开始检测';
  if (stats.value.unchecked > 0) return '继续检测';
  if (stats.value.problems > 0) return `重检问题链接 (${stats.value.problems})`;
  return '重新检测全部';
});

// 智能检测按钮 tooltip
const smartCheckTooltip = computed(() => {
  const { unchecked, total, problems } = stats.value;
  if (unchecked === total) return `检测全部 ${total.toLocaleString()} 条链接`;
  if (unchecked > 0) return `检测尚未验证的 ${unchecked.toLocaleString()} 条链接`;
  if (problems > 0) return `重新验证 ${problems} 条问题链接`;
  return `重新检测全部 ${total.toLocaleString()} 条链接`;
});

// 是否显示下拉箭头（只有一种操作时隐藏）
const showDropdownArrow = computed(() => {
  // 全部未检测 → 只有"开始检测"一个动作
  if (stats.value.unchecked === stats.value.total) return false;
  // 全部已检测且没有问题 → 只有"重新检测全部"一个动作
  if (stats.value.unchecked === 0 && stats.value.problems === 0) return false;
  return true;
});

// 下拉菜单选项
const dropdownItems = computed(() => {
  const items: Array<{
    label: string;
    desc: string;
    action: () => void;
  }> = [];
  const { total, unchecked, problems } = stats.value;

  items.push({
    label: `检测全部 (${total.toLocaleString()})`,
    desc: '包括已检测的链接',
    action: () => { emit('check-all'); showCheckMenu.value = false; },
  });

  if (unchecked > 0 && unchecked < total) {
    items.push({
      label: `仅未检测 (${unchecked.toLocaleString()})`,
      desc: '跳过已有结果的链接',
      action: () => { emit('check-subset', { statusFilter: 'unchecked' }); showCheckMenu.value = false; },
    });
  }

  if (problems > 0) {
    items.push({
      label: `重检问题链接 (${problems})`,
      desc: '重新验证失效、超时、可疑链接',
      action: () => { emit('check-subset', { statusFilter: 'invalid' }); showCheckMenu.value = false; },
    });
  }

  return items;
});

function handleSmartCheck() {
  showCheckMenu.value = false;
  const { unchecked, total, problems } = stats.value;
  if (unchecked === total) {
    // 全部未检测 → 检测全部
    emit('check-all');
  } else if (unchecked > 0) {
    // 部分已检测 → 继续检测未检测的
    emit('check-subset', { statusFilter: 'unchecked' });
  } else if (problems > 0) {
    // 全部已检测有问题 → 重检问题链接
    emit('check-subset', { statusFilter: 'invalid' });
  } else {
    // 全部已检测无问题 → 重新检测全部
    emit('check-all');
  }
}

// ============================================
// 行为辅助
// ============================================

const pageInput = ref('');

// 底栏简洁摘要：只显示「当前列表数 / 总数」
const bottomSummary = computed(() => {
  const filtered = filteredRows.value.length;
  const total = stats.value.total;
  if (total === 0) return '';
  // 有筛选时显示 "筛选结果 / 总数"，无筛选时只显示总数
  const hasFilter = statusFilter.value || searchQuery.value.trim() || selectedServiceId.value;
  return hasFilter
    ? `${filtered.toLocaleString()} / ${total.toLocaleString()} 条`
    : `共 ${total.toLocaleString()} 条`;
});

function handlePageInput(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value, 10);
  if (Number.isNaN(val) || val < 1) {
    currentPage.value = 1;
  } else if (val > totalPages.value) {
    currentPage.value = totalPages.value;
  } else {
    currentPage.value = val;
  }
  pageInput.value = '';
}

function handleCopyUrl(row: LinkCheckRow) {
  emit('copy-url', row.url);
}

function statusDotColor(row: LinkCheckRow): string {
  const r = row.checkResult;
  if (!r) return 'var(--text-tertiary)';
  if (r.is_valid) return 'var(--success)';
  if (r.error_type === 'timeout') return 'var(--warning)';
  if (r.error_type === 'suspicious') return 'var(--pending)';
  return 'var(--error)';
}

function errorLabel(row: LinkCheckRow): string {
  const r = row.checkResult;
  if (!r || r.is_valid) return '';
  if (r.status_code) return String(r.status_code);
  if (r.error_type === 'timeout') return '超时';
  if (r.error_type === 'network') return '网络';
  if (r.error_type === 'suspicious') return '疑似';
  return '失效';
}

// 状态码友好描述
const STATUS_DESC: Record<number, string> = {
  400: '请求异常 · 链接格式可能有误',
  401: '需要认证 · 图床要求登录才能访问',
  403: '禁止访问 · 可能触发了防盗链',
  404: '图片不存在 · 可能已被删除或链接失效',
  405: '请求方式不允许 · 图床不支持 HEAD 请求',
  408: '请求超时 · 图床响应过慢',
  410: '已永久移除 · 图片已被图床永久删除',
  429: '请求过频 · 检测速度过快被限流，稍后重试',
  500: '服务器内部错误 · 图床服务异常',
  502: '网关错误 · 图床服务可能正在维护',
  503: '服务不可用 · 图床暂时下线，稍后重试',
  504: '网关超时 · 图床上游服务响应超时',
};

function errorTooltip(row: LinkCheckRow): string {
  const r = row.checkResult;
  if (!r || r.is_valid) return '';

  const parts: string[] = [];

  if (r.status_code) {
    const desc = STATUS_DESC[r.status_code];
    if (r.browser_might_work) {
      parts.push(`防盗链限制 (${r.status_code}) · 浏览器直接打开可正常显示`);
    } else if (desc) {
      parts.push(`${desc} (${r.status_code})`);
    } else {
      // 未知状态码回退
      const prefix = r.error_type === 'http_5xx' ? '服务器错误' : '请求失败';
      parts.push(`${prefix} (${r.status_code})`);
    }
  } else {
    const fallback: Record<string, string> = {
      timeout: '检测超时 · 网络延迟或图床响应过慢',
      network: '网络不通 · 无法连接到图床服务器',
      suspicious: '疑似异常 · 返回了内容但不像是图片（类型或体积异常）',
    };
    parts.push(fallback[r.error_type] || '链接失效');
  }

  if (r.response_time) parts.push(`${r.response_time}ms`);

  return parts.join(' · ');
}

// 重检按钮旋转
const spinningRowId = ref<string | null>(null);
function handleRecheck(row: LinkCheckRow) {
  spinningRowId.value = row.historyId + row.serviceId;
  emit('recheck-single', row);
  setTimeout(() => { spinningRowId.value = null; }, 800);
}

// ============================================
// 选择 + 删除
// ============================================

const selectedIds = ref<Set<string>>(new Set());
const hasSelection = computed(() => selectedIds.value.size > 0);

// 当前筛选结果中的唯一 historyId 列表
const filteredHistoryIds = computed(() => [...new Set(filteredRows.value.map((r) => r.historyId))]);
const isAllSelected = computed(() =>
  filteredHistoryIds.value.length > 0 && filteredHistoryIds.value.every((id) => selectedIds.value.has(id)),
);

// 选中数量（按唯一 historyId 计算）
const selectedCount = computed(() => selectedIds.value.size);

function toggleSelect(historyId: string) {
  const next = new Set(selectedIds.value);
  if (next.has(historyId)) next.delete(historyId);
  else next.add(historyId);
  selectedIds.value = next;
}

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedIds.value = new Set();
  } else {
    selectedIds.value = new Set(filteredHistoryIds.value);
  }
}

function clearSelection() {
  selectedIds.value = new Set();
}

function handleDeleteBatch() {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  emit('delete-batch', ids);
  clearSelection();
}
</script>

<template>
  <div class="monitor-panel" @click="showCheckMenu = false; showServiceMenu = false">
    <!-- 芯片栏：统计 + 筛选 + 进度 + 搜索 -->
    <div class="chip-bar">
      <div class="chip-group">
        <button
          class="filter-chip chip--error" :class="{ active: statusFilter === 'invalid' }"
          @click="statusFilter = statusFilter === 'invalid' ? null : 'invalid'"
        >
          <span class="chip-dot" style="background: var(--error)"></span>
          失效 {{ stats.invalid }}
        </button>
        <button
          v-if="stats.suspicious > 0"
          class="filter-chip chip--suspicious" :class="{ active: statusFilter === 'suspicious' }"
          @click="statusFilter = statusFilter === 'suspicious' ? null : 'suspicious'"
        >
          <span class="chip-dot" style="background: var(--pending)"></span>
          可疑 {{ stats.suspicious }}
        </button>
        <button
          v-if="stats.timeout > 0"
          class="filter-chip chip--timeout" :class="{ active: statusFilter === 'timeout' }"
          @click="statusFilter = statusFilter === 'timeout' ? null : 'timeout'"
        >
          <span class="chip-dot" style="background: var(--warning)"></span>
          超时 {{ stats.timeout }}
        </button>
        <button
          v-if="stats.unchecked > 0"
          class="filter-chip chip--unchecked" :class="{ active: statusFilter === 'unchecked' }"
          @click="statusFilter = statusFilter === 'unchecked' ? null : 'unchecked'"
        >
          <span class="chip-dot" style="background: var(--text-tertiary)"></span>
          未检测 {{ stats.unchecked }}
        </button>
        <button
          class="filter-chip chip--valid" :class="{ active: statusFilter === 'valid' }"
          @click="statusFilter = statusFilter === 'valid' ? null : 'valid'"
        >
          <span class="chip-dot" style="background: var(--success)"></span>
          正常 {{ stats.valid }}
        </button>
        <button
          class="filter-chip chip--all" :class="{ active: statusFilter === 'all' }"
          @click="statusFilter = statusFilter === 'all' ? null : 'all'"
        >
          全部 {{ stats.total }}
        </button>
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
          v-model="searchQuery" type="text" class="search-field-input"
          placeholder="搜索文件名..."
          @focus="searchFocused = true"
          @blur="searchFocused = false"
        />
        <i
          v-show="searchQuery"
          class="pi pi-times search-field-clear"
          @click="searchQuery = ''"
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
      <div v-else-if="filteredRows.length === 0 && (stats.checked > 0 || isChecking)" class="empty-state">
        <i class="pi pi-check-circle"></i>
        <p class="empty-title">没有问题链接</p>
        <p class="empty-desc">当前筛选条件下没有匹配结果</p>
      </div>

      <!-- 真正的空：无数据 -->
      <div v-else-if="stats.total === 0 && !isLoading" class="empty-state">
        <i class="pi pi-shield"></i>
        <p class="empty-title">暂无数据</p>
        <p class="empty-desc">尚无上传历史记录</p>
      </div>

      <div v-else class="link-list">
        <div
          v-for="row in visibleRows" :key="row.historyId + row.serviceId"
          class="link-row" :class="{ 'row-selected': selectedIds.has(row.historyId), 'has-selection': hasSelection }"
        >
          <span class="status-dot" :style="{ background: statusDotColor(row) }"></span>
          <span class="link-filename">{{ row.fileName }}</span>
          <span class="link-spacer"></span>
          <span
            v-tooltip.top="'点击复制链接'"
            class="service-badge"
            @click="handleCopyUrl(row)"
          >
            <span class="badge-icon" v-html="getServiceIcon(row.serviceId)"></span>
            <span class="badge-label">{{ getServiceDisplayName(row.serviceId) }}</span>
          </span>
          <span
            v-if="errorLabel(row)"
            v-tooltip.top="errorTooltip(row)"
            class="error-badge"
            :class="{
              'error-badge--error': !row.checkResult?.error_type || row.checkResult?.error_type === 'http_4xx' || row.checkResult?.error_type === 'http_5xx' || row.checkResult?.error_type === 'network',
              'error-badge--warning': row.checkResult?.error_type === 'timeout',
              'error-badge--suspicious': row.checkResult?.error_type === 'suspicious',
            }"
          >
            {{ errorLabel(row) }}
          </span>
          <button
            class="recheck-btn"
            :class="{ spinning: spinningRowId === row.historyId + row.serviceId }"
            title="重新检测"
            @click.stop="handleRecheck(row)"
          >
            <i class="pi pi-refresh"></i>
          </button>
          <button
            class="delete-btn"
            :disabled="isChecking"
            title="删除此记录"
            @click.stop="emit('delete-row', row)"
          >
            <i class="pi pi-trash"></i>
          </button>
          <span class="row-checkbox" @click.stop>
            <Checkbox
              :model-value="selectedIds.has(row.historyId)"
              :binary="true"
              :disabled="isChecking"
              @update:model-value="toggleSelect(row.historyId)"
            />
          </span>
        </div>
      </div>
    </div>

    <!-- 底部 -->
    <div class="bottom">
      <!-- 极简进度条 -->
      <div
        v-if="isChecking"
        class="progress-bar"
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
        <!-- 选中模式：底栏变为批量操作 -->
        <template v-if="hasSelection && !isChecking">
          <div class="batch-bottom-left">
            <Checkbox
              :model-value="isAllSelected"
              :binary="true"
              :indeterminate="hasSelection && !isAllSelected"
              @update:model-value="toggleSelectAll"
            />
            <span class="batch-count">已选 {{ selectedCount }} 条记录</span>
          </div>
          <div class="batch-bottom-right">
            <button class="btn-danger btn-sm" @click="handleDeleteBatch">
              <i class="pi pi-trash"></i> 删除选中
            </button>
            <button class="btn-ghost btn-sm" @click="clearSelection">
              取消选择
            </button>
          </div>
        </template>

        <!-- 正常模式 -->
        <template v-else>
          <span class="page-summary">{{ bottomSummary }}</span>
          <div v-if="totalPages > 1" class="pagination">
            <button class="page-btn" :disabled="currentPage <= 1" @click="currentPage--">
              <i class="pi pi-chevron-left"></i>
            </button>
            <span class="page-info">
              <input
                class="page-input" type="text"
                :placeholder="String(currentPage)"
                v-model="pageInput"
                @keydown.enter="handlePageInput($event)"
                @blur="handlePageInput($event)"
              />
              / {{ totalPages }}
            </span>
            <button class="page-btn" :disabled="currentPage >= totalPages" @click="currentPage++">
              <i class="pi pi-chevron-right"></i>
            </button>
          </div>
          <div class="bottom-actions" @click.stop>
            <button v-tooltip.top="'扫描 Markdown 文件，替换失效图片链接'" class="btn-ghost" @click="emit('open-md-rescue')">
              <i class="pi pi-file-edit"></i> 文档修复
            </button>
            <button v-tooltip.top="'导出检测结果为 CSV 文件'" class="btn-ghost" @click="emit('export-csv')">
              <i class="pi pi-download"></i> 导出
            </button>
            <span class="action-divider"></span>
            <div v-if="!isChecking" class="check-btn-group" :class="{ 'has-dropdown': showDropdownArrow }">
              <button v-tooltip.top="smartCheckTooltip" class="btn-primary" @click="handleSmartCheck">
                <i class="pi pi-play"></i> {{ smartCheckLabel }}
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
                    <span class="dropdown-label">{{ item.label }}</span>
                    <span class="dropdown-desc">{{ item.desc }}</span>
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
  display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 12px;
  border-radius: 7px; font-size: 12px; font-weight: 500; cursor: pointer;
  white-space: nowrap; transition: background 0.15s, opacity 0.15s; border: none;
}
.btn-ghost { background: var(--bg-input); color: var(--text-muted); }
.btn-ghost:hover { background: var(--hover-overlay); color: var(--text-main); }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { opacity: 0.9; }
.btn-danger { background: var(--error-alpha-15); color: var(--error); border: 1px solid transparent; }
.btn-danger:hover { background: var(--error-alpha-8); border-color: var(--error-alpha-15); box-shadow: none; }

.check-btn-group { display: flex; position: relative; }
.check-btn-group.has-dropdown .btn-primary:first-child { border-radius: 7px 0 0 7px; }
.check-toggle { border-radius: 0 7px 7px 0; padding: 0 7px; border-left: 1px solid rgba(255,255,255,0.2); }
.check-dropdown {
  position: absolute; bottom: calc(100% + 6px); right: 0; min-width: 220px;
  background: var(--bg-card); border-radius: 10px; padding: 4px 0;
  box-shadow: var(--shadow-float); z-index: var(--z-dropdown, 100);
  border: 1px solid var(--border-subtle); overflow: hidden;
}
.check-dropdown-item {
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 14px; cursor: pointer; transition: background 0.1s;
}
.check-dropdown-item:not(:last-child) { border-bottom: 1px solid var(--border-subtle); }
.check-dropdown-item:hover { background: var(--hover-overlay-subtle); }
.dropdown-label { font-size: 13px; font-weight: 500; color: var(--text-main); }
.dropdown-desc { font-size: 11px; color: var(--text-tertiary); }

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
  transition: background 0.15s, color 0.15s, border-color 0.15s;
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
  background: var(--success-alpha-10, rgba(34, 197, 94, 0.1)); color: var(--success); border-color: var(--success-alpha-10, rgba(34, 197, 94, 0.1));
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
  font-size: 11px; color: var(--text-main); font-variant-numeric: tabular-nums;
  background: var(--bg-card); box-shadow: var(--shadow-float);
  border: 1px solid var(--border-subtle); pointer-events: none;
}
.fade-enter-active { transition: opacity 0.15s; }
.fade-leave-active { transition: opacity 0.1s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.progress-bar-inner {
  width: 100%; height: 3px; background: var(--bg-input);
  border-radius: 1.5px; overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), var(--primary-light, #60a5fa));
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative; overflow: hidden;
}
.progress-bar-fill::after {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
  animation: progress-glow 1.5s ease-in-out infinite;
}
@keyframes progress-glow {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
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
  padding: 8px 14px; cursor: pointer; transition: background 0.1s;
}
.service-dropdown-item:hover { background: var(--hover-overlay); }
.service-dropdown-item.active { background: var(--primary-alpha-10); }
.sdi-label { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--text-main); }
.sdi-label .badge-icon { width: 14px; height: 14px; color: var(--text-muted); }
.sdi-count { font-size: 11px; color: var(--text-tertiary); font-family: var(--font-mono, 'JetBrains Mono', monospace); }

/* 搜索框（药片型，与浏览界面对齐） */
.search-field {
  display: flex; align-items: center;
  background: var(--bg-input); border-radius: 16px;
  height: 32px; padding: 0 8px 0 10px;
  min-width: 140px; max-width: 260px; flex: 1;
  border: 1px solid transparent;
  transition: border-color 0.15s, box-shadow 0.15s;
  flex-shrink: 0;
}
.search-field.focused { border-color: var(--primary); }
.search-field-icon {
  color: var(--text-secondary); font-size: 12px; flex-shrink: 0;
  opacity: 0.5; margin-right: 6px; transition: opacity 0.15s, color 0.15s;
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
  transition: all 0.15s; opacity: 0.5;
}
.search-field-clear:hover { color: var(--text-primary); background: var(--hover-overlay); opacity: 1; }

/* ===== 链接列表（单行紧凑） ===== */
.link-list-wrap {
  flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
}
.link-list { flex: 1; overflow-y: auto; }

.link-row {
  display: flex; align-items: center; gap: 10px; padding: 0 16px 0 8px;
  height: 40px;
  border-bottom: 1px solid var(--primary-alpha-5);
  transition: background 0.1s;
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
  transition: background 0.1s;
}
.service-badge:hover { background: var(--primary-alpha-8); }
.badge-icon {
  width: 14px; height: 14px;
  display: inline-flex; flex-shrink: 0;
  color: var(--text-muted);
}
.badge-icon :deep(svg) { width: 100%; height: 100%; }
.badge-label {
  font-size: 11px; font-weight: 500; color: var(--text-muted);
}
/* 错误标签 badge */
.error-badge {
  display: inline-flex; align-items: center;
  padding: 1px 6px; border-radius: 4px;
  font-size: 10px; font-weight: 600;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  flex-shrink: 0; cursor: default;
}
.error-badge--error { background: var(--error-alpha-10); color: var(--error); }
.error-badge--warning { background: var(--warning-alpha-8); color: var(--warning); }
.error-badge--suspicious { background: var(--pending-alpha-8); color: var(--pending); }
.link-spacer { flex: 1; }

/* Checkbox */
.row-checkbox {
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; opacity: 0; transition: opacity 0.15s;
}
.link-row:hover .row-checkbox,
.link-row.has-selection .row-checkbox,
.link-row.row-selected .row-checkbox { opacity: 1; }
.link-row.row-selected { background: var(--primary-alpha-8) !important; }
.link-row.row-selected:hover { background: var(--primary-alpha-12) !important; }

/* 重检 + 删除按钮共用样式 */
.recheck-btn, .delete-btn {
  display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  border: none; border-radius: 5px; background: transparent; color: var(--text-tertiary);
  cursor: pointer; transition: background 0.1s, color 0.1s, opacity 0.15s; font-size: 11px;
  opacity: 0.2; flex-shrink: 0;
}
.link-row:hover .recheck-btn,
.link-row:hover .delete-btn { opacity: 1; }
.recheck-btn:hover { background: var(--primary-alpha-8); color: var(--primary); }
.delete-btn:hover { background: var(--error-alpha-10); color: var(--error); }
.delete-btn:disabled { opacity: 0.1; cursor: default; pointer-events: none; }
.recheck-btn.spinning .pi { animation: spin-once 0.6s ease-out; }
@keyframes spin-once { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* 底栏批量操作模式 */
.batch-bottom-left, .batch-bottom-right { display: flex; align-items: center; gap: 8px; }
.batch-count { font-size: 12px; color: var(--text-muted); font-weight: 500; }
.btn-sm { height: 26px; padding: 0 10px; font-size: 11px; }

/* 下拉动画（复用 settings-shared 定义） */
.dropdown-enter-active, .dropdown-leave-active { transition: all 0.2s ease; }
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
  transition: opacity 0.15s, transform 0.1s;
}
.hero-cta:hover { opacity: 0.9; }
.hero-cta:active { transform: scale(0.97); }
.hero-meta { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }

/* ===== 普通空状态 ===== */
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  flex: 1; color: var(--text-muted);
}
.empty-state i { font-size: 40px; opacity: 0.1; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-main); }
.empty-desc { font-size: 12px; color: var(--text-muted); }

/* ===== 底部 ===== */
.bottom { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; padding-right: 24px; }
.bottom-main {
  display: flex; align-items: center; justify-content: space-between;
}
.page-summary { font-size: 12px; color: var(--text-tertiary); white-space: nowrap; }
.pagination { display: flex; align-items: center; gap: 4px; }
.page-btn {
  display: flex; align-items: center; justify-content: center; width: 26px; height: 26px;
  border: none; border-radius: 5px; background: var(--bg-input); color: var(--text-muted);
  cursor: pointer; transition: background 0.1s, color 0.1s; font-size: 12px;
}
.page-btn:hover:not(:disabled) { background: var(--primary-alpha-8); color: var(--primary); }
.page-btn:disabled { opacity: 0.3; cursor: default; }
.page-info {
  font-size: 11px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;
  display: inline-flex; align-items: center; gap: 4px; margin: 0 4px;
}
.page-input {
  width: 32px; height: 22px; text-align: center; border: 1px solid var(--border-subtle);
  border-radius: 4px; background: transparent; color: var(--text-main); font-size: 11px;
  font-family: 'JetBrains Mono', monospace; outline: none;
}
.page-input::placeholder { color: var(--text-muted); }
.page-input:focus { border-color: var(--primary); }

</style>
