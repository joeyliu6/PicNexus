<script setup lang="ts">
// 输入框（Controls.dc.html）：高 32，对话框内 34；聚焦蓝框 + 3px 浅蓝外环；出错红框
import { ref } from 'vue';

const model = defineModel<string>({ default: '' });

withDefaults(defineProps<{
  size?: 'md' | 'dialog';
  placeholder?: string;
  type?: 'text' | 'password' | 'search' | 'url';
  invalid?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  /** 链接、路径、密钥用等宽字 */
  mono?: boolean;
  id?: string;
  autocomplete?: string;
}>(), {
  size: 'md',
  placeholder: '',
  type: 'text',
  invalid: false,
  disabled: false,
  readonly: false,
  mono: false,
  id: undefined,
  autocomplete: 'off',
});

defineEmits<{ blur: [event: FocusEvent]; focus: [event: FocusEvent]; keydown: [event: KeyboardEvent] }>();

const inputRef = ref<HTMLInputElement>();
defineExpose({ focus: () => inputRef.value?.focus(), select: () => inputRef.value?.select() });
</script>

<template>
  <label
    class="pn-input"
    :class="{
      'pn-input--dialog': size === 'dialog',
      'pn-input--invalid': invalid,
      'pn-input--disabled': disabled,
      'pn-input--mono': mono,
    }"
  >
    <slot name="prefix" />
    <input
      :id="id"
      ref="inputRef"
      v-model="model"
      class="pn-input__field"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :autocomplete="autocomplete"
      :aria-invalid="invalid || undefined"
      spellcheck="false"
      @blur="$emit('blur', $event)"
      @focus="$emit('focus', $event)"
      @keydown="$emit('keydown', $event)"
    >
    <slot name="suffix" />
  </label>
</template>

<style scoped>
.pn-input {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  height: var(--pn-size-control);
  box-sizing: border-box;
  padding: 0 var(--pn-space-input-x);
  border-radius: var(--pn-radius-md);
  background: var(--pn-field);
  box-shadow: inset 0 0 0 1px var(--pn-border-strong);
  color: var(--pn-text3);
  transition: box-shadow var(--pn-dur-instant) var(--pn-ease-in);
}

.pn-input--dialog { height: var(--pn-size-control-dialog); }

.pn-input:focus-within {
  box-shadow: inset 0 0 0 1px var(--pn-brand), 0 0 0 var(--pn-ring-soft-width) var(--pn-ring-soft);
}

.pn-input--invalid,
.pn-input--invalid:focus-within { box-shadow: inset 0 0 0 1px var(--pn-danger-fill); }

.pn-input--disabled {
  background: var(--pn-subtle);
  box-shadow: inset 0 0 0 1px var(--pn-border);
}

.pn-input__field {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-body);
}

.pn-input__field::placeholder { color: var(--pn-text3); opacity: 1; }
.pn-input__field:disabled { color: var(--pn-disabled); }

.pn-input--mono .pn-input__field {
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-mono);
}

/* 外层框已经画了焦点外环，输入框本身不再叠一圈 */
.pn-input__field:focus-visible { outline: none; }
</style>
