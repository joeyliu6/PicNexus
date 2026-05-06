<script setup lang="ts">
import { rowKey } from '../../../../composables/link-check/useCheckFilter';
import type { CheckStatsResult } from '../../../../composables/link-check/useCheckStats';
import type { CheckLinkResult, LinkCheckRow, StatusFilter } from '../../../../types/linkCheck';
import { getServiceDisplayName } from '../../../../constants/serviceNames';
import { getServiceIcon } from '../../../../utils/icons';
import EmptyState from '../../../common/EmptyState.vue';

defineProps<{
  visibleRows: LinkCheckRow[];
  filteredRows: LinkCheckRow[];
  stats: CheckStatsResult;
  statusFilter: StatusFilter;
  isLoading: boolean;
  loadError?: string | null;
  isChecking: boolean;
  isActionLocked: boolean;
  suppressListMotion: boolean;
  selectedIds: Set<string>;
  copiedKey?: string | null;
  statusDotColor: (row: LinkCheckRow) => string;
  errorBadgeClass: (row: LinkCheckRow) => string;
  errorLabel: (row: LinkCheckRow) => string;
  errorTooltip: (row: LinkCheckRow) => string;
  recheckLabel: (result: CheckLinkResult) => string;
}>();

const emit = defineEmits<{
  (e: 'toggle-select', key: string, event: MouseEvent): void;
  (e: 'copy-url', row: LinkCheckRow): void;
  (e: 'recheck-single', row: LinkCheckRow): void;
  (e: 'delete-row', row: LinkCheckRow): void;
}>();
</script>

<template>
  <div class="link-list-wrap">
    <div v-if="loadError && stats.total === 0" class="empty-state-wrapper">
      <EmptyState
        icon="pi pi-exclamation-triangle"
        title="加载失败"
        :description="loadError"
      />
    </div>

    <div v-else-if="stats.total > 0 && stats.checked === 0 && !isChecking" class="empty-state-wrapper">
      <EmptyState
        icon="pi pi-shield"
        title="检查你的图片链接"
        description="扫描全部上传历史，发现失效和异常链接"
      />
    </div>

    <div
      v-else-if="filteredRows.length === 0 && (stats.checked > 0 || isChecking || stats.total > 0)"
      class="empty-state-wrapper"
    >
      <EmptyState
        icon="pi pi-check-circle"
        title="当前筛选暂无结果"
        description="试试切换状态或图床筛选。"
      />
    </div>

    <div v-else-if="stats.total === 0 && !isLoading" class="empty-state-wrapper">
      <EmptyState
        icon="pi pi-inbox"
        title="暂无数据"
        description="尚无上传历史记录。"
      />
    </div>

    <TransitionGroup
      v-else
      tag="div"
      :name="suppressListMotion ? 'row-list-silent' : 'row-list'"
      class="link-list"
    >
      <div
        v-for="row in visibleRows"
        :key="rowKey(row)"
        class="link-row"
        :class="{
          'row-selected': selectedIds.has(rowKey(row)),
          'fading-out': !suppressListMotion && row.fadingOut,
          'leaving-unchecked': !suppressListMotion && statusFilter === 'unchecked' && row.uncheckedLeavingAt !== undefined,
        }"
        @click="!(isChecking || isActionLocked) && emit('toggle-select', rowKey(row), $event)"
      >
        <span class="status-dot" :style="{ background: statusDotColor(row) }"></span>
        <span class="link-filename" :class="{ 'filename-selected': selectedIds.has(rowKey(row)) }">
          {{ row.fileName }}
        </span>
        <span class="link-spacer"></span>

        <span
          v-tooltip.top="copiedKey === `link-check:${rowKey(row)}` ? '已复制' : '点击复制链接'"
          class="service-badge"
          :class="{ 'is-copied': copiedKey === `link-check:${rowKey(row)}` }"
          @click.stop="emit('copy-url', row)"
        >
          <i
            v-if="copiedKey === `link-check:${rowKey(row)}`"
            class="pi pi-check badge-icon copied-check"
            aria-hidden="true"
          ></i>
          <span v-else class="badge-icon" v-html="getServiceIcon(row.serviceId)"></span>
          <span class="badge-label">{{ getServiceDisplayName(row.serviceId) }}</span>
        </span>

        <span v-tooltip.top="errorTooltip(row)" class="error-badge" :class="errorBadgeClass(row)">
          {{ errorLabel(row) }}
        </span>

        <div class="row-actions">
          <div class="recheck-slot">
            <span
              v-if="row.recheckResult"
              class="recheck-result-badge"
              :class="{
                'badge-fading': row.recheckBadgeFading,
                'badge-valid': row.recheckResult.is_valid,
                'badge-suspicious': row.recheckResult.error_type === 'suspicious' || row.recheckResult.browser_might_work,
                'badge-timeout': row.recheckResult.error_type === 'timeout',
                'badge-invalid': !row.recheckResult.is_valid
                  && row.recheckResult.error_type !== 'timeout'
                  && row.recheckResult.error_type !== 'suspicious'
                  && !row.recheckResult.browser_might_work,
              }"
            >
              {{ recheckLabel(row.recheckResult) }}
            </span>

            <button
              v-else
              class="recheck-btn"
              :class="{ spinning: row.recheckLoading }"
              :disabled="isChecking || isActionLocked"
              v-tooltip.top="'重新检测'"
              @click.stop="emit('recheck-single', row)"
            >
              <i class="pi pi-refresh"></i>
            </button>
          </div>

          <button
            class="delete-btn"
            :disabled="isChecking || isActionLocked"
            v-tooltip.top="'删除此链接'"
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
.link-list-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.link-list {
  flex: 1;
  overflow-y: auto;
}

