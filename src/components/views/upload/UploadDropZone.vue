<script setup lang="ts">
import { ref, computed } from 'vue';
import Popover from 'primevue/popover';
import type PopoverType from 'primevue/popover';
import type { CompressionPreset } from '../../../config/types';
import { FORMAT_LABEL } from '../../../composables/settings/useCompressionPresets';
import CompressPopoverMenu from './CompressPopoverMenu.vue';

interface Props {
  isDragging: boolean;
  isPasting: boolean;
  isDownloading?: boolean;
  compressionEnabled: boolean;
  activePreset: CompressionPreset | null;
  presets: CompressionPreset[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  click: [];
  paste: [];
  'url-download': [];
  'drag-enter': [event: DragEvent];
  'drag-over': [event: DragEvent];
  'drag-leave': [event: DragEvent];
  'drop': [event: DragEvent];
  'update:compressionEnabled': [enabled: boolean];
  'update:activePresetId': [presetId: string];
  'go-compression-settings': [];
}>();

const presetPopoverRef = ref<InstanceType<typeof PopoverType> | null>(null);

function handleClick() {
  emit('click');
}

function handlePaste(e: Event) {
  e.stopPropagation();
  emit('paste');
}

function handleUrlDownload(e: Event) {
  e.stopPropagation();
  emit('url-download');
}

function handleChipMainClick() {
  // 切换开关时顺手收起 popover（如开着的话），避免状态切换后弹窗与新状态不匹配
  presetPopoverRef.value?.hide();
  emit('update:compressionEnabled', !props.compressionEnabled);
}

function toggleChipPopover(event: Event) {
  presetPopoverRef.value?.toggle(event);
}

function selectPreset(presetId: string) {
  // 关闭态点击预设：自动启用压缩 + 选中（一步到位，避免"点了没反应"）
  if (!props.compressionEnabled) {
    emit('update:compressionEnabled', true);
  }
  emit('update:activePresetId', presetId);
  presetPopoverRef.value?.hide();
}

function handleGoSettings() {
  presetPopoverRef.value?.hide();
  emit('go-compression-settings');
}

const chipTooltip = computed(() => {
  if (!props.compressionEnabled) return '点击启用压缩（当前已关）';
  const p = props.activePreset;
  if (!p) return '点击切换压缩预设';
  const skip = p.skipIfSmallerKB > 0 ? `跳过 ${p.skipIfSmallerKB} KB 以下` : '全部压缩';
  return `质量 ${p.quality} · ${FORMAT_LABEL[p.outputFormat] ?? p.outputFormat} · ${skip}`;
});

// 后缀文案：关闭态显示「已关」，开启态显示当前预设名；空字符串则后缀整体收起
const chipSuffixText = computed(() => {
  if (!props.compressionEnabled) return '已关';
  return props.activePreset?.name ?? '';
});
</script>

<template>
  <div
    class="drop-zone"
    :class="{ dragging: isDragging }"
    @click="handleClick"
    @dragenter="emit('drag-enter', $event)"
    @dragover="emit('drag-over', $event)"
    @dragleave="emit('drag-leave', $event)"
    @drop="emit('drop', $event)"
  >
    <div class="drop-message">
      <i class="pi pi-cloud-upload drop-icon"></i>
      <p class="drop-text">拖拽图片到此处上传</p>
      <span class="drop-hint">
        或点击选择文件，或<button
          class="paste-link"
          :disabled="isPasting"
          @click="handlePaste"
          v-tooltip.top="'快捷键: Ctrl+V'"
        >{{ isPasting ? '正在粘贴...' : '从剪贴板粘贴' }}</button>，或<button
          class="paste-link"
          :disabled="isDownloading"
          @click="handleUrlDownload"
        >{{ isDownloading ? '正在下载...' : '从 URL 下载' }}</button>
      </span>
    </div>

    <!-- 压缩控件：右下角双区 Chip（主区 toggle + 箭头开 popover） -->
    <div class="compress-corner" @click.stop>
      <div
        class="compress-chip"
        :class="{ 'compress-chip-active': compressionEnabled }"
        v-ripple
      >
        <button
          class="chip-main"
          :aria-label="compressionEnabled ? '关闭压缩' : '启用压缩'"
          v-tooltip.top="chipTooltip"
          @click="handleChipMainClick"
        >
          <i
            :class="['pi', compressionEnabled ? 'pi-bolt' : 'pi-circle']"
            class="compress-chip-icon"
          />
          <span class="compress-chip-label">压缩</span>
          <!-- 后缀：用 grid 0fr/1fr 技巧实现「展开/收起」时宽度的丝滑动画 -->
          <span
            class="compress-chip-suffix"
            :class="{ 'is-empty': !chipSuffixText }"
          >
            <span class="compress-chip-suffix-inner">
              <span class="compress-chip-dot">·</span>
              <span class="compress-chip-preset">{{ chipSuffixText }}</span>
            </span>
          </span>
        </button>
        <span class="chip-divider" aria-hidden="true" />
        <button
          class="chip-trigger"
          aria-label="展开压缩选项"
          v-tooltip.top="'切换预设 / 跳转设置'"
          @click="toggleChipPopover"
        >
          <i class="pi pi-chevron-down compress-chip-chevron" />
        </button>
      </div>
    </div>

