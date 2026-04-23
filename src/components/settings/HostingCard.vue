<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import Button from 'primevue/button';
import type { ServiceHealthStatus } from '../../types/serviceHealth';

interface Props {
  id: string;
  name: string;
  description: string;
  isConfigured: boolean;
  healthStatus?: ServiceHealthStatus;
  healthTooltip?: string;
  isTesting?: boolean;
  isRefreshing?: boolean;
  defaultExpanded?: boolean;
  isBuiltin?: boolean;
  isAvailable?: boolean;
  isChecking?: boolean;
  showTestButton?: boolean;
  showLoginButton?: boolean;
  forceExpand?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  healthStatus: undefined,
  healthTooltip: undefined,
  isTesting: false,
  isRefreshing: false,
  defaultExpanded: false,
  isBuiltin: false,
  isAvailable: false,
  isChecking: false,
  showTestButton: true,
  showLoginButton: false,
  forceExpand: false
});

const emit = defineEmits<{
  test: [providerId: string];
  login: [providerId: string];
  check: [providerId: string];
  toggle: [expanded: boolean];
}>();

const cardRef = ref<HTMLElement | null>(null);
const isExpanded = ref(props.defaultExpanded);

/** CSS Grid 过渡时长（ms），与 CSS 中的 0.25s 保持一致 */
const TRANSITION_DURATION = 260;
/** 滚动时额外留白（px），避免卡片紧贴容器边界 */
const SCROLL_PADDING = 15;

watch(() => props.forceExpand, (val) => {
  if (val) {
    isExpanded.value = true;
    emit('toggle', true);
    // 等待 CSS Grid 过渡完成后再滚动
    setTimeout(scrollCardIntoView, TRANSITION_DURATION);
  }
}, { immediate: true });

function findScrollParent(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return parent;
    parent = parent.parentElement;
  }
  return null;
}

function scrollCardIntoView(): void {
  const card = cardRef.value;
  if (!card) return;
  const scrollParent = findScrollParent(card);
  if (!scrollParent) return;

  const cardRect = card.getBoundingClientRect();
  const parentRect = scrollParent.getBoundingClientRect();
  const viewHeight = parentRect.height;
  const cardHeight = cardRect.height;

  // 卡片比可视区域还高 → 优先显示顶部（名称）
  if (cardHeight > viewHeight - SCROLL_PADDING * 2) {
    const topOffset = cardRect.top - parentRect.top - SCROLL_PADDING;
    if (Math.abs(topOffset) > 1) {
      scrollParent.scrollBy({ top: topOffset, behavior: 'smooth' });
    }
    return;
  }

  // 卡片能完整显示 → 确保整张卡片在可视区域内
  const bottomOverflow = cardRect.bottom + SCROLL_PADDING - parentRect.bottom;
  if (bottomOverflow > 0) {
    scrollParent.scrollBy({ top: bottomOverflow, behavior: 'smooth' });
  } else if (cardRect.top < parentRect.top + SCROLL_PADDING) {
    scrollParent.scrollBy({ top: cardRect.top - parentRect.top - SCROLL_PADDING, behavior: 'smooth' });
  }
}

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value;
  emit('toggle', isExpanded.value);

  if (isExpanded.value) {
    // 等待 CSS Grid 过渡完成后再滚动，确保高度已经展开到位
    setTimeout(scrollCardIntoView, TRANSITION_DURATION);
  }
};

const handleTest = () => {
  emit('test', props.id);
};

const handleLogin = () => {
  emit('login', props.id);
};

const handleCheck = () => {
  emit('check', props.id);
};

const statusDotClass = computed(() => {
  if (props.isRefreshing) {
    return 'status-dot refreshing';
  }
  if (props.isBuiltin) {
    return props.isAvailable ? 'status-dot verified' : 'status-dot';
  }
  if (props.healthStatus) {
    return `status-dot ${props.healthStatus}`;
  }
  return props.isConfigured ? 'status-dot verified' : 'status-dot';
});

const statusTooltip = computed(() => {
  if (props.isRefreshing) return '正在检测...';
  return props.healthTooltip || null;
});
</script>