.empty-state-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(
    calc(var(--link-check-empty-center-shift-x, 40px) * -1),
    calc(var(--link-check-empty-center-shift-y, 40px) * -1)
  );
}

.link-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 11px left inset aligns with existing monitor rows */
  padding: 0 var(--space-lg) 0 11px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 40px row height preserves one-line dense list rhythm */
  height: 40px;
  cursor: pointer;
  border-bottom: 1px solid var(--primary-alpha-5);
  transition: background var(--duration-micro);
}

.link-row:last-child {
  border-bottom: none;
}

.link-row:hover {
  background: var(--hover-overlay-subtle);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.link-filename {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
}

.service-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-sm);
  border-radius: var(--space-xs);
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--duration-micro), color var(--duration-fast);
}

.service-badge:hover {
  background: var(--primary-alpha-8);
}

.service-badge.is-copied {
  background: var(--success-alpha-10);
  color: var(--success);
}

.service-badge.is-copied:hover {
  background: var(--success-alpha-15);
}

.badge-icon {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-muted);
}

.service-badge.is-copied .badge-icon,
.copied-check {
  color: var(--success);
}

.copied-check {
  font-size: var(--text-xs);
}

.badge-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.badge-label {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-muted);
}

.service-badge.is-copied .badge-label {
  color: var(--success);
}

.error-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1px vertical inset keeps compact status badge */
  padding: 1px var(--space-xs-sm);
  border-radius: var(--space-xs);
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  flex-shrink: 0;
  cursor: default;
}

.error-badge--success {
  background: var(--success-alpha-10);
  color: var(--success);
}

.error-badge--unchecked {
  background: var(--hover-overlay-subtle);
  color: var(--text-tertiary);
}

.error-badge--error {
  background: var(--error-alpha-10);
  color: var(--error);
}

.error-badge--warning {
  background: var(--warning-alpha-8);
  color: var(--warning);
}

.error-badge--suspicious {
  background: var(--pending-alpha-8);
  color: var(--pending);
}

.link-spacer {
  flex: 1;
}

.link-filename.filename-selected {
  color: var(--primary);
  font-weight: var(--weight-semibold);
}

