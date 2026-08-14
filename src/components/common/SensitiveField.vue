<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';

const REVEAL_DURATION_MS = 15_000;

const props = withDefaults(defineProps<{
  modelValue?: string | null;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  autocomplete?: string;
  readonly?: boolean;
  disabled?: boolean;
  inputClass?: string;
  /**
   * 输入框为空、但后台存着密文时置 true
   *
   * Why 需要这个标记：图床 WebDAV 这类"密文常驻、明文按需"的字段，`modelValue`
   * 永远是空的（明文不进 formData），单看值分不清「存着呢」还是「没填过」。
   * 少了它，眼睛按钮会因为 `!value` 一直禁用，用户连确认一下的路都没有。
   */
  hasStoredValue?: boolean;
  /** 点眼睛时按需取明文；不提供则 `hasStoredValue` 只用于展示，不可查看 */
  revealStored?: (() => Promise<string>) | null;
}>(), {
  modelValue: '',
  multiline: false,
  rows: 4,
  placeholder: '',
  autocomplete: 'new-password',
  readonly: false,
  disabled: false,
  inputClass: '',
  hasStoredValue: false,
  revealStored: null,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  blur: [event: FocusEvent];
  revealError: [error: unknown];
}>();

const revealed = ref(false);
/**
 * 临时揭示的已保存明文
 *
 * Why 不塞进 modelValue：那会让"查看"变成"输入"——父组件失焦时会把它当成用户
 * 新填的密码重新加密写回。这里单独存，且展示态是只读的，明文只进 DOM 不进数据流。
 */
const storedPlaintext = ref<string | null>(null);
let revealTimer: ReturnType<typeof setTimeout> | null = null;

const value = computed({
  get: () => props.modelValue ?? '',
  set: (next: string) => emit('update:modelValue', next),
});

/** 展示已保存明文的只读态：此时输入框不可编辑，再点一次眼睛回到可编辑空态 */
const showingStored = computed(() => storedPlaintext.value !== null);
const isRevealed = computed(() => revealed.value || showingStored.value);
const canToggle = computed(() =>
  !props.disabled && (!!value.value || (props.hasStoredValue && !!props.revealStored))
);

const toggleLabel = computed(() => isRevealed.value ? '隐藏敏感内容' : '显示敏感内容');
const toggleIcon = computed(() => isRevealed.value ? 'pi pi-eye-slash' : 'pi pi-eye');

function clearRevealTimer(): void {
  if (revealTimer) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }
}

function conceal(): void {
  clearRevealTimer();
  revealed.value = false;
  storedPlaintext.value = null;
}

function startConcealTimer(): void {
  clearRevealTimer();
  revealTimer = setTimeout(conceal, REVEAL_DURATION_MS);
}

function revealTemporarily(): void {
  revealed.value = true;
  startConcealTimer();
}

async function revealStoredTemporarily(): Promise<void> {
  if (!props.revealStored) return;
  try {
    storedPlaintext.value = await props.revealStored();
    startConcealTimer();
  } catch (error) {
    storedPlaintext.value = null;
    emit('revealError', error);
  }
}

function toggleReveal(): void {
  if (isRevealed.value) {
    conceal();
    return;
  }
  // 框里有用户正在输入的内容 → 切明文；框是空的但存着密文 → 按需解密
  if (value.value) {
    revealTemporarily();
    return;
  }
  void revealStoredTemporarily();
}

function handleBlur(event: FocusEvent): void {
  conceal();
  emit('blur', event);
}

onBeforeUnmount(conceal);

defineExpose({
  conceal,
});
</script>

<template>
  <div class="sensitive-field" :class="{ 'is-multiline': multiline }">
    <!-- 已保存明文的只读展示态（多行）：不绑 v-model，明文只进 DOM 不进数据流 -->
    <Textarea
      v-if="multiline && showingStored"
      :modelValue="storedPlaintext ?? ''"
      :rows="rows"
      readonly
      :disabled="disabled"
      :class="['sensitive-control', inputClass]"
      @keydown.esc="conceal"
    />
    <Textarea
      v-else-if="multiline"
      v-model="value"
      :rows="rows"
      :placeholder="placeholder"
      :readonly="readonly"
      :disabled="disabled"
      :class="['sensitive-control', inputClass, { 'is-concealed': !revealed }]"
      @blur="handleBlur"
      @keydown.esc="conceal"
    />
    <!-- 已保存明文的只读展示态（单行）：同样不绑 v-model、不挂 blur -->
    <InputText
      v-else-if="showingStored"
      :modelValue="storedPlaintext ?? ''"
      type="text"
      readonly
      :disabled="disabled"
      :class="['sensitive-control', inputClass]"
      @keydown.esc="conceal"
    />
    <InputText
      v-else
      v-model="value"
      :type="revealed ? 'text' : 'password'"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :readonly="readonly"
      :disabled="disabled"
      :class="['sensitive-control', inputClass]"
      @blur="handleBlur"
      @keydown.esc="conceal"
    />
    <button
      type="button"
      class="sensitive-toggle"
      :aria-label="toggleLabel"
      :aria-pressed="isRevealed"
      :title="toggleLabel"
      :disabled="!canToggle"
      @mousedown.prevent
      @click="toggleReveal"
    >
      <i :class="toggleIcon" aria-hidden="true"></i>
    </button>
  </div>
</template>

<style scoped>
.sensitive-field {
  position: relative;
  width: 100%;
}

.sensitive-control {
  width: 100%;
  padding-right: var(--space-3xl);
}

.sensitive-control::-ms-reveal,
.sensitive-control::-ms-clear {
  display: none;
}

.is-multiline .sensitive-control {
  min-height: 92px;
  resize: vertical;
}

.is-concealed {
  -webkit-text-security: disc;
}

.sensitive-toggle {
  position: absolute;
  top: 50%;
  right: var(--space-xs-sm);
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.is-multiline .sensitive-toggle {
  top: var(--space-xs-sm);
  transform: none;
}

.sensitive-toggle:hover:not(:disabled),
.sensitive-toggle:focus-visible:not(:disabled) {
  background: var(--hover-overlay-subtle);
  color: var(--text-primary);
}

.sensitive-toggle:disabled {
  cursor: default;
  opacity: 0.45;
}

.sensitive-toggle i {
  font-size: var(--text-sm);
}
</style>
