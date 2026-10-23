<script setup lang="ts">
// 投放区下面一行（HomeScreen.dc.html H11–H13）：上传到 / 复制为 / 压缩，各自展开一个浮层。
// 「复制为」只列格式名，选中即改默认格式并重新复制焦点卡；「压缩」是方案名 + 一行参数，「关」= 原图。
import { computed } from 'vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuItem from '@/components/pn/PnMenuItem.vue';
import PnMenuRadioGroup from '@/components/pn/PnMenuRadioGroup.vue';
import PnMenuSeparator from '@/components/pn/PnMenuSeparator.vue';
import PnPopover from '@/components/pn/PnPopover.vue';
import type { CompressionPreset, ImageCompressionConfig } from '@/config/types';
import type { UploadHost } from '@/composables/upload/useUploadController';
import { describeCompressionPreset } from '@/utils/compressionPresetText';
import { FORMAT_NAMES, type LinkFormat } from '@/utils/linkFormatter';
import UploadToPanel from './UploadToPanel.vue';
import { vOverflowTitle } from '@/utils/overflowTitle';

const props = defineProps<{
  hosts: readonly UploadHost[];
  format: LinkFormat;
  copyFrom?: string;
  compression: ImageCompressionConfig;
  activePreset: CompressionPreset;
}>();

const emit = defineEmits<{
  toggleHost: [hostId: string];
  setCopyFrom: [hostId: string | undefined];
  setFormat: [format: LinkFormat];
  setCompression: [presetId: string | null];
  manageHosts: [];
  editTemplate: [];
  compressionSettings: [];
  relogin: [hostId: string];
}>();

const OFF = '__off__';

const selectedNames = computed(() => props.hosts.filter((h) => h.selected).map((h) => h.name));
const uploadToLabel = computed(() => (selectedNames.value.length ? selectedNames.value.join('、') : '未选择'));
/** 勾选的图床里有暂时传不上的：图标旁的悬停说明和读屏都说清是哪个、为什么（说法同「上传到」浮层） */
const warningText = computed(() => props.hosts
  .filter((h) => h.selected && h.warning)
  .map((h) => `${h.name}${h.cookieLogin ? h.warning : `：${h.warning}`}，暂时传不上`)
  .join('；'));

const formatOptions = (['url', 'markdown', 'html', 'bbcode', 'custom'] as const).map((value) => ({ value, label: FORMAT_NAMES[value] }));
const formatModel = computed({ get: () => props.format, set: (value: LinkFormat) => emit('setFormat', value) });

const compressionOptions = computed(() => [
  { value: OFF, label: '关', description: '原样上传' },
  ...(props.compression.presets ?? []).map((preset) => ({ value: preset.id, label: preset.name, description: describeCompressionPreset(preset) })),
]);
const compressionModel = computed({
  get: () => (props.compression.enabled ? props.activePreset.id : OFF),
  set: (value: string) => emit('setCompression', value === OFF ? null : value),
});
const compressionLabel = computed(() => (props.compression.enabled ? props.activePreset.name : '关'));
</script>

<template>
  <div class="home-options">
    <PnPopover align="start" label="上传到">
      <template #trigger>
        <button type="button" class="home-options__trigger" aria-haspopup="dialog" :title="warningText || undefined">
          <span class="home-options__key">上传到</span>
          <span v-overflow-title class="home-options__value">{{ uploadToLabel }}</span>
          <PnIcon v-if="warningText" name="warning" :size="13" :stroke="1.8" class="home-options__warn" />
          <PnIcon name="chevronDown" :size="13" :stroke="1.8" class="home-options__key" />
        </button>
      </template>
      <UploadToPanel
        :hosts="hosts"
        :copy-from="copyFrom"
        @toggle="emit('toggleHost', $event)"
        @set-copy-from="emit('setCopyFrom', $event)"
        @manage="emit('manageHosts')"
        @relogin="emit('relogin', $event)"
      />
    </PnPopover>

    <PnMenu align="start" :width="200">
      <template #trigger>
        <button type="button" class="home-options__trigger" aria-haspopup="menu">
          <span class="home-options__key">复制为</span>
          {{ FORMAT_NAMES[format] }}
          <PnIcon name="chevronDown" :size="13" :stroke="1.8" class="home-options__key" />
        </button>
      </template>
      <PnMenuRadioGroup v-model="formatModel" :options="formatOptions" />
      <PnMenuSeparator />
      <PnMenuItem class="pn-menu__item--indent" @select="emit('editTemplate')">编辑自定义模板…</PnMenuItem>
    </PnMenu>

    <PnMenu align="start" :width="260">
      <template #trigger>
        <button type="button" class="home-options__trigger" aria-haspopup="menu">
          <span class="home-options__key">压缩</span>
          {{ compressionLabel }}
          <PnIcon name="chevronDown" :size="13" :stroke="1.8" class="home-options__key" />
        </button>
      </template>
      <PnMenuRadioGroup v-model="compressionModel" :options="compressionOptions" />
      <PnMenuSeparator />
      <PnMenuItem class="pn-menu__item--indent" @select="emit('compressionSettings')">压缩设置与预览…</PnMenuItem>
    </PnMenu>
  </div>
</template>

<style scoped>
.home-options {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  margin-top: var(--pn-space-8);
  min-width: 0;
}

.home-options__trigger {
  display: flex;
  align-items: center;
  gap: var(--pn-space-6);
  min-width: 0;
  height: var(--pn-size-button-md);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.home-options__trigger:hover,
.home-options__trigger[data-state='open'] { background: var(--pn-selected); }
.home-options__trigger:active { background: var(--pn-ghost-press); }

.home-options__key { flex: none; color: var(--pn-text3); }
.home-options__value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-options__warn { flex: none; color: var(--pn-warning); }
</style>