.link-row.row-selected {
  background: var(--primary-alpha-8) !important;
}

.link-row.row-selected:hover {
  background: var(--primary-alpha-12) !important;
}

.recheck-btn,
.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px icon-button radius matches existing row actions */
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--duration-micro), color var(--duration-micro), opacity var(--duration-fast);
  font-size: var(--text-xs);
  flex-shrink: 0;
  opacity: 1;
}

.recheck-btn:hover:not(:disabled) {
  background: var(--primary-alpha-8);
  color: var(--primary);
}

.delete-btn:hover:not(:disabled) {
  background: var(--error-alpha-10);
  color: var(--error);
}

.recheck-btn:disabled,
.delete-btn:disabled {
  opacity: 0.12;
  cursor: default;
  pointer-events: none;
}

.link-row.fading-out {
  opacity: 0;
  height: 0 !important;
  border-bottom-width: 0 !important;
  overflow: hidden;
  transition: opacity var(--duration-medium) ease, height var(--duration-slow) ease, border-bottom-width var(--duration-normal) ease;
  pointer-events: none;
}

.link-row.leaving-unchecked {
  opacity: 0;
  height: 0 !important;
  border-bottom-width: 0 !important;
  overflow: hidden;
  pointer-events: none;
  will-change: opacity, height;
  transition:
    opacity var(--duration-medium) var(--ease-standard),
    height var(--duration-slow) var(--ease-standard) var(--duration-fast),
    border-bottom-width var(--duration-normal) var(--ease-standard) var(--duration-fast);
}

.recheck-btn.spinning .pi {
  width: 12px;
  height: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.recheck-btn.spinning .pi::before {
  content: '';
  display: block;
  width: 12px;
  height: 12px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1.5px spinner stroke has no exact token */
  border: 1.5px solid currentcolor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: k-spin var(--duration-spinner) linear infinite;
  flex-shrink: 0;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

.recheck-slot {
  width: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.link-row:not(:hover) .row-actions {
  opacity: 0.2;
}

.link-row:hover .row-actions {
  opacity: 1;
}

.row-actions:has(.recheck-result-badge) {
  opacity: 1 !important;
}

.recheck-result-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 20px;
  border-radius: var(--radius-sm);
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.02em;
  flex-shrink: 0;
  cursor: default;
  opacity: 1;
  transition: opacity var(--duration-medium) ease;
}

.recheck-result-badge.badge-fading {
  opacity: 0;
}

.recheck-result-badge.badge-valid {
  background: var(--success-alpha-15);
  color: var(--success);
}

.recheck-result-badge.badge-invalid {
  background: var(--error-alpha-10);
  color: var(--error);
}

.recheck-result-badge.badge-timeout {
  background: var(--warning-alpha-8);
  color: var(--warning);
}

.recheck-result-badge.badge-suspicious {
  background: var(--pending-alpha-8);
  color: var(--pending);
}

/* TransitionGroup 行进出动画
 *
 * 设计意图：批量检测时已完成的行 hold 约 2s 后从「未检测」tab 淡出，目标 tab 立即淡入。
 * 「未检测」离场先由 .leaving-unchecked 在原布局流里淡出并收起高度，再真正移出列表；
 * 高速场景会自然按 sweep 批量收起，避免下方行被每条结果单独顶动。
 */
.row-list-enter-active,
.row-list-leave-active {
  transition: opacity var(--duration-medium) var(--ease-standard);
}

.row-list-enter-from,
.row-list-leave-to {
  opacity: 0;
}

.row-list-leave-active {
  position: absolute;

  /* 离开期间宽度撑满容器，避免脱离文档流后视觉宽度塌缩 */
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 100% in absolute keeps row width visually intact while leaving layout flow */
  width: 100%;
}

/* move 过渡：行因离开/重排被推上去时也要平滑滑动而非瞬间跳 */
.row-list-move {
  transition: transform var(--duration-medium) var(--ease-standard);
}
</style>
