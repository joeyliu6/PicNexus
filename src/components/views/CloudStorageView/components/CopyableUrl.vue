<script setup lang="ts">
import { ref } from 'vue';
import Button from 'primevue/button';
import { useToast } from '@/composables/useToast';

const props = defineProps<{
  url: string;
}>();

const emit = defineEmits<{
  copy: [];
}>();

const toast = useToast();
const inputRef = ref<HTMLInputElement | null>(null);
const copied = ref(false);

const selectAll = () => {
  inputRef.value?.select();
};

const copy = async () => {
  try {
    await navigator.clipboard.writeText(props.url);
    copied.value = true;
    toast.success('已复制', 'URL 已复制到剪贴板');
    emit('copy');
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    toast.error('复制失败', '请手动复制 URL');
  }
};
</script>

<template>
  <div class="copyable-url">
    <input
      ref="inputRef"
      type="text"
      :value="url"
      readonly
      class="url-input"
      @click="selectAll"
    />
    <Button
      :icon="copied ? 'pi pi-check' : 'pi pi-copy'"
      text
      rounded
      size="small"
      class="copy-btn"
      :class="{ copied }"
      @click="copy"
      v-tooltip.left="copied ? '已复制' : '复制'"
    />
  </div>
</template>

<style scoped>
.copyable-url {
  display: flex;
  align-items: center;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  overflow: hidden;
  transition: all 0.2s ease;
}

.copyable-url:hover {
  border-color: rgba(59, 130, 246, 0.3);
  background: rgba(0, 0, 0, 0.3);
}

.copyable-url:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.url-input {
  flex: 1;
  padding: 12px 14px;
  background: transparent;
  border: none;
  outline: none;
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  color: var(--text-secondary);
  min-width: 0;
}

.url-input:focus {
  color: var(--text-primary);
}

.url-input::selection {
  background: rgba(59, 130, 246, 0.3);
}

.copy-btn {
  flex-shrink: 0;
  margin-right: 6px;
  color: var(--text-muted);
  transition: all 0.2s ease;
}

.copy-btn:hover {
  color: var(--primary);
  transform: scale(1.05);
}

.copy-btn.copied {
  color: var(--success);
}
</style>
