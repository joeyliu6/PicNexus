<script setup lang="ts">
/**
 * 补充备份 · 一行 = 一张图（与链接检测的行同一个样子）
 *
 * 布局：[缩略图] [文件名 / ● 一句白话状态] [spacer] [已在的图床 » 目标图床] [重试 · 仅失败 + 完成后]
 * - 白话状态：等待中 / 上传中… / 已复制到 X / 没成功 · 原因 / 本来就有 / 没来得及处理；完整原因在悬停提示
 * - 圆点颜色：等待灰 / 进行中蓝 / 成功绿 / 失败红 / 跳过黄
 * - 复制链接入口在可点击的图床徽章上
 */
import { computed } from 'vue';
import { makeCopyBadgeKey } from '@/composables/useCopyBadgeFeedback';
import { errorTooltipText } from '@/components/views/link-check/migrate/composables/useErrorPresentation';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { joinCjk, listServiceNames } from '@/utils/cjkSpacing';
import MigrateServiceChip from './MigrateServiceChip.vue';
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';
import type { MigrateRowItem } from './migrateRowTypes';

const TERMINAL_STATUSES = new Set(['success', 'failed', 'skipped']);

const VISIBLE_EXISTING_MAX = 3;

interface Props {
  item: MigrateRowItem;
  targetServiceIds?: string[];
  showRetry?: boolean;
  retrying?: boolean;
  copiedKey?: string | null;
  /** 缩略图候选（父组件按来源链接生成）；文件名大多是 clipboard_xxx，认图全靠它 */
  thumbSrcs?: string[];
  confirmedHttpHosts?: ReadonlySet<string>;
}

const props = withDefaults(defineProps<Props>(), {
  targetServiceIds: () => [],
  showRetry: false,
  retrying: false,
  copiedKey: null,
  thumbSrcs: () => [],
  confirmedHttpHosts: undefined,
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
const SKIP_TEXT: Record<NonNullable<MigrateRowItem['skipReason']>, string> = {
  'already-there': '目标图床上本来就有',
  'not-attempted': '没来得及处理',
  'not-needed': '已经不需要补了',
  deleted: '处理前这条记录被删除了',
};

const skippedTooltip = computed(() => {
  if (props.item.status !== 'skipped') return undefined;
  return props.item.error || SKIP_TEXT[props.item.skipReason ?? 'already-there'];
});

const nameOf = (sid: string) => getServiceDisplayName(sid) || sid;

/** 行上那句白话：这张图现在怎么样了 */
const statusLine = computed(() => {
  switch (props.item.status) {
    case 'pending': return '等待中';
    case 'downloading': return '下载中…';
    case 'converting': return '转换格式…';
    case 'uploading': return '上传中…';
    case 'skipped': return props.item.error && props.item.skipReason !== 'already-there'
      ? props.item.error
      : SKIP_TEXT[props.item.skipReason ?? 'already-there'];
    case 'failed': return props.item.error ? `没成功 · ${props.item.error}` : '没成功';
    case 'success': {
      const done = targetChips.value.filter(t => t.variant === 'new').map(t => nameOf(t.serviceId));
      const failed = targetChips.value.filter(t => t.variant === 'failed').map(t => nameOf(t.serviceId));
      if (done.length === 0) return '已完成';
      const copied = joinCjk('已复制到', listServiceNames(done));
      return failed.length > 0 ? joinCjk(copied, '，', listServiceNames(failed), '没成功') : copied;
    }
    default: return '';
  }
});

const statusTooltip = computed(() => (isFailed.value && failedTooltip.value
  ? { value: failedTooltip.value, autoHide: false }
  : skippedTooltip.value));

/** 圆点颜色：沿用链接检测 statusDotColor 的 CSS 变量模式 */
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
  if (props.item.status === 'skipped') {
    return props.item.error ? `${targetName} 未尝试：${props.item.error}` : `迁移已取消，未尝试 ${targetName}`;
  }
  if (props.item.status === 'failed')  return `未尝试 ${targetName}`;
  return undefined;
}

function onRetry() {
  if (props.item.historyId) emit('retry', props.item.historyId);
}

function onChipCopy(serviceId: string) {
  if (props.item.historyId) emit('copyUrl', props.item.historyId, serviceId);
}

function chipCopyKey(serviceId: string): string {
  return makeCopyBadgeKey('migrate', props.item.historyId, serviceId);
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
    <div class="mi-thumb">
      <ThumbnailImage
        :srcs="thumbSrcs"
        :alt="item.fileName"
        image-class="mi-thumb-img"
        :confirmed-http-hosts="confirmedHttpHosts"
      >
        <template #placeholder>
          <i class="pi pi-image mi-thumb-placeholder" aria-hidden="true"></i>
        </template>
      </ThumbnailImage>
    </div>

    <div class="mi-row__main">
      <span class="mi-row__name">{{ item.fileName }}</span>
      <span class="mi-row__status" v-tooltip.top="statusTooltip">
        <span class="mi-dot" :style="{ background: dotColor }" aria-hidden="true" />
        <span class="mi-row__status-text">{{ statusLine }}</span>
      </span>
    </div>

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
        :copied="copiedKey === chipCopyKey(sid)"
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
        :copied="copiedKey === chipCopyKey(t.serviceId)"
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
  padding: var(--space-xs) var(--space-sm);
  min-height: 56px;

  /* 父容器 .focus-list 是 flex column，子项默认 flex-shrink:1 会被压缩，固定高度失效 */
  flex-shrink: 0;
  border-radius: var(--radius-md);
  transition:
    background var(--duration-micro),
    opacity var(--duration-fast);
}

/* ── 缩略图（与链接检测 / 文档修复同尺寸） ── */
.mi-thumb {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--radius-sm-md);
  overflow: hidden;
  background: var(--bg-input);
  display: flex;
  align-items: center;
  justify-content: center;
}

.mi-thumb :deep(.mi-thumb-img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.mi-thumb-placeholder {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}
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

/* ── 文件名 + 白话状态 ── */
.mi-row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.mi-row__name {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mi-row__status {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
  cursor: default;
}

.mi-row__status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mi-row__spacer { flex: 0 0 var(--space-xs); }

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

/* ── 重试按钮（对齐链接检测 .delete-btn 的 24px 图标按钮） ── */
.mi-row__retry-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px 图标按钮圆角，沿用链接检测同源规范 */
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
