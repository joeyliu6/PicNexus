<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import type { LinkFormat } from '../../../../utils/linkFormatter';
import { LINK_FORMAT_OPTIONS, FORMAT_NAMES } from '../../../../utils/linkFormatter';
import { useFabCopyFormat } from './useFabCopyFormat';

const props = defineProps<{
  selectedCount: number;
}>();

const emit = defineEmits<{
  (e: 'copy', format: LinkFormat): void;
  (e: 'format-change', format: LinkFormat): void;
}>();

const { currentDefault, hasCustomTemplate } = useFabCopyFormat();

const selectedFormat = ref<LinkFormat>(currentDefault.value);
const isCopied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const tabOptions = computed(() =>
  LINK_FORMAT_OPTIONS.filter((opt) => opt.format !== 'custom' || hasCustomTemplate.value),
);

const TAB_LABELS: Record<LinkFormat, string> = {
  url: 'URL',
  markdown: 'MD',
  html: 'HTML',
  bbcode: 'BB',
  custom: '自定义',
};

const copyButtonLabel = computed(() =>
  selectedFormat.value === 'custom'
    ? `复制 ${props.selectedCount} 张链接`
    : `复制 ${props.selectedCount} 张 ${FORMAT_NAMES[selectedFormat.value]} 链接`,
);

function handleCopy(): void {
  emit('copy', selectedFormat.value);
  isCopied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    isCopied.value = false;
    copyTimer = null;
  }, 1500);
}

// 若已选格式被过滤掉（如自定义模板被删除），自动回退到当前默认格式
watch(tabOptions, (opts) => {
  if (!opts.some((o) => o.format === selectedFormat.value)) {
    selectedFormat.value = currentDefault.value;
  }
});

// 将当前选中格式上报给父组件，immediate 确保挂载后立即同步初始值
watch(selectedFormat, (format) => {
  emit('format-change', format);
}, { immediate: true });

onUnmounted(() => {
  if (copyTimer) clearTimeout(copyTimer);
});
</script>

<template>
  <div class="fab-copy-section">
    <!-- 格式 Tab 选择条 -->
    <div class="fab-format-tabs" role="tablist" aria-label="选择复制格式">
      <button
        v-for="opt in tabOptions"
        :key="opt.format"
        role="tab"
        :aria-selected="selectedFormat === opt.format"
        class="fab-fmt-tab"
        :class="{
          'is-active': selectedFormat === opt.format,
          'is-default': currentDefault === opt.format,
        }"
        @click.stop="selectedFormat = opt.format"
      >
        {{ TAB_LABELS[opt.format] }}
        <span
          v-if="currentDefault === opt.format"
          class="tab-default-dot"
          aria-label="当前默认"
        />
      </button>
    </div>

    <!-- 主复制按钮 -->
    <button
      class="fab-copy-btn"
      :class="{ 'fab-copy-btn--success': isCopied }"
      @click="handleCopy"
    >
      <i class="pi" :class="isCopied ? 'pi-check' : 'pi-copy'" />
      <span>{{ isCopied ? '已复制' : copyButtonLabel }}</span>
    </button>

  </div>
</template>

<style scoped>
.fab-copy-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-sm-md) var(--space-sm) var(--space-xs);
}

/* ---- Tab 条 ---- */
.fab-format-tabs {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-2xs);
  background: var(--bg-input);
  border-radius: var(--radius-md);
}

.fab-fmt-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-xs);
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  border-radius: calc(var(--radius-md) - var(--space-2xs));
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.fab-fmt-tab:hover:not(.is-active) {
  color: var(--text-secondary);
  background: var(--hover-overlay-subtle);
}

.fab-fmt-tab.is-active {
  background: var(--bg-card);
  color: var(--primary);
  font-weight: var(--weight-semibold);
  box-shadow: var(--shadow-xs);
}

/* 默认格式在 tab 旁的蓝色小圆点 */
.tab-default-dot {
  width: var(--space-xs);
  height: var(--space-xs);
  border-radius: var(--radius-full);
  background: currentcolor;
  flex-shrink: 0;
}

/* ---- 主复制按钮 ---- */
.fab-copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  width: 100%;
  height: 40px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--primary-alpha-15);
  color: var(--primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.fab-copy-btn:hover {
  filter: brightness(0.94);
}

.fab-copy-btn:active {
  filter: brightness(0.88);
}

.fab-copy-btn:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}

.fab-copy-btn i {
  font-size: var(--text-base);
}

.fab-copy-btn--success {
  background: var(--state-success-bg);
  color: var(--state-success-text);
  filter: none;
}

.fab-copy-btn--success:hover {
  filter: none;
}

</style>
