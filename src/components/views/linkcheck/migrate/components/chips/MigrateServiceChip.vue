<script setup lang="ts">
/**
 * 批量迁移 · 单个服务 chip
 *
 * 视觉对齐链接监控 `.service-badge`（图标 + 文字），不同的 variant 驱动色调：
 * - source: 源图床，muted 灰色
 * - target: 目标图床，primary 色
 * - muted: 统计条等次要位置的极淡色
 * - existing: 该图已存在的图床（条目行用），中性灰
 * - new: 迁移新增成功的图床，success 色 + 高亮边
 * - pending: 正在添加的目标图床，primary 虚线边
 * - failed: 本次迁移失败的目标图床，error 色
 *
 * 图标用 getServiceIcon；未命中时 fallback pi-cloud + 原 id。
 */
import { computed } from 'vue';
import { getServiceIcon } from '../../../../../../utils/icons';
import { getServiceDisplayName } from '../../../../../../constants/serviceNames';

interface Props {
  serviceId: string;
  variant?: 'source' | 'target' | 'muted' | 'existing' | 'new' | 'pending' | 'failed';
  /** 可点击态：触发 copy 事件并展示 tooltip，由父组件决定是否启用（仅 URL 已就绪的变体传 true） */
  clickable?: boolean;
  /** 仅显示图标，隐藏文字标签；悬浮通过 tooltip 显示名称 */
  iconOnly?: boolean;
  /** 外部强制覆盖的 tooltip 文本（不可点击时的状态说明）；clickable 时始终显示"点击复制链接" */
  tooltip?: string;
}

const props = withDefaults(defineProps<Props>(), { variant: 'target', clickable: false, iconOnly: false, tooltip: undefined });

const emit = defineEmits<{ copy: [] }>();

const svg = computed(() => getServiceIcon(props.serviceId));
const displayName = computed(() => getServiceDisplayName(props.serviceId) || props.serviceId);

function onClick() {
  if (props.clickable) emit('copy');
}
</script>

<template>
  <span
    class="m-svc-chip"
    :class="[`m-svc-chip--${variant}`, { 'm-svc-chip--clickable': clickable, 'm-svc-chip--icon-only': iconOnly }]"
    v-tooltip.top="clickable ? '点击复制链接' : (tooltip ?? (iconOnly ? displayName : undefined))"
    @click.stop="onClick"
  >
    <span v-if="svg" class="m-svc-chip-ic" v-html="svg" />
    <i v-else class="pi pi-cloud m-svc-chip-ic m-svc-chip-ic--fallback" aria-hidden="true" />
    <span v-if="!iconOnly" class="m-svc-chip-label">{{ displayName }}</span>
  </span>
</template>

<style scoped>
.m-svc-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-sm);
  border-radius: var(--space-xs);
  flex-shrink: 0;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  transition: background var(--duration-micro);
}

.m-svc-chip-ic {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.m-svc-chip-ic :deep(svg) { width: 100%; height: 100%; }
.m-svc-chip-ic--fallback { font-size: var(--text-xs); }

.m-svc-chip-label {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.m-svc-chip--source {
  background: var(--bg-input);
  color: var(--text-muted);
}
.m-svc-chip--source .m-svc-chip-ic { color: var(--text-muted); }

.m-svc-chip--target {
  background: var(--primary-alpha-8);
  color: var(--primary);
}
.m-svc-chip--target .m-svc-chip-ic { color: var(--primary); }

.m-svc-chip--muted {
  background: transparent;
  color: var(--text-tertiary);
}
.m-svc-chip--muted .m-svc-chip-ic { color: var(--text-tertiary); }

/* existing: 默认透明底 + 弱灰字，对齐链接监控 .service-badge；hover 才浮出底色 */
.m-svc-chip--existing {
  background: transparent;
  color: var(--text-muted);
}
.m-svc-chip--existing .m-svc-chip-ic { color: var(--text-muted); }

/* new/pending/failed 保留淡色底，但去掉 box-shadow 描边，对齐链接监控 .error-badge 的简洁感 */
.m-svc-chip--new {
  background: var(--success-alpha-10);
  color: var(--success);
}
.m-svc-chip--new .m-svc-chip-ic { color: var(--success); }

.m-svc-chip--pending {
  background: var(--primary-alpha-8);
  color: var(--primary);
}
.m-svc-chip--pending .m-svc-chip-ic { color: var(--primary); }

.m-svc-chip--failed {
  background: var(--error-alpha-10);
  color: var(--error);
}
.m-svc-chip--failed .m-svc-chip-ic { color: var(--error); }

/* 仅图标模式：正方形 padding，无文字标签 */
.m-svc-chip--icon-only {
  padding: var(--space-2xs);
}

/* 可点击态：鼠标手型 + hover 色深一档 */
.m-svc-chip--clickable { cursor: pointer; }

.m-svc-chip--clickable.m-svc-chip--existing:hover {
  background: var(--hover-overlay);
}

.m-svc-chip--clickable.m-svc-chip--new:hover {
  background: var(--success-alpha-15);
}

.m-svc-chip--clickable.m-svc-chip--source:hover,
.m-svc-chip--clickable.m-svc-chip--target:hover {
  background: var(--primary-alpha-15);
}
</style>
