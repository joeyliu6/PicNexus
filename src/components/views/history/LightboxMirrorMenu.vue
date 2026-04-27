<script setup lang="ts">
/**
 * 灯箱图床管理菜单 — 整合"复制 / 切主图床 / 移除 / 重新检测"四种动作
 *
 * 行布局（左到右）：
 *   [ 圆点(主) ][ 服务名 ]             [ 图钉(设为主) ][ 移除 ][ 状态 chip ]
 * 所有行三列按钮位固定对齐；主行的"设为主"按禁用态渲染（已经是主）。
 *
 * 交互：
 * - 点击整行 = 复制此图床链接
 * - 点"设为主"图标 = 切换主图床（主行禁用；失效行禁用，不可扶正）
 * - 点"移除"图标 = 从记录中删除此链接；主行也可移除（自动迁移到备选）
 * - 点 chip = 重新检测此链接的有效性（实时）
 */
import { computed } from 'vue';
import { getServiceDisplayName } from '../../../constants/serviceNames';
import type { MirrorInfo } from '../../../composables/history/useMirrorFallback';

const props = defineProps<{
  mirrors: MirrorInfo[];
  isPrimaryBroken: boolean;
  loadFailedServiceId?: string | null;
  allMirrorsBroken: boolean;
  checkingServices: Set<string>;
}>();

const emit = defineEmits<{
  (e: 'copy-mirror', serviceId: string): void;
  (e: 'switch-primary', serviceId: string): void;
  (e: 'remove-mirror', serviceId: string): void;
  (e: 'check-mirror', serviceId: string): void;
}>();

const banner = computed<{ kind: 'danger' | 'warning'; text: string } | null>(() => {
  if (props.allMirrorsBroken) {
    return { kind: 'danger', text: '全部图床链接均已失效，建议删除整条记录' };
  }
  if (props.loadFailedServiceId) {
    const serviceName = getServiceDisplayName(props.loadFailedServiceId);
    return { kind: 'warning', text: `${serviceName} 本次加载失败，可手动切换到其他图床` };
  }
  if (props.isPrimaryBroken) {
    return { kind: 'warning', text: '主图床已失效，可切换到其他可用图床' };
  }
  return null;
});

function handleRowClick(mirror: MirrorInfo): void {
  emit('copy-mirror', mirror.serviceId);
}

function handleSwitchClick(mirror: MirrorInfo, event: Event): void {
  event.stopPropagation();
  if (mirror.isPrimary) return;
  if (mirror.checkState === 'invalid') return;
  emit('switch-primary', mirror.serviceId);
}

function handleRemoveClick(mirror: MirrorInfo, event: Event): void {
  event.stopPropagation();
  emit('remove-mirror', mirror.serviceId);
}

function handleChipClick(mirror: MirrorInfo, event: Event): void {
  event.stopPropagation();
  if (props.checkingServices.has(mirror.serviceId)) return;
  emit('check-mirror', mirror.serviceId);
}

function isLoadFailed(mirror: MirrorInfo): boolean {
  return mirror.serviceId === props.loadFailedServiceId;
}

function stateLabel(mirror: MirrorInfo): string {
  if (isLoadFailed(mirror)) return '本次失败';
  switch (mirror.checkState) {
    case 'valid': return '可用';
    case 'invalid': return '已失效';
    case 'unchecked': return '未检测';
  }
}

function stateTone(mirror: MirrorInfo): MirrorInfo['checkState'] | 'load-failed' {
  return isLoadFailed(mirror) ? 'load-failed' : mirror.checkState;
}
</script>

