<script setup lang="ts">
// 上传与链接（S02 / K10）：默认复制为（与首页「复制为」是同一个设置）、自定义模板、自动复制、自动上传剪贴板；
// 图片压缩：小标题旁「上传前压缩」总开关，最多 5 个方案单选当前方案，「编辑」改参数，「压缩预览…」左右对比。
import { computed, ref } from 'vue';
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnSegmented, { type PnSegment } from '@/components/pn/PnSegmented.vue';
import PnSwitch from '@/components/pn/PnSwitch.vue';
import CompressionPreviewDialog from '@/components/dialogs/CompressionPreviewDialog.vue';
import { DEFAULT_CONFIG, type CompressionPreset, type ImageCompressionConfig } from '@/config/types';
import { resolveActivePreset } from '@/composables/image/useImageCompress';
import type { LinkFormat } from '@/utils/linkFormatter';
import PresetDialog from './PresetDialog.vue';
import SettingRow from './SettingRow.vue';
import SettingsCard from './SettingsCard.vue';
import SettingsSection from './SettingsSection.vue';
import TemplateDialog from './TemplateDialog.vue';
import { addPreset, describePreset, MAX_PRESETS } from './compressionPresets';
import { useSettingsConfig } from './useSettingsConfig';
import { vOverflowTitle } from '@/utils/overflowTitle';

const settings = useSettingsConfig();

const FORMATS: readonly PnSegment<LinkFormat>[] = [
  { value: 'url', label: 'URL' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'html', label: 'HTML' },
  { value: 'bbcode', label: 'BBCode' },
  { value: 'custom', label: '自定义' },
];

const link = computed(() => ({ ...DEFAULT_CONFIG.linkOutput!, ...settings.config.value.linkOutput }));
const compression = computed<ImageCompressionConfig>(() => settings.config.value.imageCompression ?? DEFAULT_CONFIG.imageCompression!);
const activePreset = computed(() => resolveActivePreset(compression.value));
const autoUploadClipboard = computed(() => settings.config.value.appBehavior?.autoUploadClipboard === true);

function patchLink(rowId: 'defaultFormat' | 'autoCopy', patch: Partial<typeof link.value>): void {
  void settings.patch(rowId, (c) => { c.linkOutput = { ...DEFAULT_CONFIG.linkOutput!, ...c.linkOutput, ...patch }; });
}

function setAutoUploadClipboard(on: boolean): void {
  void settings.patch('autoUploadClipboard', (c) => { c.appBehavior = { ...(c.appBehavior ?? DEFAULT_CONFIG.appBehavior!), autoUploadClipboard: on }; });
}

const { patchCompression } = settings;

const templateOpen = ref(false);
const editingId = ref<string | null>(null);
const previewOpen = ref(false);

async function createPreset(): Promise<void> {
  const id = crypto.randomUUID();
  if (await patchCompression((c) => addPreset(c, id))) editingId.value = id;
}

function selectPreset(id: string): void {
  if (id !== compression.value.activePresetId) void patchCompression((c) => ({ ...c, activePresetId: id }));
}

function presetById(id: string | null): CompressionPreset | null {
  return compression.value.presets.find((p) => p.id === id) ?? null;
}
</script>

