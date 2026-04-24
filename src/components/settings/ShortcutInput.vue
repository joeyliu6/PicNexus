<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';

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

// 按键拒绝提示（仅在录制中显示一次性文案）
const rejectHint = ref(false);
let rejectHintTimer: ReturnType<typeof setTimeout> | null = null;

// Tauri accelerator 支持的主键白名单：非字母/数字/F 键的 code → Tauri token
// 参考 tauri-apps/global-hotkey 的 Code 枚举命名
const CODE_TO_TOKEN: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: 'Minus', Equal: 'Equal',
  BracketLeft: 'BracketLeft', BracketRight: 'BracketRight', Backslash: 'Backslash',
  Semicolon: 'Semicolon', Quote: 'Quote',
  Comma: 'Comma', Period: 'Period', Slash: 'Slash', Backquote: 'Backquote',
};

function codeToAcceleratorToken(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return CODE_TO_TOKEN[code] ?? null;
}

function showRejectHint() {
  rejectHint.value = true;
  if (rejectHintTimer) clearTimeout(rejectHintTimer);
  rejectHintTimer = setTimeout(() => { rejectHint.value = false; }, 1600);
}

/** 将 Tauri 格式快捷键转为人类可读格式 */
const displayValue = computed(() => {
  if (isRecording.value) {
    return rejectHint.value ? '按键不支持，请用字母/数字/F 键等' : '请按下快捷键...';
  }
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
  rejectHint.value = false;
  if (rejectHintTimer) { clearTimeout(rejectHintTimer); rejectHintTimer = null; }
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

  // 主键白名单校验：非白名单键（如 =、/、;、方向键已映射为 Up/Down/…）直接拒绝
  // Why: 旧逻辑用 e.key.toUpperCase() 会把 = / ; 等字面量塞进 accelerator,
  //   Tauri globalShortcut 无法识别，用户看似录入成功但注册时静默失败
  const mainKey = codeToAcceleratorToken(e.code);
  if (!mainKey) {
    showRejectHint();
    return;
  }

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  parts.push(mainKey);
  const shortcut = parts.join('+');

  emit('update:modelValue', shortcut);
  isRecording.value = false;
  inputRef.value?.blur();
}

onUnmounted(() => {
  if (rejectHintTimer) { clearTimeout(rejectHintTimer); rejectHintTimer = null; }
});
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
  padding: 0 var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
  background: var(--bg-card);
  cursor: pointer;
  outline: none;
  transition: all var(--duration-normal);
  font-size: var(--text-sm);
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
  font-weight: var(--weight-medium);
  font-family: 'Fira Code', 'Cascadia Code', monospace;
  font-size: var(--text-xs);
  letter-spacing: 0.02em;
}

.shortcut-input.recording .shortcut-text {
  color: var(--primary);
  font-style: italic;
  font-weight: var(--weight-regular);
  font-family: inherit;
}

.shortcut-placeholder {
  color: var(--text-muted);
  font-size: var(--text-xs);
}
</style>
