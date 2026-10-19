<script setup lang="ts">
// 通知叠放（T05-Toasts.dc.html）：右下角 20px，宽 360，圆角 14，间距 8；新的在最下面，只有最旧的一条略淡
import { pauseToasts, resumeToasts, runToastAction, useToastItems, type ToastKind } from './toastStore';

const toasts = useToastItems();

const GLYPH: Record<ToastKind, string> = { success: '✓', error: '✕', warn: '!', info: 'i' };
</script>

<template>
  <div class="pn-layer pn-toaster" aria-live="polite" @mouseenter="pauseToasts" @mouseleave="resumeToasts">
    <TransitionGroup name="pn-toast">
      <div
        v-for="(toast, index) in toasts"
        :key="toast.id"
        :role="toast.kind === 'error' ? 'alert' : 'status'"
        class="pn-toast"
        :class="{ 'pn-toast--older': index === 0 && toasts.length > 1 }"
      >
        <span class="pn-toast__glyph" :class="`pn-toast__glyph--${toast.kind}`" aria-hidden="true">{{ GLYPH[toast.kind] }}</span>
        <div class="pn-toast__text">
          <span class="pn-toast__title">{{ toast.title }}</span>
          <span v-if="toast.desc" class="pn-toast__desc">{{ toast.desc }}</span>
        </div>
        <button v-if="toast.action" type="button" class="pn-toast__action" @click="runToastAction(toast.id)">
          {{ toast.action.label }}
        </button>
        <span v-if="toast.countdown" class="pn-toast__countdown" :style="{ animationDuration: `${toast.life}ms` }" />
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.pn-toaster {
  position: fixed;
  right: var(--pn-space-toast-edge);
  bottom: var(--pn-space-toast-edge);
  z-index: var(--pn-z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-8);
  pointer-events: none;
}

.pn-toast {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--pn-space-sidebar-x);
  width: var(--pn-size-toast);
  box-sizing: border-box;
  padding: var(--pn-space-12) var(--pn-space-12) var(--pn-space-12) var(--pn-space-toast-left);
  border-radius: var(--pn-radius-xl);
  background: var(--pn-elevated);
  box-shadow: var(--pn-e3);
  overflow: hidden;
  pointer-events: auto;
  transition: opacity var(--pn-dur-fast) var(--pn-ease-in);
}

.pn-toast--older { opacity: var(--pn-opacity-toast-older); }

.pn-toast__glyph {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-toast-glyph);
  height: var(--pn-size-toast-glyph);
  margin-top: var(--pn-space-1);
  border-radius: 50%;
  color: var(--pn-on-fill);
  font-size: var(--pn-text-caption);
  font-weight: var(--pn-weight-semibold);
}

.pn-toast__glyph--success { background: var(--pn-success-fill); }
.pn-toast__glyph--error { background: var(--pn-danger-fill); }
.pn-toast__glyph--warn { background: var(--pn-warning-fill); }
.pn-toast__glyph--info { background: var(--pn-unknown-fill); }

.pn-toast__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-1);
  min-width: 0;
}

.pn-toast__title { font-weight: var(--pn-weight-semibold); }

.pn-toast__desc {
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
  color: var(--pn-text2);
}

.pn-toast__action {
  flex: none;
  height: var(--pn-size-button-sm);
  padding: 0 var(--pn-space-button-sm-x);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-toast-action-bg);
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
  cursor: pointer;
}

.pn-toast__countdown {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: var(--pn-size-countdown);
  background: var(--pn-brand);
  transform-origin: left center;
  animation-name: pn-toast-countdown;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

.pn-toaster:hover .pn-toast__countdown { animation-play-state: paused; }

@keyframes pn-toast-countdown {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}

.pn-toast-enter-active { transition: opacity var(--pn-dur-standard) var(--pn-ease-in), transform var(--pn-dur-standard) var(--pn-ease-in); }
.pn-toast-leave-active { transition: opacity var(--pn-dur-fast) var(--pn-ease-out); }
.pn-toast-enter-from { opacity: 0; transform: translateY(var(--pn-space-8)); }
.pn-toast-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .pn-toast-enter-active { transition: opacity var(--pn-dur-fade-standard) var(--pn-ease-in); }
  .pn-toast-enter-from { transform: none; }
}
</style>
