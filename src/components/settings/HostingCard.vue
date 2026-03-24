<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
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

watch(() => props.forceExpand, (val) => {
  if (val) {
    isExpanded.value = true;
    emit('toggle', true);
    nextTick(() => {
      cardRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
  const overflow = cardRect.bottom + 10 - parentRect.bottom;

  if (overflow > 0) {
    scrollParent.scrollBy({ top: overflow, behavior: 'smooth' });
  } else if (cardRect.top < parentRect.top) {
    scrollParent.scrollBy({ top: cardRect.top - parentRect.top - 10, behavior: 'smooth' });
  }
}

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value;
  emit('toggle', isExpanded.value);

  if (isExpanded.value) {
    // 等待 DOM 更新和渲染完成后再滚动
    nextTick(() => requestAnimationFrame(() => requestAnimationFrame(scrollCardIntoView)));
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
  if (props.isBuiltin) {
    return props.isAvailable ? 'status-dot verified' : 'status-dot';
  }
  if (props.healthStatus) {
    return `status-dot ${props.healthStatus}`;
  }
  return props.isConfigured ? 'status-dot verified' : 'status-dot';
});
</script>

<template>
  <div ref="cardRef" class="hosting-card" :class="{ expanded: isExpanded }">
    <div class="card-header" @click="toggleExpanded">
      <div class="header-left">
        <span :class="statusDotClass" v-tooltip.top="healthTooltip || null"></span>
        <div class="header-info">
          <span class="card-title">{{ name }}</span>
          <span class="card-description">{{ description }}</span>
        </div>
      </div>
      <div class="header-right">
        <i class="expand-icon pi" :class="isExpanded ? 'pi-chevron-up' : 'pi-chevron-down'"></i>
      </div>
    </div>

    <div v-if="isExpanded" class="card-content">
      <div class="content-inner">
        <slot></slot>

        <div v-if="isBuiltin" class="builtin-status" :class="{ available: isAvailable }">
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
          <Button
            v-if="showLoginButton"
            label="自动获取"
            icon="pi pi-sign-in"
            @click="handleLogin"
            outlined
            size="small"
          />
          <Button
            v-if="isBuiltin"
            :label="isChecking ? '检测中...' : '检测可用性'"
            :icon="isChecking ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'"
            @click="handleCheck"
            :loading="isChecking"
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
            :disabled="!isConfigured && !isBuiltin"
            severity="secondary"
            outlined
            size="small"
          />
        </div>

        <slot name="extra"></slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hosting-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s ease;
}

.hosting-card:hover {
  border-color: var(--primary);
}

.hosting-card.expanded {
  border-color: var(--primary);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;
}

.card-header:hover {
  background-color: var(--hover-overlay-subtle);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.card-description {
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.3;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.expand-icon {
  font-size: 0.875rem;
  color: var(--text-muted);
  transition: transform 0.2s ease, color 0.2s ease;
}

.hosting-card:hover .expand-icon {
  color: var(--text-secondary);
}

.hosting-card.expanded .expand-icon {
  color: var(--primary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
  transition: all 0.2s ease;
  box-shadow: 0 0 0 2px var(--bg-card);
}

.status-dot.configured,
.status-dot.verified {
  background: var(--success);
  box-shadow: 0 0 0 2px var(--bg-card), 0 0 6px var(--success-border);
}

.status-dot.pending {
  background: var(--warning);
  box-shadow: 0 0 0 2px var(--bg-card), 0 0 6px var(--warning-border);
}

.status-dot.error {
  background: var(--error);
  box-shadow: 0 0 0 2px var(--bg-card), 0 0 6px var(--error-border);
}

.card-content {
  border-top: 1px solid var(--border-subtle);
  animation: slideDown 0.2s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.content-inner {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.builtin-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
}

.builtin-status.available {
  border-color: var(--success);
  background: rgba(34, 197, 94, 0.05);
}

.status-icon {
  flex-shrink: 0;
}

.status-icon i {
  font-size: 1.25rem;
}

.builtin-status.available .status-icon i {
  color: var(--success);
}

.builtin-status:not(.available) .status-icon i {
  color: var(--error);
}

.status-text {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-primary);
}

.card-actions {
  display: flex;
  justify-content: flex-start;
  gap: 8px;
}

@media (max-width: 768px) {
  .card-header {
    padding: 12px 14px;
  }

  .card-title {
    font-size: 0.875rem;
  }

  .content-inner {
    padding: 14px;
  }

  .card-actions {
    flex-wrap: wrap;
  }
}
</style>