    <!-- 压缩控制 Popover：预设列表 + 设置入口（子组件） -->
    <Popover ref="presetPopoverRef">
      <CompressPopoverMenu
        :presets="presets"
        :active-preset="activePreset"
        :compression-enabled="compressionEnabled"
        @select-preset="selectPreset"
        @go-settings="handleGoSettings"
      />
    </Popover>
  </div>
</template>

<style scoped>
/* 拖拽区域 */
.drop-zone {
  position: relative;
  background: var(--bg-card);
  border: 2px dashed var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-5xl) var(--space-3xl);
  text-align: center;
  cursor: pointer;
  transition: all var(--duration-medium) ease;
}

.drop-zone:hover {
  border-color: var(--primary);
  background: var(--primary-alpha-5);
}

.drop-zone.dragging {
  border-color: var(--primary);
  background: var(--primary-alpha-10);
  border-style: solid;
}

.drop-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  pointer-events: none;
}

.drop-icon {
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 大号空状态图标，现有 token 最大 48px（--text-5xl），此处 56px 为特殊设计 */
  font-size: 3.5rem;
  color: var(--primary);
  opacity: 0.8;
}

.drop-text {
  font-size: var(--text-xl);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  margin: 0;
}

.drop-hint {
  font-size: var(--text-lg);
  color: var(--text-secondary);
}

/* 剪贴板粘贴链接 */
.paste-link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: inherit;
  color: var(--primary);
  cursor: pointer;
  transition: color var(--duration-normal) ease;
  pointer-events: auto;
}

.paste-link:hover:not(:disabled) {
  color: var(--primary-hover, #3b82f6);
  text-decoration: underline;
}

.paste-link:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

/* 压缩控件 - 右下角 */
.compress-corner {
  position: absolute;
  bottom: 12px;
  right: 16px;
  display: flex;
  align-items: center;
  pointer-events: auto;
  cursor: default;
}

/* 压缩状态 Chip 容器（边框+底色由容器统一负责，内部分主区+箭头两段） */
.compress-chip {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: var(--text-xs);
  overflow: hidden;
  transition: color var(--duration-fast) ease,
    background var(--duration-fast) ease,
    border-color var(--duration-fast) ease;
  user-select: none;
}

.compress-chip:hover {
  border-color: var(--primary);
  color: var(--text-primary);
}

/* 启用态：蓝色调 */
.compress-chip-active {
  border-color: var(--primary-alpha-30);
  background: var(--primary-alpha-10);
  color: var(--text-primary);
}

.compress-chip-active:hover {
  border-color: var(--primary);
}

/* 主区按钮（图标 + 标签 + 可选预设名）：点击 toggle */
.chip-main {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-sm);
  border: none;
  background: transparent;
  color: inherit;
  font-size: inherit;
  font-family: inherit;
  cursor: pointer;
  transition: background var(--duration-fast) ease;
}

.chip-main:hover {
  background: var(--primary-alpha-5);
}

.compress-chip-active .chip-main:hover {
  background: var(--primary-alpha-15);
}

/* 主区与箭头之间的竖向分隔线 */
.chip-divider {
  width: 1px;
  background: var(--border-subtle);
  align-self: stretch;
  transition: background var(--duration-fast) ease;
}

.compress-chip-active .chip-divider {
  background: var(--primary-alpha-30);
}

/* 箭头按钮（点击弹 Popover） */
.chip-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-xs);
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background var(--duration-fast) ease;
}

.chip-trigger:hover {
  background: var(--primary-alpha-5);
}

.compress-chip-active .chip-trigger:hover {
  background: var(--primary-alpha-15);
}

.compress-chip-icon {
  font-size: var(--text-xs);
  color: var(--text-muted);
  transition: color var(--duration-fast) ease;
}

.compress-chip-active .compress-chip-icon {
  color: var(--primary);
}

.compress-chip-label {
  font-weight: var(--weight-medium);
}

.compress-chip-dot {
  color: var(--text-muted);
  opacity: 0.5;
}

.compress-chip-preset {
  color: var(--text-secondary);
}

.compress-chip-active .compress-chip-preset {
  color: var(--text-primary);
}

/* 后缀容器：grid 0fr/1fr 技巧让宽度变化丝滑过渡 */
.compress-chip-suffix {
  display: inline-grid;
  grid-template-columns: 1fr;
  transition: grid-template-columns var(--duration-normal) var(--ease-standard);
}

.compress-chip-suffix.is-empty {
  grid-template-columns: 0fr;
}

.compress-chip-suffix-inner {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.compress-chip-chevron {
  font-size: var(--text-2xs);
  opacity: 0.6;
}
</style>
