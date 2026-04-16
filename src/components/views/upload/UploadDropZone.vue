<script setup lang="ts">
import { ref, computed } from 'vue';
import ToggleSwitch from 'primevue/toggleswitch';
import Popover from 'primevue/popover';
import type PopoverType from 'primevue/popover';
import type { CompressionPreset } from '../../../config/types';

// ── 压缩预设展开/收起动效（精确宽度过渡，避免 max-width 跳跃）──
function onPresetEnter(el: Element) {
  const elem = el as HTMLElement;
  elem.style.width = '0';
  elem.style.opacity = '0';
  // 强制回流，确保起始状态生效
  void elem.offsetWidth;
  const targetWidth = elem.scrollWidth;
  elem.style.transition = 'width 260ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease';
  elem.style.width = `${targetWidth}px`;
  elem.style.opacity = '1';
}

function onPresetAfterEnter(el: Element) {
  const elem = el as HTMLElement;
  // 动画结束后释放固定宽度，允许自适应
  elem.style.width = '';
  elem.style.transition = '';
  elem.style.opacity = '';
}

function onPresetLeave(el: Element) {
  const elem = el as HTMLElement;
  elem.style.width = `${elem.offsetWidth}px`;
  elem.style.opacity = '1';
  void elem.offsetWidth;
  elem.style.transition = 'width 200ms cubic-bezier(0.4, 0, 1, 1), opacity 160ms ease';
  elem.style.width = '0';
  elem.style.opacity = '0';
}

function onPresetAfterLeave(el: Element) {
  const elem = el as HTMLElement;
  elem.style.width = '';
  elem.style.transition = '';
  elem.style.opacity = '';
}

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
      <Transition
        @enter="onPresetEnter"
        @after-enter="onPresetAfterEnter"
        @leave="onPresetLeave"
        @after-leave="onPresetAfterLeave"
      >
        <div v-if="compressionEnabled && activePreset" class="compress-preset-wrapper">
          <button
            class="compress-preset-trigger"
            v-tooltip.top="presetTooltip"
            @click.stop="togglePresetPopover"
          >
            {{ activePreset.name }}
            <i class="pi pi-chevron-down compress-preset-chevron" />
          </button>
        </div>
      </Transition>
      <button
        v-if="compressionEnabled"
        class="compress-settings-btn"
        v-tooltip.top="'压缩设置'"
        @click.stop="emit('go-compression-settings')"
      >
        <i class="pi pi-cog" />
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
  gap: var(--space-sm);
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
  transition: transform var(--duration-normal) var(--ease-standard);
  transform-origin: center;
}

/* 标签联动动效：压缩启用时轻微缩放 */
.compress-corner:has(.compress-preset-wrapper) .compress-label {
  animation: compress-label-bounce var(--duration-medium) var(--ease-standard);
}

@keyframes compress-label-bounce {
  0% { transform: scale(1); }
  40% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

/* 压缩设置快捷按钮 */
.compress-settings-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--duration-fast), background var(--duration-fast);
  padding: 0;
  font-size: var(--text-sm);
}

.compress-settings-btn:hover {
  color: var(--primary);
  background: var(--primary-alpha-10);
}

/* 预设按钮容器：宽度过渡层 */
.compress-preset-wrapper {
  display: inline-flex;
  overflow: hidden;
  white-space: nowrap;
}

/* 预设切换触发按钮 */
.compress-preset-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
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

/* 预设按钮展开/关闭动效（由 JS hook 控制，CSS 仅保留 overflow 裁剪） */

/* 预设 Popover 列表 */
.preset-popover-list {
  display: flex;
  flex-direction: column;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 2px 列表行间距，介于 --space-2xs(2px) 与 --space-xs(4px) 之间，无精确 token */
  gap: 2px;
  min-width: 0;
}

.preset-popover-item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px 上下内边距，介于 --space-2xs(2px) 与 --space-xs(4px) 之间，无精确 token */
  padding: 5px var(--space-sm);
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-xs);
  font-family: inherit;
  color: var(--text-primary);
  transition: background var(--duration-fast);
  white-space: nowrap;
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
  width: 12px;
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
  margin-left: var(--space-sm);
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
}
</style>
