<script setup lang="ts">
import { ref, computed } from 'vue';

interface Props {
  modelValue: string;
  placeholder?: string;
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '点击录入快捷键',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const isRecording = ref(false);
const inputRef = ref<HTMLDivElement | null>(null);

/** 将 Tauri 格式快捷键转为人类可读格式 */
const displayValue = computed(() => {
  if (isRecording.value) return '请按下快捷键...';
  if (!props.modelValue) return '';
  return props.modelValue
    .replace(/CommandOrControl/g, isMac() ? '⌘' : 'Ctrl')
    .replace(/Shift/g, isMac() ? '⇧' : 'Shift')
    .replace(/Alt/g, isMac() ? '⌥' : 'Alt')
    .replace(/\+/g, ' + ');
});

function isMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform: string } };
  return /mac/i.test(nav.userAgentData?.platform ?? navigator.platform ?? '');
}

function handleFocus() {
  isRecording.value = true;
}

function handleBlur() {
  isRecording.value = false;
}

function handleKeyDown(e: KeyboardEvent) {
  if (!isRecording.value) return;

  e.preventDefault();
  e.stopPropagation();

  // Escape 取消录入
  if (e.key === 'Escape') {
    isRecording.value = false;
    inputRef.value?.blur();
    return;
  }

  // Backspace/Delete 清空
  if (e.key === 'Backspace' || e.key === 'Delete') {
    emit('update:modelValue', '');
    isRecording.value = false;
    inputRef.value?.blur();
    return;
  }

  // 忽略单独的修饰键
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

  // 至少需要一个修饰键
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  // 获取主键
  let mainKey = e.key.toUpperCase();
  if (e.code.startsWith('Key')) {
    mainKey = e.code.replace('Key', '');
  } else if (e.code.startsWith('Digit')) {
    mainKey = e.code.replace('Digit', '');
  }

  parts.push(mainKey);
  const shortcut = parts.join('+');

  emit('update:modelValue', shortcut);
  isRecording.value = false;
  inputRef.value?.blur();
}
</script>

<template>
  <div
    ref="inputRef"
    class="shortcut-input"
    :class="{ recording: isRecording, empty: !modelValue }"
    tabindex="0"
    v-tooltip.top="isRecording ? undefined : '点击自定义录制快捷键'"
    @focus="handleFocus"
    @blur="handleBlur"
    @keydown="handleKeyDown"
  >
    <span v-if="displayValue" class="shortcut-text">{{ displayValue }}</span>
    <span v-else class="shortcut-placeholder">{{ placeholder }}</span>
  </div>
</template>

<style scoped>
.shortcut-input {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 160px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-card);
  cursor: pointer;
  outline: none;
  transition: all 0.2s;
  font-size: 13px;
  user-select: none;
}

.shortcut-input:hover {
  border-color: var(--primary);
}

.shortcut-input:focus {
  border-color: var(--primary);
  box-shadow: none;
}

.shortcut-input.recording {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-alpha-15);
}

.shortcut-text {
  color: var(--text-primary);
  font-weight: 500;
  font-family: 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  letter-spacing: 0.02em;
}

.shortcut-input.recording .shortcut-text {
  color: var(--primary);
  font-style: italic;
  font-weight: 400;
  font-family: inherit;
}

.shortcut-placeholder {
  color: var(--text-muted);
  font-size: 12px;
}
</style>
