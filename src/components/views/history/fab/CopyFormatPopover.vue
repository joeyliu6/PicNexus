<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { LINK_FORMAT_OPTIONS, type LinkFormat } from '../../../../utils/linkFormatter';
import { useFabCopyFormat } from './useFabCopyFormat';

const emit = defineEmits<{
  (e: 'copy', format: LinkFormat): void;
}>();

const { currentDefault, hasCustomTemplate, setDefaultFormat } = useFabCopyFormat();

const visible = ref(false);
const popoverEl = ref<HTMLElement | null>(null);
const selectedFormat = ref<LinkFormat>(currentDefault.value);

const visibleOptions = computed(() =>
  LINK_FORMAT_OPTIONS.filter((opt) => opt.format !== 'custom' || hasCustomTemplate.value),
);

// 手动定位：Popover 出现在触发 chip 的左上方，远离主面板
async function positionPopover(triggerRect: DOMRect): Promise<void> {
  await nextTick();
  const el = popoverEl.value;
  if (!el) return;
  const popRect = el.getBoundingClientRect();
  const gap = 12;
  const viewportPadding = 8;

  // 垂直：chip 上方
  let top = triggerRect.top - popRect.height - gap;
  if (top < viewportPadding) {
    // 上方不够则 flip 到下方
    top = triggerRect.bottom + gap;
  }

  // 水平：右对齐 chip 的右边缘
  let left = triggerRect.right - popRect.width;
  if (left < viewportPadding) left = viewportPadding;
  if (left + popRect.width > window.innerWidth - viewportPadding) {
    left = window.innerWidth - popRect.width - viewportPadding;
  }

  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

function open(event: Event): void {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  selectedFormat.value = currentDefault.value;
  visible.value = true;
  void positionPopover(rect);
}

function close(): void {
  if (!visible.value) return;
  visible.value = false;
}

function handleSelect(format: LinkFormat): void {
  selectedFormat.value = format;
}

async function handleSetDefault(): Promise<void> {
  await setDefaultFormat(selectedFormat.value);
  // 粘性：不关闭
}

function handleCopy(): void {
  emit('copy', selectedFormat.value);
  close();
}

onClickOutside(popoverEl, () => close());

// ESC 关闭 Popover
function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && visible.value) {
    e.stopPropagation();
    close();
  }
}
onMounted(() => window.addEventListener('keydown', handleKeydown, true));
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown, true));

defineExpose({
  toggle(event: Event): void {
    if (visible.value) close();
    else open(event);
  },
  hide(): void {
    close();
  },
});
</script>

<template>
  <Teleport to="body">
    <Transition name="cfp">
      <div
        v-if="visible"
        ref="popoverEl"
        class="cfp-popover"
        role="dialog"
        aria-label="选择复制格式"
        @click.stop
      >
        <div class="cfp-header">选择格式</div>

        <div class="cfp-list">
          <button
            v-for="opt in visibleOptions"
            :key="opt.format"
            type="button"
            class="cfp-option"
            :class="{
              'is-selected': selectedFormat === opt.format,
              'is-longtail': opt.format === 'bbcode',
            }"
            @click.stop="handleSelect(opt.format)"
          >
            <i
              class="pi cfp-radio"
              :class="selectedFormat === opt.format ? 'pi-circle-fill' : 'pi-circle'"
            />
            <i class="pi cfp-opt-icon" :class="opt.icon" />
            <span class="cfp-opt-label">{{ opt.label }}</span>
            <span v-if="currentDefault === opt.format" class="cfp-default-tag">
              <i class="pi pi-star-fill" />默认
            </span>
          </button>
        </div>

        <div class="cfp-actions">
          <button
            type="button"
            class="cfp-btn cfp-btn-secondary"
            :disabled="selectedFormat === currentDefault"
            @click.stop="handleSetDefault"
          >
            设为默认
          </button>
          <button
            type="button"
            class="cfp-btn cfp-btn-primary"
            @click.stop="handleCopy"
          >
            复制
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cfp-popover {
  position: fixed;

  /* top/left 由 JS 注入 */
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-width: 240px;
  max-width: min(280px, calc(100vw - var(--space-xl)));
  padding: var(--space-xs);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-float);
  z-index: var(--z-modal);
}

.cfp-header {
  padding: var(--space-2xs) var(--space-sm) var(--space-xs);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-muted);
  letter-spacing: 0.03em;
}

.cfp-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.cfp-option {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-xs-sm) var(--space-sm);
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-xs);
  border-radius: var(--radius-sm-md);
  cursor: pointer;
  text-align: left;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.cfp-option:hover {
  background: var(--hover-overlay);
}

.cfp-option.is-selected {
  background: var(--primary-alpha-8);
  color: var(--primary);
}

.cfp-option.is-longtail {
  color: var(--text-muted);
  font-size: var(--text-2xs);
}

.cfp-option.is-longtail.is-selected {
  color: var(--primary);
}

.cfp-radio {
  font-size: var(--text-xs);
  color: var(--text-muted);
  width: 14px;
  text-align: center;
}

.cfp-option.is-selected .cfp-radio {
  color: var(--primary);
}

.cfp-opt-icon {
  font-size: var(--text-xs);
  color: var(--text-muted);
  width: 14px;
  text-align: center;
}

.cfp-option.is-selected .cfp-opt-icon {
  color: var(--primary);
}

.cfp-opt-label {
  flex: 1;
  min-width: 0;
}

.cfp-default-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: 0 var(--space-xs);
  font-size: var(--text-2xs);
  color: var(--primary);
  background: var(--primary-alpha-8);
  border-radius: var(--radius-full);
  line-height: 1.6;
}

.cfp-default-tag i {
  font-size: var(--text-2xs);
}

.cfp-actions {
  display: flex;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-2xs) var(--space-2xs);
  border-top: 1px solid var(--border-subtle);
  margin-top: var(--space-2xs);
}

.cfp-btn {
  flex: 1;
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  border-radius: var(--radius-sm-md);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-standard);
}

.cfp-btn-secondary {
  background: transparent;
  color: var(--text-secondary);
}

.cfp-btn-secondary:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-alpha-8);
}

.cfp-btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cfp-btn-primary {
  background: var(--primary);
  color: var(--text-on-primary);
  border-color: var(--primary);
}

.cfp-btn-primary:hover {
  filter: brightness(1.08);
}

/* ---- 弹出动画：从触发点向上浮出 ---- */
.cfp-enter-active {
  transition:
    opacity var(--duration-normal) var(--ease-overshoot),
    transform var(--duration-normal) var(--ease-overshoot);
}

.cfp-leave-active {
  transition:
    opacity var(--duration-fast) var(--ease-accelerate),
    transform var(--duration-fast) var(--ease-accelerate);
}

.cfp-enter-from,
.cfp-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.97);
}
</style>
