<script setup lang="ts">
/**
 * 灯箱镜像管理菜单 - 列出一张图的所有成功镜像 + 切换/删除动作
 *
 * 交互：
 * - 点击非主服务行 → 触发 switch-primary
 * - 点击行尾 trash 图标 → 触发 remove-mirror
 * - 当前主服务行显示"主服务"标签，不可删除
 * - 头部可选横幅：主图失效 / 全部失效 时提示用户
 */
import { computed } from 'vue';
import { getServiceDisplayName } from '../../../constants/serviceNames';
import type { MirrorInfo } from '../../../composables/history/useMirrorFallback';

const props = defineProps<{
  mirrors: MirrorInfo[];
  isPrimaryBroken: boolean;
  allMirrorsBroken: boolean;
}>();

const emit = defineEmits<{
  (e: 'switch-primary', serviceId: string): void;
  (e: 'remove-mirror', serviceId: string): void;
}>();

/** 头部横幅：优先展示"全部失效"，其次"主图失效" */
const banner = computed<{ kind: 'danger' | 'warning'; text: string } | null>(() => {
  if (props.allMirrorsBroken) {
    return { kind: 'danger', text: '所有镜像均已失效，建议删除整条记录' };
  }
  if (props.isPrimaryBroken) {
    return { kind: 'warning', text: '主图已失效，可切换到其他可用镜像' };
  }
  return null;
});

function handleRowClick(mirror: MirrorInfo): void {
  if (mirror.isPrimary) return;
  if (mirror.checkState === 'invalid') return; // 已知失效的不让设为主服务
  emit('switch-primary', mirror.serviceId);
}

function handleRemoveClick(mirror: MirrorInfo, event: Event): void {
  event.stopPropagation();
  if (mirror.isPrimary) return;
  emit('remove-mirror', mirror.serviceId);
}

function stateLabel(state: MirrorInfo['checkState']): string {
  switch (state) {
    case 'valid': return '可用';
    case 'invalid': return '已失效';
    case 'unchecked': return '未检测';
  }
}
</script>

<template>
  <div class="mirror-menu" role="menu" aria-label="镜像管理">
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
          'mirror-row--clickable': !mirror.isPrimary && mirror.checkState !== 'invalid',
        }"
        :aria-disabled="mirror.isPrimary || mirror.checkState === 'invalid' ? 'true' : 'false'"
        @click="handleRowClick(mirror)"
      >
        <span class="mirror-row-name">{{ getServiceDisplayName(mirror.serviceId) }}</span>
        <span
          class="mirror-row-chip"
          :class="`mirror-row-chip--${mirror.checkState}`"
          :aria-label="`状态：${stateLabel(mirror.checkState)}`"
        >
          {{ stateLabel(mirror.checkState) }}
        </span>
        <span v-if="mirror.isPrimary" class="mirror-row-tag">主服务</span>
        <button
          v-else
          type="button"
          class="mirror-row-remove"
          aria-label="删除此镜像"
          v-tooltip.top="'删除此镜像链接'"
          @click="handleRemoveClick(mirror, $event)"
        >
          <i class="pi pi-trash" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.mirror-menu {
  min-width: 240px;
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
  cursor: default;
}

.mirror-row--clickable {
  cursor: pointer;
}

.mirror-row--clickable:hover {
  background: var(--hover-overlay);
}

.mirror-row--primary {
  background: var(--hover-overlay-subtle);
}

.mirror-row--invalid {
  opacity: 0.7;
}

.mirror-row-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mirror-row-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  height: 20px;
  padding: 0 var(--space-xs);
  border-radius: var(--radius-full);
  font-size: var(--text-2xs);
  font-weight: var(--weight-medium);
  letter-spacing: 0.02em;
  flex-shrink: 0;
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

.mirror-row-tag {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  flex-shrink: 0;
}

.mirror-row-remove {
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
  flex-shrink: 0;
}

.mirror-row-remove:hover {
  background: var(--error-alpha-15);
  color: var(--error);
}

.mirror-row-remove:focus-visible {
  outline: 2px solid var(--error);
  outline-offset: -2px;
}
</style>
