<script setup lang="ts">
/**
 * 批量迁移 · 终态行（已完成/已跳过/失败共用）
 *
 * 两行紧凑布局：
 * - 第一行：文件名 + 状态 chip + （可选）重试按钮
 * - 第二行：源服务 chips → 目标服务 chips + （可选）错误信息 ⓘ
 *
 * 失败行通过 showRetry + errorDetails 展现差异。
 */
import { computed } from 'vue';
import type { MigrateFailureDetail, MigrateItemStatus } from '../../../../../types/batchMigrate';
import { primaryReason, errorTooltipText } from '../composables/useErrorPresentation';
import MigrateStatusChip from './chips/MigrateStatusChip.vue';
import MigrateServiceChipGroup from './chips/MigrateServiceChipGroup.vue';

export interface DoneRowItem {
  historyId?: string;
  fileName: string;
  status: MigrateItemStatus['status'];
  errorType?: 'download' | 'upload';
  convertedFormat?: string;
  error?: string;
  details?: MigrateFailureDetail[];
}

interface Props {
  item: DoneRowItem;
  sourceServiceIds?: string[];
  targetServiceIds?: string[];
  /** 是否渲染重试按钮（仅失败行） */
  showRetry?: boolean;
  /** 正在重试（由父组件的 retryingIds 集合决定） */
  retrying?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  sourceServiceIds: () => [],
  targetServiceIds: () => [],
  showRetry: false,
  retrying: false,
});

const emit = defineEmits<{ retry: [historyId: string] }>();

const hasError = computed(() =>
  props.item.status === 'failed' && (
    (props.item.details && props.item.details.length > 0) ||
    !!props.item.error
  ),
);
const reasonText = computed(() => hasError.value ? primaryReason(props.item) : '');
const tooltipText = computed(() => hasError.value ? errorTooltipText(props.item) : '');

function onRetry() {
  if (props.item.historyId) emit('retry', props.item.historyId);
}
</script>

<template>
  <div
    class="m-done-row"
    :class="{
      'm-done-row--retrying': retrying,
      'm-done-row--failed': item.status === 'failed',
    }"
  >
    <div class="m-done-row__line m-done-row__line--head">
      <span class="m-done-row__name">{{ item.fileName }}</span>
      <MigrateStatusChip :item="item" dense />
      <template v-if="showRetry && item.historyId">
        <span v-if="retrying" class="m-done-row__retrying">
          <i class="pi pi-spin pi-spinner" /> 重试中
        </span>
        <button
          v-else
          class="m-done-row__retry-btn"
          type="button"
          @click="onRetry"
        >
          <i class="pi pi-refresh" /> 重试
        </button>
      </template>
    </div>

    <div class="m-done-row__line m-done-row__line--services">
      <MigrateServiceChipGroup
        v-if="sourceServiceIds.length > 0"
        :services="sourceServiceIds"
        variant="source"
      />
      <i
        v-if="sourceServiceIds.length > 0 && targetServiceIds.length > 0"
        class="pi pi-arrow-right m-done-row__arrow"
        aria-hidden="true"
      />
      <MigrateServiceChipGroup
        v-if="targetServiceIds.length > 0"
        :services="targetServiceIds"
        variant="target"
      />
      <span v-if="hasError" class="m-done-row__error">
        <span class="m-done-row__error-label">{{ reasonText }}</span>
        <i
          class="pi pi-info-circle m-done-row__info"
          v-tooltip.top="{ value: tooltipText, autoHide: false }"
          aria-label="查看原始错误信息"
        />
      </span>
    </div>
  </div>
</template>

<style scoped>
.m-done-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  padding: var(--space-sm-md) var(--space-md);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  transition:
    background var(--duration-fast),
    border-color var(--duration-fast),
    opacity var(--duration-fast);
}
.m-done-row:hover { background: var(--hover-overlay-subtle); }
.m-done-row--retrying { opacity: 0.6; }

/* 失败行：淡红边框强化视觉线索（同时不破坏列表节奏） */
.m-done-row--failed {
  border-color: var(--error-alpha-15);
}

.m-done-row__line {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}
.m-done-row__line--head { gap: var(--space-sm-md); }

.m-done-row__name {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono, monospace);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.m-done-row__retry-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  border: 1px solid transparent;
  color: var(--text-main);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--duration-fast);
}
.m-done-row__retry-btn:hover { background: var(--hover-overlay); }
.m-done-row__retry-btn i { font-size: var(--text-2xs); }

.m-done-row__retrying {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  color: var(--primary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  flex-shrink: 0;
}

.m-done-row__line--services {
  padding-left: var(--space-xs-sm);
  font-size: var(--text-xs);
  color: var(--text-muted);
  flex-wrap: wrap;
}

.m-done-row__arrow {
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
}

.m-done-row__error {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  margin-left: var(--space-sm);
  min-width: 0;
}

.m-done-row__error-label {
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.m-done-row__info {
  color: var(--text-tertiary);
  cursor: help;
  flex-shrink: 0;
  font-size: var(--text-xs);
  transition: color var(--duration-fast);
}
.m-done-row__info:hover { color: var(--text-muted); }
</style>
