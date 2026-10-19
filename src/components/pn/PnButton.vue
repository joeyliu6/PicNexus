<script setup lang="ts">
// 按钮（Controls.dc.html）
// primary 主按钮：每页最多一个；soft 白色浮起按钮：次要操作的首选；secondary 白底描边（较早定稿的页面在用）；
// ghost 文字按钮；danger 危险按钮（按钮文字写动作，不写「确定」）。
// 高度：sm 28 / md 30 / lg 32（默认）/ dialog 34（对话框内）。
withDefaults(defineProps<{
  variant?: 'primary' | 'soft' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'dialog';
  type?: 'button' | 'submit';
  disabled?: boolean;
  /** 加载中：按钮原地变成「正在…」并禁用，文字由调用方给 */
  loading?: boolean;
}>(), {
  variant: 'soft',
  size: 'lg',
  type: 'button',
  disabled: false,
  loading: false,
});
</script>

<template>
  <button
    :type="type"
    class="pn-button"
    :class="[`pn-button--${variant}`, `pn-button--${size}`]"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <svg v-if="loading" class="pn-button__spinner" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2" />
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="10 37.7" stroke-linecap="round" />
    </svg>
    <slot />
  </button>
</template>

<style scoped>
.pn-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: var(--pn-space-6);
  height: var(--pn-size-button-lg);
  padding: 0 var(--pn-space-button-x);
  border: 0;
  border-radius: var(--pn-radius-md);
  font: inherit;
  font-size: var(--pn-text-body);
  font-weight: var(--pn-weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.pn-button:disabled {
  cursor: default;
  opacity: var(--pn-opacity-disabled);
}

.pn-button[aria-busy='true'] { opacity: 1; }

.pn-button--sm {
  height: var(--pn-size-button-sm);
  padding: 0 var(--pn-space-button-sm-x);
  border-radius: var(--pn-radius-button-sm);
  font-size: var(--pn-text-footnote);
}

.pn-button--md {
  height: var(--pn-size-button-md);
  padding: 0 var(--pn-space-12);
  border-radius: var(--pn-radius-button-sm);
}

.pn-button--dialog {
  height: var(--pn-size-button-dialog);
  padding: 0 var(--pn-space-button-dialog-x);
}

.pn-button--primary { background: var(--pn-button); color: var(--pn-on-fill); }
.pn-button--primary:not(:disabled):hover { background: var(--pn-button-hover); }
.pn-button--primary:not(:disabled):active { background: var(--pn-button-press); }

.pn-button--soft { background: var(--pn-btn-soft); box-shadow: var(--pn-btn-soft-shadow); color: var(--pn-text1); }
.pn-button--soft:not(:disabled):hover { background: var(--pn-btn-soft-hover); }

.pn-button--secondary { background: var(--pn-secondary-bg); box-shadow: var(--pn-secondary-ring); color: var(--pn-text1); }
.pn-button--secondary:not(:disabled):hover { background: var(--pn-secondary-hover); }
.pn-button--secondary:not(:disabled):active { background: var(--pn-secondary-press); }

.pn-button--ghost { background: transparent; color: var(--pn-text1); }
.pn-button--ghost:not(:disabled):hover { background: var(--pn-ghost-hover); }
.pn-button--ghost:not(:disabled):active { background: var(--pn-ghost-press); }

.pn-button--danger { background: var(--pn-danger-button); color: var(--pn-on-fill); }
.pn-button--danger:not(:disabled):hover { background: var(--pn-danger-button-hover); }
.pn-button--danger:not(:disabled):active { background: var(--pn-danger-button-press); }

.pn-button__spinner { animation: pn-spin var(--pn-dur-spin) linear infinite; }


@media (prefers-reduced-motion: reduce) {
  .pn-button__spinner { animation: none; }
}
</style>