<template>
  <div ref="cardRef" class="hosting-card" :class="{ expanded: isExpanded }">
    <div class="card-header" @click="toggleExpanded">
      <div class="header-left">
        <span :class="statusDotClass" v-tooltip.top="statusTooltip"></span>
        <div class="header-info">
          <span class="card-title">{{ name }}</span>
          <span class="card-description">{{ description }}</span>
        </div>
      </div>
      <div class="header-right">
        <i class="expand-icon pi" :class="isExpanded ? 'pi-chevron-up' : 'pi-chevron-down'"></i>
      </div>
    </div>

    <div class="card-content-wrapper">
      <div class="card-content">
        <div class="content-inner">
        <slot></slot>

        <div v-if="isBuiltin" class="builtin-status" :class="{ available: isAvailable && !isRefreshing, refreshing: isRefreshing }">
          <div class="status-icon">
            <i v-if="isChecking" class="pi pi-spin pi-spinner"></i>
            <i v-else-if="isAvailable" class="pi pi-check-circle"></i>
            <i v-else class="pi pi-times-circle"></i>
          </div>
          <div class="status-text">
            <span v-if="isChecking">正在检测...</span>
            <span v-else-if="isAvailable">服务可用</span>
            <span v-else>服务不可用</span>
          </div>
        </div>

        <div class="card-actions">
          <div class="actions-left">
            <Button
              v-if="showLoginButton"
              label="自动获取"
              icon="pi pi-sign-in"
              @click="handleLogin"
              :disabled="isRefreshing"
              outlined
              size="small"
            />
            <Button
              v-if="isBuiltin"
              :label="isChecking ? '检测中...' : '检测可用性'"
              :icon="isChecking ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'"
              @click="handleCheck"
              :loading="isChecking"
              :disabled="isRefreshing"
              severity="secondary"
              outlined
              size="small"
            />
            <Button
              v-if="showTestButton"
              label="测试连接"
              icon="pi pi-check"
              @click="handleTest"
              :loading="isTesting"
              :disabled="isRefreshing || (!isConfigured && !isBuiltin)"
              severity="secondary"
              outlined
              size="small"
            />
          </div>
          <slot name="actions-right"></slot>
        </div>

        <slot name="extra"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('../../styles/settings-shared.css');

.hosting-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: all var(--duration-normal) ease;
}

.hosting-card:hover {
  border-color: var(--primary);
}

.hosting-card.expanded {
  border-color: var(--primary);
}

.hosting-card:hover .expand-icon {
  color: var(--text-secondary);
}

.hosting-card.expanded .expand-icon {
  color: var(--primary);
}

.hosting-card.expanded .card-content-wrapper {
  grid-template-rows: 1fr;
}

.content-inner {
  border-top: 1px solid var(--border-subtle);
  padding: var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.builtin-status {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  padding: var(--space-md) var(--space-md-lg);
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
}

.builtin-status.available {
  border-color: var(--success);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 内建服务可用状态浅绿背景，无对应 token */
  background: rgb(34 197 94 / 5%);
}

.builtin-status.refreshing {
  background: color-mix(in srgb, var(--bg-card) 84%, var(--hover-overlay-subtle));
  border-color: transparent;
}

.status-icon {
  position: relative;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.status-icon i {
  font-size: var(--text-xl);
}

.builtin-status.available .status-icon i {
  color: var(--success);
}

.builtin-status:not(.available) .status-icon i {
  color: var(--error);
}

.status-text {
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
}

.status-text span {
  display: inline-block;
  position: relative;
}

.builtin-status.refreshing .status-icon i,
.builtin-status.refreshing .status-text span {
  color: transparent;
}

.builtin-status.refreshing .status-icon i {
  opacity: 0;
}

.builtin-status.refreshing .status-icon::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--radius-full);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--hover-overlay) 86%, transparent) 0%,
    color-mix(in srgb, var(--hover-overlay) 60%, var(--bg-card)) 50%,
    color-mix(in srgb, var(--hover-overlay) 86%, transparent) 100%
  );
  background-size: 200% 100%;
  animation: k-shimmer var(--duration-shimmer) ease-in-out infinite;
}

.builtin-status.refreshing .status-text span::before {
  content: '';
  position: absolute;
  inset: 50% 0 auto;
  height: 12px;
  transform: translateY(-50%);
  border-radius: var(--radius-full);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--hover-overlay) 86%, transparent) 0%,
    color-mix(in srgb, var(--hover-overlay) 60%, var(--bg-card)) 50%,
    color-mix(in srgb, var(--hover-overlay) 86%, transparent) 100%
  );
  background-size: 200% 100%;
  animation: k-shimmer var(--duration-shimmer) ease-in-out infinite;
}

.card-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-sm);
}

.actions-left {
  display: flex;
  gap: var(--space-sm);
}

.status-dot.refreshing {
  background: var(--text-muted);
  box-shadow: 0 0 0 1px var(--border-subtle);
}

@media (width <= 768px) {
  .content-inner {
    padding: var(--space-md-lg);
  }

  .card-actions {
    flex-wrap: wrap;
  }

  .actions-left {
    flex-wrap: wrap;
  }
}
</style>
