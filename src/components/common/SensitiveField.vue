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
}>(), {
  modelValue: '',
  multiline: false,
  rows: 4,
  placeholder: '',
  autocomplete: 'new-password',
  readonly: false,
  disabled: false,
  inputClass: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  blur: [event: FocusEvent];
}>();

const revealed = ref(false);
let revealTimer: ReturnType<typeof setTimeout> | null = null;

const value = computed({
  get: () => props.modelValue ?? '',
  set: (next: string) => emit('update:modelValue', next),
});

const toggleLabel = computed(() => revealed.value ? '隐藏敏感内容' : '显示敏感内容');
const toggleIcon = computed(() => revealed.value ? 'pi pi-eye-slash' : 'pi pi-eye');

function clearRevealTimer(): void {
  if (revealTimer) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }
}

function conceal(): void {
  clearRevealTimer();
  revealed.value = false;
}

function revealTemporarily(): void {
  revealed.value = true;
  clearRevealTimer();
  revealTimer = setTimeout(() => {
    revealed.value = false;
    revealTimer = null;
  }, REVEAL_DURATION_MS);
}

function toggleReveal(): void {
  if (revealed.value) {
    conceal();
    return;
  }
  revealTemporarily();
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
    <Textarea
      v-if="multiline"
      v-model="value"
      :rows="rows"
      :placeholder="placeholder"
      :readonly="readonly"
      :disabled="disabled"
      :class="['sensitive-control', inputClass, { 'is-concealed': !revealed }]"
      @blur="handleBlur"
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
      :aria-pressed="revealed"
      :title="toggleLabel"
      :disabled="disabled || !value"
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

.is-multiline .sensitive-control {
  min-height: 92px;
  resize: vertical;
}

.is-concealed {
  -webkit-text-security: disc;
}

.sensitive-toggle {
  position: absolute;
  top: var(--space-xs-sm);
  right: var(--space-xs-sm);
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