<template>
  <div class="upload">
    <SettingsSection title="链接格式" note="复制格式对首页、托盘、命令面板和编辑器上传都生效。">
      <SettingsCard>
        <SettingRow row-id="defaultFormat" title="默认复制为" desc="用于首页、托盘与命令面板">
          <PnSegmented :model-value="link.defaultFormat" :segments="FORMATS" label="默认复制为" @update:model-value="(v) => patchLink('defaultFormat', { defaultFormat: v })" />
        </SettingRow>
        <SettingRow row-id="customTemplate">
          <template #title>
            <span class="upload__template">
              <span class="upload__template-name">自定义模板</span>
              <code v-overflow-title class="upload__template-text">{{ link.customTemplate || '{url}' }}</code>
            </span>
          </template>
          <PnButton variant="secondary" size="sm" class="upload__edit" @click="templateOpen = true">编辑…</PnButton>
        </SettingRow>
        <SettingRow row-id="autoCopy" title="自动复制链接" desc="首个图床完成即复制；批量上传结束后统一复制">
          <PnSwitch :model-value="link.autoCopy !== false" label="自动复制链接" @update:model-value="(v) => patchLink('autoCopy', { autoCopy: v })" />
        </SettingRow>
        <SettingRow row-id="autoUploadClipboard" title="自动上传剪贴板" desc="检测到剪贴板新图片时自动上传">
          <PnSwitch :model-value="autoUploadClipboard" label="自动上传剪贴板" @update:model-value="setAutoUploadClipboard" />
        </SettingRow>
      </SettingsCard>
    </SettingsSection>

    <SettingsSection title="图片压缩" note="只压缩上传出去的副本，本机原图不会改动。">
      <template #aside>
        <span class="upload__aside" data-setting-row="compression">
          <Transition name="upload-saved">
            <span v-if="settings.isSaved('compression')" class="upload__saved" role="status"><PnIcon name="check" :size="12" :stroke="2.4" />已保存</span>
          </Transition>
          上传前压缩
          <PnSwitch :model-value="compression.enabled" label="上传前压缩" @update:model-value="(v) => patchCompression((c) => ({ ...c, enabled: v }))" />
        </span>
      </template>
      <SettingsCard>
        <RadioGroupRoot :model-value="compression.activePresetId" class="upload__presets" aria-label="压缩方案" @update:model-value="(v) => selectPreset(String(v))">
          <div v-for="preset in compression.presets" :key="preset.id" class="upload__preset">
            <RadioGroupItem :id="`preset-${preset.id}`" class="upload__radio" :value="preset.id">
              <RadioGroupIndicator class="upload__radio-dot" />
            </RadioGroupItem>
            <label :for="`preset-${preset.id}`" class="upload__preset-text">
              <span class="upload__preset-name">{{ preset.name }}</span>
              <span class="upload__preset-desc">{{ describePreset(preset) }}</span>
            </label>
            <PnButton variant="ghost" size="sm" class="upload__preset-edit" :aria-label="`编辑方案「${preset.name}」`" @click="editingId = preset.id">编辑…</PnButton>
          </div>
        </RadioGroupRoot>
        <div class="upload__preset-foot">
          <PnButton variant="ghost" size="sm" class="upload__new" :disabled="compression.presets.length >= MAX_PRESETS" @click="createPreset">＋ 新建方案</PnButton>
          <span class="upload__limit">最多 {{ MAX_PRESETS }} 个</span>
          <div class="upload__spacer" />
          <PnButton variant="secondary" size="sm" class="upload__preview" @click="previewOpen = true">压缩预览…</PnButton>
        </div>
      </SettingsCard>
    </SettingsSection>

    <TemplateDialog v-model:open="templateOpen" :template="link.customTemplate" />
    <PresetDialog
      :preset="presetById(editingId)"
      :presets="compression.presets"
      @close="editingId = null"
    />
    <CompressionPreviewDialog :visible="previewOpen" :preset="activePreset" @update:visible="previewOpen = $event" />
  </div>
</template>

<style scoped>
.upload {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-settings-groups);
}

.upload__aside {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
}

.upload__saved {
  display: flex;
  align-items: center;
  gap: var(--pn-space-4);
  color: var(--pn-success);
}

/* 「已保存」淡入淡出（同 SettingRow） */
.upload-saved-enter-active,
.upload-saved-leave-active { transition: opacity var(--pn-dur-fast) var(--pn-ease-in); }

.upload-saved-enter-from,
.upload-saved-leave-to { opacity: 0; }

.upload__presets { display: flex; flex-direction: column; }

.upload__preset {
  display: flex;
  align-items: center;
  gap: var(--pn-space-12);
  min-height: var(--pn-size-settings-row);
  box-sizing: border-box;
  padding: var(--pn-space-settings-preset-row);
}

.upload__preset + .upload__preset { border-top: 1px solid var(--pn-border); }

.upload__radio {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-check);
  height: var(--pn-size-check);
  box-sizing: border-box;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--pn-check-border);
  transition: background-color var(--pn-dur-fast) var(--pn-ease-in), box-shadow var(--pn-dur-fast) var(--pn-ease-in);
}

.upload__radio[data-state='checked'] { background: var(--pn-brand); box-shadow: none; }

.upload__radio-dot {
  width: var(--pn-size-radio-dot);
  height: var(--pn-size-radio-dot);
  border-radius: 50%;
  background: var(--pn-on-fill);
}

.upload__preset-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.upload__preset-name { font-weight: var(--pn-weight-medium); }

.upload__preset-desc {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
}

.upload__preset-edit {
  height: var(--pn-size-settings-preset-edit);
  padding: 0 var(--pn-space-8);
  color: var(--pn-text2);
}

.upload__preset-foot {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  padding: var(--pn-space-8) var(--pn-space-sidebar-x);
  border-top: 1px solid var(--pn-border);
}

.upload__new { padding: 0 var(--pn-space-8); color: var(--pn-text2); font-size: var(--pn-text-body); }
.upload__limit { color: var(--pn-text3); font-size: var(--pn-text-footnote); }
.upload__spacer { flex: 1; }
.upload__preview { padding: 0 var(--pn-space-sidebar-x); font-size: var(--pn-text-body); }
.upload__edit { padding: 0 var(--pn-space-12); }

.upload__template {
  display: flex;
  align-items: center;
  gap: var(--pn-space-16);
  min-width: 0;
}

.upload__template-name { flex: none; }

.upload__template-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--pn-text3);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
