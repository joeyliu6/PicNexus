<script setup lang="ts">
import { ref, computed } from 'vue';
import ToggleSwitch from 'primevue/toggleswitch';
import Popover from 'primevue/popover';
import type PopoverType from 'primevue/popover';
import type { CompressionPreset } from '../../../config/types';

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

function handleCompressToggle(val: boolean) {
  emit('update:compressionEnabled', val);
}

function togglePresetPopover(event: Event) {
  presetPopoverRef.value?.toggle(event);
}

function selectPreset(presetId: string) {
  emit('update:activePresetId', presetId);
  presetPopoverRef.value?.hide();
}

function formatLabel(fmt: string): string {
  if (fmt === 'original') return '原格式';
  if (fmt === 'webp') return 'WebP';
  return 'JPEG';
}

function formatPresetDesc(p: CompressionPreset): string {
  return `${formatLabel(p.outputFormat)} · 质量 ${p.quality}`;
}

const presetTooltip = computed(() => {
  const p = props.activePreset;
  if (!p) return '';
  const skip = p.skipIfSmallerKB > 0 ? `跳过 ${p.skipIfSmallerKB} KB 以下` : '全部压缩';
  return `质量 ${p.quality} · ${formatLabel(p.outputFormat)} · ${skip}`;
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

    <!-- 压缩控件：右下角 -->
    <div class="compress-corner" @click.stop>
      <ToggleSwitch
        :modelValue="compressionEnabled"
        @update:modelValue="handleCompressToggle"
        class="compress-switch"
      />
      <span class="compress-label" v-tooltip.top="'更改将同步到全局设置'">压缩</span>
      <button
        v-if="compressionEnabled && activePreset"
        class="compress-preset-trigger"
        v-tooltip.top="presetTooltip"
        @click.stop="togglePresetPopover"
      >
        {{ activePreset.name }}
        <i class="pi pi-chevron-down compress-preset-chevron" />
      </button>
    </div>

    <!-- 预设切换 Popover -->
    <Popover ref="presetPopoverRef">
      <div class="preset-popover-list">
        <button
          v-for="preset in presets"
          :key="preset.id"
          class="preset-popover-item"
          :class="{ active: activePreset?.id === preset.id }"
          @click="selectPreset(preset.id)"
        >
          <i class="pi pi-check preset-check" />
          <span class="preset-item-name">{{ preset.name }}</span>
          <span class="preset-item-desc">{{ formatPresetDesc(preset) }}</span>
        </button>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
/* 拖拽区域 */
.drop-zone {
  position: relative;
  background: var(--bg-card);
  border: 2px dashed var(--border-subtle);
  border-radius: 12px;
  padding: 60px 40px;
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
  gap: 12px;
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
  gap: 8px;
  pointer-events: auto;
  cursor: default;
}

.compress-switch {
  transform: scale(0.8);
}

.compress-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  user-select: none;
}

/* 预设切换触发按钮 */
.compress-preset-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--duration-fast) ease;
  user-select: none;
}

.compress-preset-trigger:hover {
  border-color: var(--primary);
  color: var(--text-primary);
  background: var(--primary-alpha-5);
}

.compress-preset-chevron {
  font-size: var(--text-2xs);
  opacity: 0.6;
}

/* 预设 Popover 列表 */
.preset-popover-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 160px;
}

.preset-popover-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--text-xs);
  font-family: inherit;
  color: var(--text-primary);
  transition: background var(--duration-fast);
}

.preset-popover-item:hover {
  background: var(--primary-alpha-10);
}

.preset-popover-item.active {
  background: var(--primary-alpha-8);
}

.preset-check {
  font-size: var(--text-xs);
  color: var(--primary);
  width: 14px;
  flex-shrink: 0;
  opacity: 0;
}

.preset-popover-item.active .preset-check {
  opacity: 1;
}

.preset-item-name {
  font-weight: var(--weight-medium);
}

.preset-item-desc {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
}
</style>
