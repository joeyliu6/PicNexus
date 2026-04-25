<script setup lang="ts">
/**
 * 批量迁移 · 统一条目行（单行链接监控风格）
 *
 * 布局：[6px 圆点] [filename 省略号] [spacer] [existing chips » target chips] [重试按钮 · 仅失败+done]
 * - 圆点颜色：pending 灰 / active 蓝 / success 绿 / failed 红 / skipped 黄
 * - 错误信息改为悬停红点的 tooltip（useErrorPresentation 已提供）
 * - 复制 URL 入口下沉到可点击的服务徽章，单条重试用缩小版 24px 图标按钮
 */
import { computed } from 'vue';
import { errorTooltipText } from '../composables/useErrorPresentation';
import { getServiceDisplayName } from '../../../../../constants/serviceNames';
import MigrateServiceChip from './chips/MigrateServiceChip.vue';
import type { MigrateRowItem } from './migrateRowTypes';

const TERMINAL_STATUSES = new Set(['success', 'failed', 'skipped']);

const VISIBLE_EXISTING_MAX = 3;

interface Props {
  item: MigrateRowItem;
  targetServiceIds?: string[];
  showRetry?: boolean;
  retrying?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  targetServiceIds: () => [],
  showRetry: false,
  retrying: false,
});

const emit = defineEmits<{
  retry: [historyId: string];
  copyUrl: [historyId: string, serviceId: string];
}>();

const isActive = computed(() =>
  props.item.status === 'downloading'
    || props.item.status === 'converting'
    || props.item.status === 'uploading',
);
const isFailed = computed(() => props.item.status === 'failed');

const existingChips = computed(() => props.item.existingServiceIds ?? []);
const visibleExistingChips = computed(() => existingChips.value.slice(0, VISIBLE_EXISTING_MAX));
const overflowExistingChips = computed(() => existingChips.value.slice(VISIBLE_EXISTING_MAX));
const overflowTooltip = computed(() =>
  overflowExistingChips.value.map(sid => getServiceDisplayName(sid) || sid).join('、'),
);

/**
 * 用户本次勾选但图本来就在的"被跳过目标"——代码里 targetChips 已被 filter 掉，
 * 这里反向标注到 existing 上，让 existing 图标右上角出小角标告知用户"你选了它但已在"
 */
const alsoTargetSet = computed(() => {
  const targetSet = new Set(props.targetServiceIds);
  return new Set(existingChips.value.filter(sid => targetSet.has(sid)));
});

interface TargetChipState {
  serviceId: string;
  variant: 'pending' | 'new' | 'failed';
}

