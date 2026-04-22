<script setup lang="ts">
/**
 * 批量迁移 · 统一条目行
 *
 * 两行紧凑布局（已去除完整 URL 行）：
 * - 第一行：文件名 + 状态 chip（失败 chip 的 tooltip 展示错误详情）
 * - 第二行：存在于 [已有图床 chips] → [本次迁移 target chips，按成功/失败/进行中分色]
 *          右侧按状态切换操作按钮：
 *            · 已完成 → 复制新 URL
 *            · 已完成（done 态）+ 失败 → 重试
 *            · 其他 → 无按钮
 */
import { computed } from 'vue';
import type { MigrateFailureDetail, MigrateItemStatus } from '../../../../../types/batchMigrate';
import { errorTooltipText } from '../composables/useErrorPresentation';
import MigrateStatusChip from './chips/MigrateStatusChip.vue';
import MigrateServiceChip from './chips/MigrateServiceChip.vue';

/** DoneRow 旧签名的兼容型——让导出/终态快照仍然可以传入不是完整 MigrateItemStatus 的对象 */
export interface MigrateRowItem {
  historyId?: string;
  fileName: string;
  sourceUrl?: string;
  status: MigrateItemStatus['status'];
  errorType?: 'download' | 'upload';
  convertedFormat?: string;
  error?: string;
  details?: MigrateFailureDetail[];
  existingServiceIds?: string[];
  serviceResults?: Record<string, 'pending' | 'success' | 'failed'>;
}

interface Props {
  item: MigrateRowItem;
  /** 本批次选定的目标图床 ID 列表（用于无 serviceResults 时的回退渲染） */
  targetServiceIds?: string[];
  /** 是否显示重试按钮（仅 failed 行） */
  showRetry?: boolean;
  /** 正在重试中（由父组件的 retryingIds 决定） */
  retrying?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  targetServiceIds: () => [],
  showRetry: false,
  retrying: false,
});

const emit = defineEmits<{
  retry: [historyId: string];
  copyUrl: [historyId: string];
}>();

const isActive = computed(() =>
  props.item.status === 'downloading'
    || props.item.status === 'converting'
    || props.item.status === 'uploading',
);

const isFailed = computed(() => props.item.status === 'failed');
const isSuccess = computed(() => props.item.status === 'success');

/** 已存在的图床列表 —— 迁移前的快照 */
const existingChips = computed(() => props.item.existingServiceIds ?? []);

/** 本次迁移涉及的 target 列表 + 各自的实际状态 */
interface TargetChipState {
  serviceId: string;
  variant: 'pending' | 'new' | 'failed';
}

const targetChips = computed<TargetChipState[]>(() => {
  const existing = new Set(existingChips.value);
  const results = props.item.serviceResults;
  const ids = results ? Object.keys(results) : props.targetServiceIds;

  return ids
    .filter(sid => !existing.has(sid))
    .map(sid => {
      const state = results?.[sid];
      let variant: TargetChipState['variant'];
      if (state === 'success') variant = 'new';
      else if (state === 'failed') variant = 'failed';
      else variant = 'pending';
      return { serviceId: sid, variant };
    });
});

const hasTargets = computed(() => targetChips.value.length > 0);

/** 失败态 tooltip：错误详情 */
const failedTooltip = computed(() => {
  if (!isFailed.value) return '';
  return errorTooltipText(props.item);
});

/** 已完成项用于「复制新 URL」的数据：本次新增的第一个成功 target */
const newlyAddedTargetId = computed<string | null>(() => {
  const t = targetChips.value.find(c => c.variant === 'new');
  return t?.serviceId ?? null;
});

function onRetry() {
  if (props.item.historyId) emit('retry', props.item.historyId);
}

function onCopyUrl() {
  if (props.item.historyId) emit('copyUrl', props.item.historyId);
}
</script>

<template>
  <div
    class="mi-row"
    :class="{
      'mi-row--active': isActive,
      'mi-row--failed': isFailed,
      'mi-row--success': isSuccess,
      'mi-row--retrying': retrying,
    }"
  >
    <div class="mi-row__line mi-row__line--head">
      <span
        class="mi-row__name"
        v-tooltip.top="item.sourceUrl || item.fileName"
      >{{ item.fileName }}</span>
      <MigrateStatusChip
        :item="item"
        v-tooltip.top="failedTooltip ? { value: failedTooltip, autoHide: false } : undefined"
      />
    </div>

    <div class="mi-row__line mi-row__line--services">
      <span class="mi-row__label">存在于</span>
      <template v-if="existingChips.length > 0">
        <MigrateServiceChip
          v-for="sid in existingChips"
          :key="`e-${sid}`"
          :service-id="sid"
          variant="existing"
        />
      </template>
      <span v-else class="mi-row__muted">无记录</span>

      <template v-if="hasTargets">
        <i
          class="pi mi-row__arrow"
          :class="isFailed ? 'pi-times' : 'pi-arrow-right'"
          aria-hidden="true"
        />
        <MigrateServiceChip
          v-for="t in targetChips"
          :key="`t-${t.serviceId}`"
          :service-id="t.serviceId"
          :variant="t.variant"
        />
      </template>

      <span class="mi-row__spacer" />

      <template v-if="isSuccess && newlyAddedTargetId">
        <button
          class="mi-row__action"
          type="button"
          @click="onCopyUrl"
          v-tooltip.top="'复制新图床 URL'"
        >
          <i class="pi pi-copy" /> 复制新 URL
        </button>
      </template>

      <template v-if="showRetry && item.historyId">
        <span v-if="retrying" class="mi-row__retrying">
          <i class="pi pi-spin pi-spinner" /> 重试中
        </span>
        <button
          v-else
          class="mi-row__action mi-row__action--retry"
          type="button"
          @click="onRetry"
        >
          <i class="pi pi-refresh" /> 重试
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mi-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs-sm);
  padding: var(--space-sm-md) var(--space-md);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  transition:
    background var(--duration-fast),
    border-color var(--duration-fast),
    opacity var(--duration-fast);
}
.mi-row:hover { background: var(--hover-overlay-subtle); }
.mi-row--retrying { opacity: 0.6; }

/* 处理中：主色淡背景 + 蓝边 */
.mi-row--active {
  background: var(--primary-alpha-8);
  border-color: var(--primary-alpha-15);
}

/* 失败：整卡浅红底 + 红边 */
.mi-row--failed {
  background: var(--error-alpha-8);
  border-color: var(--error-alpha-15);
}

.mi-row__line {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}
.mi-row__line--head { gap: var(--space-sm-md); }

.mi-row__name {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono, monospace);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: help;
}

.mi-row__line--services {
  padding-left: var(--space-xs-sm);
  font-size: var(--text-xs);
  color: var(--text-muted);
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.mi-row__label {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  flex-shrink: 0;
}

.mi-row__muted {
  color: var(--text-tertiary);
  font-style: italic;
}

.mi-row__arrow {
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  margin: 0 var(--space-2xs);
}
.mi-row--failed .mi-row__arrow { color: var(--error); }

.mi-row__spacer { flex: 1; }

.mi-row__action {
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
.mi-row__action:hover { background: var(--hover-overlay); }
.mi-row__action i { font-size: var(--text-2xs); }

.mi-row__action--retry {
  background: var(--error);
  color: var(--text-on-error);
  border-color: transparent;
}

.mi-row__action--retry:hover {
  background: color-mix(in srgb, var(--error) 85%, black);
}

.mi-row__retrying {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  color: var(--primary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  flex-shrink: 0;
}
</style>
