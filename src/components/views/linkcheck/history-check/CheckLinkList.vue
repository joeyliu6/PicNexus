<script setup lang="ts">
/**
 * CheckLinkList — 链接监控面板的列表区
 * 骨架屏 / Hero 空状态 / 筛选空 / 无数据 / 行列表
 * 从 HistoryCheckPanel.vue 抽出，行状态与展示函数由父级传入
 */
import Skeleton from 'primevue/skeleton';
import EmptyState from '../../../common/EmptyState.vue';
import HeroEmptyState from '../../../common/HeroEmptyState.vue';
import { getServiceIcon } from '../../../../utils/icons';
import { getServiceDisplayName } from '../../../../constants/serviceNames';
import type { LinkCheckRow, CheckLinkResult } from '../../../../types/linkCheck';
import type { CheckStatsResult } from '../../../../composables/link-check/useCheckStats';

defineProps<{
  visibleRows: LinkCheckRow[];
  filteredRows: LinkCheckRow[];
  stats: CheckStatsResult;
  isLoading: boolean;
  isChecking: boolean;
  selectedIds: Set<string>;
  statusDotColor: (row: LinkCheckRow) => string;
  errorBadgeClass: (row: LinkCheckRow) => string;
  errorLabel: (row: LinkCheckRow) => string;
  errorTooltip: (row: LinkCheckRow) => string;
  recheckLabel: (result: CheckLinkResult) => string;
}>();

const emit = defineEmits<{
  (e: 'toggle-select', id: string): void;
  (e: 'check-all'): void;
  (e: 'copy-url', row: LinkCheckRow): void;
  (e: 'recheck-single', row: LinkCheckRow): void;
  (e: 'delete-row', row: LinkCheckRow): void;
}>();
</script>

<template>
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
    <HeroEmptyState
      v-else-if="stats.total > 0 && stats.checked === 0 && !isChecking"
      icon="pi pi-shield"
      title="检查你的图片链接"
      description="扫描全部上传历史，发现失效和异常链接"
      :metaText="`共 ${stats.total.toLocaleString()} 个链接待检测`"
    >
      <button class="hero-cta" @click="emit('check-all')">
        <i class="pi pi-play"></i> 开始全面检测
      </button>
    </HeroEmptyState>

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
      icon="pi pi-inbox"
      title="暂无数据"
      description="尚无上传历史记录"
    />

    <TransitionGroup v-else tag="div" name="row-list" class="link-list">
      <div
        v-for="row in visibleRows" :key="row.historyId + row.serviceId"
        class="link-row" :class="{ 'row-selected': selectedIds.has(row.historyId), 'fading-out': row.fadingOut }"
        @click="!isChecking && emit('toggle-select', row.historyId)"
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
          @click.stop="emit('copy-url', row)"
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
              @click.stop="emit('recheck-single', row)"
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
</template>

<style scoped>
/* ===== 链接列表（单行紧凑） ===== */
.link-list-wrap {
  flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
}
.link-list { flex: 1; overflow-y: auto; }

.link-row {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 11px 无精确 spacing token */
  display: flex; align-items: center; gap: var(--space-sm-md); padding: 0 var(--space-lg) 0 11px;
  height: 40px; cursor: pointer;
  border-bottom: 1px solid var(--primary-alpha-5);
  transition: background var(--duration-micro);
}
.skeleton-row { pointer-events: none; }
.link-row:last-child { border-bottom: none; }
.link-row:hover { background: var(--hover-overlay-subtle); }

.status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

.link-filename {
  font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-main);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex-shrink: 1; min-width: 0;
}

/* 图床图标 badge */
.service-badge {
  display: inline-flex; align-items: center; gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-sm); border-radius: var(--space-xs);
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
  font-size: var(--text-xs); font-weight: var(--weight-medium); color: var(--text-muted);
}

/* 错误标签 badge */
.error-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 36px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1px 为微间距，无 spacing token */
  padding: 1px var(--space-xs-sm); border-radius: var(--space-xs);
  font-size: var(--text-2xs); font-weight: var(--weight-semibold);
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
  font-weight: var(--weight-semibold);
}
.link-row.row-selected { background: var(--primary-alpha-8) !important; }
.link-row.row-selected:hover { background: var(--primary-alpha-12) !important; }

/* 重检 + 删除按钮共用样式 */
.recheck-btn, .delete-btn {
  display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px 无精确 radius token */
  border: none; border-radius: 5px; background: transparent; color: var(--text-tertiary);
  cursor: pointer; transition: background var(--duration-micro), color var(--duration-micro); font-size: var(--text-xs);
  flex-shrink: 0;
}

/* recheck-btn / delete-btn 透明度由父级 row-actions 统一控制 */
/* stylelint-disable-next-line no-duplicate-selectors -- 与上方选择器逻辑分离，hover 态独立声明 */
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
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1.5px 为 spinner 描边粗细 */
  border: 1.5px solid currentcolor;
  border-top-color: transparent;
  border-radius: 50%;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 0.7s 为 spinner 旋转周期，无 duration token */
  animation: k-spin 0.7s linear infinite;
  flex-shrink: 0;
}

/* 右侧操作区：recheck + delete 整体收紧 */
.row-actions {
  display: flex; align-items: center; gap: var(--space-xs); flex-shrink: 0;
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
  width: 36px; height: 20px; border-radius: var(--radius-sm);
  font-size: var(--text-2xs); font-weight: var(--weight-semibold); letter-spacing: 0.02em;
  flex-shrink: 0; cursor: default;
  opacity: 1; transition: opacity var(--duration-medium) ease;
}
.recheck-result-badge.badge-fading     { opacity: 0; }
/* stylelint-disable-next-line declaration-property-value-disallowed-list -- fallback 颜色用于 CSS 变量未定义时 */
.recheck-result-badge.badge-valid      { background: var(--success-alpha-15, rgb(34 197 94 / 15%)); color: var(--success, #22c55e); }
.recheck-result-badge.badge-invalid    { background: var(--error-alpha-10); color: var(--error); }
.recheck-result-badge.badge-timeout    { background: var(--warning-alpha-8); color: var(--warning); }
.recheck-result-badge.badge-suspicious { background: var(--pending-alpha-8); color: var(--pending); }

/* 行入场动画（leave 由 fadingOut class 自行处理，此处只定义 enter） */
.row-list-enter-active {
  transition: opacity var(--duration-normal) ease, transform var(--duration-normal) ease;
}

.row-list-enter-from {
  opacity: 0;
  transform: translateY(-5px);
}

/* ===== Hero CTA 按钮样式 ===== */
.hero-cta {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 7px 无精确 spacing token */
  display: inline-flex; align-items: center; gap: 7px;
  padding: var(--space-sm-md) var(--space-xl); margin-top: var(--space-sm);
  background: var(--primary); color: var(--text-on-primary); border: none; border-radius: var(--radius-lg);
  font-size: var(--text-base); font-weight: var(--weight-semibold); cursor: pointer;
  transition: opacity var(--duration-fast), transform var(--duration-micro);
}
.hero-cta:hover { opacity: 0.9; }
.hero-cta:active { transform: scale(0.97); }
</style>
