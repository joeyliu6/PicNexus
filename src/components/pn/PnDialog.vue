<script setup lang="ts">
// 对话框（Dialogs.dc.html，交接说明 6.2）：宽 520、圆角 16、内边距 24/28、垂直居中；
// 左侧 40px 图标块（普通品牌蓝 / 警告琥珀 / 危险红），标题 17px + 12px 灰色上下文；按钮高 34。
// 打开时焦点落在 [data-autofocus] 元素，没有就落在第一个输入框，再没有就落在主按钮；Esc 关闭。
import { ref } from 'vue';
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import PnIcon from './PnIcon.vue';
import type { IconName } from './icons';

const open = defineModel<boolean>('open', { default: false });

const props = withDefaults(defineProps<{
  title: string;
  /** 标题下的一行灰色上下文（如「设置 › 备份与同步」） */
  eyebrow?: string;
  icon?: IconName;
  tone?: 'brand' | 'warning' | 'danger';
  /** 阻塞弹窗：不选就进不了应用，Esc 与点遮罩都不关 */
  blocking?: boolean;
}>(), {
  eyebrow: undefined,
  icon: 'info',
  tone: 'brand',
  blocking: false,
});

const emit = defineEmits<{ dismiss: [] }>();

const contentRef = ref<InstanceType<typeof DialogContent>>();

function onOpenAutoFocus(event: Event) {
  const root = (contentRef.value?.$el as HTMLElement | undefined) ?? null;
  const target = root?.querySelector<HTMLElement>('[data-autofocus]')
    ?? root?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled])')
    ?? root?.querySelector<HTMLElement>('.pn-button--primary:not(:disabled), .pn-button--danger:not(:disabled)');
  if (!target) return;
  event.preventDefault();
  target.focus();
}

function onDismissAttempt(event: Event) {
  if (props.blocking) {
    event.preventDefault();
    return;
  }
  emit('dismiss');
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="pn-dialog-overlay" />
      <DialogContent
        ref="contentRef"
        class="pn-layer pn-dialog"
        @open-auto-focus="onOpenAutoFocus"
        @escape-key-down="onDismissAttempt"
        @pointer-down-outside="onDismissAttempt"
        @interact-outside="(event: Event) => { if (blocking) event.preventDefault(); }"
      >
        <div class="pn-dialog__head">
          <span class="pn-dialog__icon" :class="`pn-dialog__icon--${tone}`">
            <PnIcon :name="icon" :size="20" :stroke="1.7" />
          </span>
          <div class="pn-dialog__heading">
            <DialogTitle class="pn-dialog__title">{{ title }}</DialogTitle>
            <span v-if="eyebrow" class="pn-dialog__eyebrow">{{ eyebrow }}</span>
          </div>
        </div>
        <DialogDescription as="div" class="pn-dialog__body">
          <slot />
        </DialogDescription>
        <div v-if="$slots.footer || $slots['footer-left']" class="pn-dialog__footer">
          <slot name="footer-left" />
          <div class="pn-dialog__spacer" />
          <slot name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<!-- 传送到 body，用不带 scoped 的类名；遮罩与进场动画是新手引导共用的，在 pn-base.css -->
<style>
.pn-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: var(--pn-z-dialog);
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-dialog-gap);
  width: var(--pn-size-dialog);
  max-width: calc(100vw - var(--pn-space-32));
  max-height: calc(100vh - var(--pn-space-56));
  box-sizing: border-box;
  padding: var(--pn-space-dialog-y) var(--pn-space-dialog-x);
  overflow-y: auto;
  border-radius: var(--pn-radius-dialog);
  background: var(--pn-elevated);
  box-shadow: var(--pn-e4);
  transform: translate(-50%, -50%);
}

.pn-dialog[data-state='open'] { animation: pn-dialog-in var(--pn-dur-expressive) var(--pn-ease-in); }

@media (prefers-reduced-motion: reduce) {
  .pn-dialog[data-state='open'] { animation-name: pn-dialog-fade; }
}

.pn-dialog__head {
  display: flex;
  align-items: center;
  gap: var(--pn-space-12);
}

.pn-dialog__icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-dialog-icon);
  height: var(--pn-size-dialog-icon);
  border-radius: var(--pn-radius-lg);
}

.pn-dialog__icon--brand { background: var(--pn-brand-soft); color: var(--pn-brand-text); }
.pn-dialog__icon--warning { background: var(--pn-warning-soft); color: var(--pn-warning); }
.pn-dialog__icon--danger { background: var(--pn-danger-soft); color: var(--pn-danger); }

.pn-dialog__heading { display: flex; flex-direction: column; min-width: 0; }

.pn-dialog__title {
  margin: 0;
  font-size: var(--pn-text-dialog-title);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-dialog-title);
}

.pn-dialog__eyebrow {
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
  color: var(--pn-text3);
}

.pn-dialog__body {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-dialog-gap);
  color: var(--pn-text2);
}

.pn-dialog__footer {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  margin-top: var(--pn-space-6);
}

.pn-dialog__spacer { flex: 1; }
</style>