const targetChips = computed<TargetChipState[]>(() => {
  const existing = new Set(existingChips.value);
  const results = props.item.serviceResults;
  // 始终以 targetServiceIds 为准：选了几个目标就显几个 chip
  // 如果没有 targetServiceIds（fallback），退回读 serviceResults 的 key
  const ids = props.targetServiceIds.length > 0
    ? props.targetServiceIds
    : (results ? Object.keys(results) : []);

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
const hasServices = computed(() => existingChips.value.length > 0 || hasTargets.value);

/** 失败行 tooltip：挂在红点上 */
const failedTooltip = computed(() => {
  if (!isFailed.value) return '';
  return errorTooltipText(props.item);
});

/** 圆点颜色：沿用链接监控 statusDotColor 的 CSS 变量模式 */
const dotColor = computed(() => {
  switch (props.item.status) {
    case 'downloading':
    case 'converting':
    case 'uploading':
      return 'var(--primary)';
    case 'success':
      return 'var(--success)';
    case 'failed':
      return 'var(--error)';
    case 'skipped':
      return 'var(--warning)';
    default:
      return 'var(--text-tertiary)';
  }
});

/**
 * 目标 chip 状态说明 tooltip：
 * - new（可点击）→ 由 chip 内部处理"点击复制链接"，此处返回 undefined
 * - failed → 优先取该服务的 detail 错误，否则降级到全局 errorTooltipText
 * - pending → 运行态下整行圆点 + active 背景已传达进度，不再重复技术细节；终态需说明"未尝试"
 */
function targetChipTooltip(chip: TargetChipState): string | undefined {
  if (chip.variant === 'new') return undefined;
  if (chip.variant === 'failed') {
    const detail = props.item.details?.find(d => d.serviceId === chip.serviceId);
    return detail?.message ?? (errorTooltipText(props.item) || '上传失败');
  }
  // 运行态：整行圆点 + active 背景已经在表达"处理中"，不再用技术细节文案噪声打扰
  if (!TERMINAL_STATUSES.has(props.item.status)) return undefined;
  // 终态下的 pending：这个目标没轮到尝试，保留告知（有行动指引：用户可知需要重试）
  const targetName = getServiceDisplayName(chip.serviceId) || chip.serviceId;
  if (props.item.status === 'skipped') return `迁移已取消，未尝试 ${targetName}`;
  if (props.item.status === 'failed')  return `未尝试 ${targetName}`;
  return undefined;
}

function onRetry() {
  if (props.item.historyId) emit('retry', props.item.historyId);
}

function onChipCopy(serviceId: string) {
  if (props.item.historyId) emit('copyUrl', props.item.historyId, serviceId);
}
</script>

<template>
  <div
    class="mi-row"
    :class="{
      'mi-row--active': isActive,
      'mi-row--retrying': retrying,
    }"
  >
    <!-- 6px 状态圆点 -->
    <span
      class="mi-dot"
      :style="{ background: dotColor }"
      v-tooltip.top="isFailed && failedTooltip ? { value: failedTooltip, autoHide: false } : (item.status === 'skipped' ? '已在目标图床，已跳过' : undefined)"
    />

    <!-- 文件名 -->
    <span class="mi-row__name">{{ item.fileName }}</span>

    <span class="mi-row__spacer" />

    <!-- 服务流向 chips：existing badge 组 → 呼吸 gap → target chip 组 -->
    <div v-if="hasServices" class="mi-row__services">
      <MigrateServiceChip
        v-for="sid in visibleExistingChips"
        :key="`e-${sid}`"
        :service-id="sid"
        variant="existing"
        icon-only
        clickable
        :also-target="alsoTargetSet.has(sid)"
        @copy="onChipCopy(sid)"
      />
      <span
        v-if="overflowExistingChips.length > 0"
        class="mi-row__overflow"
        v-tooltip.top="overflowTooltip"
        aria-hidden="true"
      >+{{ overflowExistingChips.length }}</span>
      <!-- 呼吸 gap：只在 existing 和 target 两组都有内容时出现，替代 → 箭头符号表达"源→目标"方向 -->
      <span
        v-if="(existingChips.length > 0) && hasTargets"
        class="mi-row__services-gap"
        aria-hidden="true"
      />
      <MigrateServiceChip
        v-for="t in targetChips"
        :key="`t-${t.serviceId}`"
        :service-id="t.serviceId"
        :variant="t.variant"
        :clickable="t.variant === 'new'"
        :tooltip="targetChipTooltip(t)"
        @copy="onChipCopy(t.serviceId)"
      />
    </div>

    <!-- 失败条目的 24px 重试按钮 -->
    <template v-if="showRetry && item.historyId">
      <span v-if="retrying" class="mi-row__retry-spin">
        <i class="pi pi-spin pi-spinner" aria-hidden="true" />
      </span>
      <button
        v-else
        class="mi-row__retry-btn"
        type="button"
        v-tooltip.top="'重试'"
        @click.stop="onRetry"
      >
        <i class="pi pi-refresh" aria-hidden="true" />
      </button>
    </template>
  </div>
</template>

<style scoped>
.mi-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  padding: 0 0 0 var(--space-md);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 40px 对齐链接监控 .link-row 行高 */
  height: 40px;

  /* 父容器 .focus-list 是 flex column，子项默认 flex-shrink:1 会被压缩，固定高度失效 */
  flex-shrink: 0;
  border-bottom: 1px solid var(--primary-alpha-5);
  transition:
    background var(--duration-micro),
    opacity var(--duration-fast);
}

.mi-row:last-child { border-bottom: none; }
.mi-row:hover { background: var(--hover-overlay-subtle); }
.mi-row--retrying { opacity: 0.55; }

/* 处理中行：淡蓝背景辅助扫视 */
.mi-row--active { background: var(--primary-alpha-8); }
.mi-row--active:hover { background: var(--primary-alpha-15); }

/* ── 6px 状态圆点 ── */
.mi-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

/* ── 文件名 ── */
.mi-row__name {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
}

.mi-row__spacer { flex: 1; }

/* ── 服务流向 ── */
.mi-row__services {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

/* 呼吸 gap：让 existing badge 组和 target chip 组之间有视觉断句，替代 → 箭头 */
.mi-row__services-gap {
  width: var(--space-sm);
  flex-shrink: 0;
}


.mi-row__overflow {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  background: var(--bg-input);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-xs);
  flex-shrink: 0;
  cursor: help;
  white-space: nowrap;
  line-height: 20px;
  user-select: none;
}

/* ── 重试按钮（对齐链接监控 .delete-btn 的 24px 图标按钮） ── */
.mi-row__retry-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px 图标按钮圆角，沿用链接监控同源规范 */
  border-radius: 5px;
  background: transparent;
  color: var(--error);
  cursor: pointer;
  font-size: var(--text-xs);
  flex-shrink: 0;
  transition: background var(--duration-micro), color var(--duration-micro);
}

.mi-row__retry-btn:hover {
  background: var(--error-alpha-10);
  color: var(--error);
}

.mi-row__retry-spin {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--primary);
  font-size: var(--text-xs);
  flex-shrink: 0;
}
</style>