<template>
  <div class="mirror-menu" role="menu" aria-label="图床管理">
    <div v-if="banner" class="mirror-menu-banner" :class="`mirror-menu-banner--${banner.kind}`">
      <i class="pi pi-exclamation-triangle" aria-hidden="true" />
      <span>{{ banner.text }}</span>
    </div>

    <ul class="mirror-menu-list">
      <li
        v-for="mirror in mirrors"
        :key="mirror.serviceId"
        class="mirror-row"
        :class="{
          'mirror-row--primary': mirror.isPrimary,
          'mirror-row--invalid': mirror.checkState === 'invalid',
          'mirror-row--load-failed': isLoadFailed(mirror),
        }"
        :aria-current="mirror.isPrimary ? 'true' : undefined"
        role="menuitem"
        tabindex="0"
        @click="handleRowClick(mirror)"
        @keydown.enter.prevent="handleRowClick(mirror)"
        @keydown.space.prevent="handleRowClick(mirror)"
      >
        <span
          class="mirror-row-name"
          v-tooltip.top="'点击复制链接'"
        >
          <span
            class="mirror-row-dot"
            :class="{ 'mirror-row-dot--placeholder': !mirror.isPrimary }"
            aria-hidden="true"
          ></span>
          {{ getServiceDisplayName(mirror.serviceId) }}
        </span>

        <div class="mirror-row-actions">
          <button
            type="button"
            class="mirror-row-action mirror-row-action--switch"
            :disabled="mirror.isPrimary || mirror.checkState === 'invalid'"
            :aria-label="mirror.isPrimary ? '当前主图床' : '设为主图床'"
            v-tooltip.top="mirror.isPrimary ? '当前主图床' : '设为主图床'"
            @click="handleSwitchClick(mirror, $event)"
          >
            <i class="pi pi-thumbtack" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="mirror-row-action mirror-row-action--remove"
            aria-label="移除此链接"
            v-tooltip.top="'移除此链接'"
            @click="handleRemoveClick(mirror, $event)"
          >
            <i class="pi pi-trash" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="mirror-row-chip"
            :class="[
              `mirror-row-chip--${stateTone(mirror)}`,
              { 'mirror-row-chip--checking': checkingServices.has(mirror.serviceId) },
            ]"
            :disabled="checkingServices.has(mirror.serviceId)"
            :aria-label="`状态：${stateLabel(mirror)}，点击重新检测`"
            v-tooltip.top="'重新检测'"
            @click="handleChipClick(mirror, $event)"
          >
            <i
              v-if="checkingServices.has(mirror.serviceId)"
              class="pi pi-spin pi-spinner"
              aria-hidden="true"
            />
            <span v-else>{{ stateLabel(mirror) }}</span>
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.mirror-menu {
  /* 短名（2 字）下贴近实际内容宽度，长名（含"自定义服务"等）由 flex 名称区 + ellipsis 兜底 */
  min-width: 260px;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.mirror-menu-banner {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  line-height: 1.35;
}

.mirror-menu-banner--warning {
  background: var(--warning-alpha-15);
  color: var(--warning);
}

.mirror-menu-banner--danger {
  background: var(--error-alpha-15);
  color: var(--error);
}

.mirror-menu-banner i {
  font-size: var(--text-sm);
  flex-shrink: 0;
}

.mirror-menu-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  list-style: none;
  margin: 0;
  padding: 0;
}

.mirror-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--text-main);
  background: transparent;
  transition: background var(--duration-fast) var(--ease-standard);
  cursor: pointer;
}

.mirror-row:hover,
.mirror-row:focus-visible {
  background: var(--hover-overlay);
  outline: none;
}

.mirror-row--primary {
  background: var(--primary-alpha-8);
}

.mirror-row--primary:hover,
.mirror-row--primary:focus-visible {
  background: var(--primary-alpha-15);
}

.mirror-row--invalid {
  opacity: 0.7;
}

.mirror-row--load-failed {
  background: var(--warning-alpha-15);
}

.mirror-row--load-failed:hover,
.mirror-row--load-failed:focus-visible {
  background: var(--warning-alpha-15);
}

.mirror-row-name {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 6px 圆点紧贴服务名前标主图床；非主行渲染同尺寸隐形占位保持名称左对齐 */
.mirror-row-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--primary);
  flex-shrink: 0;
}

.mirror-row-dot--placeholder {
  visibility: hidden;
}

.mirror-row-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  flex-shrink: 0;
}

.mirror-row-action {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.mirror-row-action:hover:not(:disabled) {
  background: var(--hover-overlay);
  color: var(--text-main);
}

.mirror-row-action--switch:hover:not(:disabled) {
  color: var(--primary);
}

.mirror-row-action--remove:hover:not(:disabled) {
  background: var(--error-alpha-15);
  color: var(--error);
}

.mirror-row-action:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.mirror-row-action:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}

.mirror-row-action--remove:focus-visible {
  outline-color: var(--error);
}

/* 状态 chip 兼职"重新检测"按钮：hover 微亮、focus 有 ring、loading 锁定 */
.mirror-row-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 56px;
  height: 24px;
  padding: 0 var(--space-sm);
  border: none;
  border-radius: var(--radius-full);
  font-size: var(--text-2xs);
  font-weight: var(--weight-medium);
  letter-spacing: 0.02em;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;
}

.mirror-row-chip:hover:not(:disabled) {
  transform: scale(1.05);
}

.mirror-row-chip:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.mirror-row-chip:disabled {
  cursor: progress;
}

.mirror-row-chip--valid {
  background: var(--success-alpha-15);
  color: var(--success);
}

.mirror-row-chip--invalid {
  background: var(--error-alpha-15);
  color: var(--error);
}

.mirror-row-chip--unchecked {
  background: var(--hover-overlay);
  color: var(--text-muted);
}

.mirror-row-chip--checking {
  background: var(--primary-alpha-15);
  color: var(--primary);
}

.mirror-row-chip--load-failed {
  background: var(--warning-alpha-15);
  color: var(--warning);
}

.mirror-row-chip .pi-spinner {
  font-size: var(--text-xs);
}
</style>
