<script setup lang="ts">
import { rowKey } from '@/composables/link-check/useCheckFilter';
import type { CheckStatsResult } from '@/composables/link-check/useCheckStats';
import type { CopyHint } from '@/composables/link-check/rowCopies';
import type { LinkCheckRow, StatusFilter } from '@/types/linkCheck';
import EmptyState from '@/components/common/EmptyState.vue';
import CheckLinkRow from './CheckLinkRow.vue';

const PROBLEM_FILTERS = new Set<StatusFilter>(['problems', 'invalid', 'timeout', 'suspicious']);

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
  rowThumbSrcs: (row: LinkCheckRow) => string[];
  rowHint: (row: LinkCheckRow) => CopyHint | null;
  confirmedHttpHosts?: ReadonlySet<string>;
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

    <div v-else-if="stats.total > 0 && stats.checked === 0 && filteredRows.length === 0 && !isChecking" class="empty-state-wrapper">
      <EmptyState
        icon="pi pi-shield"
        title="检查你的图片链接"
        description="扫描全部上传历史，发现失效和异常链接"
      />
    </div>

    <div
      v-else-if="filteredRows.length === 0 && !isChecking && stats.checked > 0 && stats.problems === 0 && PROBLEM_FILTERS.has(statusFilter)"
      class="empty-state-wrapper"
    >
      <EmptyState
        icon="pi pi-verified"
        title="没有发现问题"
        :description="stats.unchecked > 0
          ? `已检测的 ${stats.checked.toLocaleString()} 条链接都能正常访问，还有 ${stats.unchecked.toLocaleString()} 条未检测`
          : `全部 ${stats.checked.toLocaleString()} 条链接都能正常访问`"
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
        description="尚无上传历史记录"
      />
    </div>

    <TransitionGroup
      v-else
      tag="div"
      :name="suppressListMotion ? 'row-list-silent' : 'row-list'"
      class="link-list"
    >
      <CheckLinkRow
        v-for="row in visibleRows"
        :key="rowKey(row)"
        :row="row"
        :selected="selectedIds.has(rowKey(row))"
        :disabled="isChecking || isActionLocked"
        :copied="copiedKey === `link-check:${rowKey(row)}`"
        :fading="!suppressListMotion && !!row.fadingOut"
        :leaving="!suppressListMotion && statusFilter === 'unchecked' && row.uncheckedLeavingAt !== undefined"
        :thumb-srcs="rowThumbSrcs(row)"
        :hint="rowHint(row)"
        :confirmed-http-hosts="confirmedHttpHosts"
        @toggle-select="(event: MouseEvent) => emit('toggle-select', rowKey(row), event)"
        @copy-url="emit('copy-url', row)"
        @recheck="emit('recheck-single', row)"
        @delete="emit('delete-row', row)"
      />
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
  position: relative;
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

/* TransitionGroup 行进出动画
 *
 * 设计意图：批量检测时已完成的行 hold 约 2s 后从「未检测」tab 淡出，目标 tab 立即淡入。
 * 「未检测」离场先由行内 .leaving-unchecked 在原布局流里淡出并收起高度，再真正移出列表；
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
