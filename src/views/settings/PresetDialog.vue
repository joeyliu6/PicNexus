<script setup lang="ts">
// 编辑压缩方案（设计只画了「编辑」入口）：名称、输出格式、质量、长边上限、缩放、小文件不压缩、去除 EXIF。
// 每一项改完即保存（数字在离开输入框或回车时），没有「保存」按钮；「删除方案」不弹确认，通知带撤销。
import { computed, ref, watch } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnDialog from '@/components/pn/PnDialog.vue';
import PnInput from '@/components/pn/PnInput.vue';
import PnSegmented, { type PnSegment } from '@/components/pn/PnSegmented.vue';
import PnSwitch from '@/components/pn/PnSwitch.vue';
import type { CompressionOutputFormat, CompressionPreset } from '@/config/types';
import { useUndoToast } from '@/composables/useUndoToast';
import { FORMAT_LABELS } from '@/utils/compressionPresetText';
import { normalizePreset, removePreset, uniquePresetName } from './compressionPresets';
import { useSettingsConfig } from './useSettingsConfig';

const props = defineProps<{
  preset: CompressionPreset | null;
  presets: readonly CompressionPreset[];
}>();

const emit = defineEmits<{ close: [] }>();

// 直接写配置，不经父组件：删掉方案后切到别的设置分组，对话框和父组件都已卸载，撤销照样要写回去
const { patchCompression } = useSettingsConfig();

type NumberField = 'quality' | 'maxLongSide' | 'scalePercent' | 'skipIfSmallerKB';

const FORMATS: readonly PnSegment<CompressionOutputFormat>[] = (['original', 'webp', 'jpeg'] as const)
  .map((value) => ({ value, label: FORMAT_LABELS[value] }));

const NUMBERS: { key: NumberField; label: string; unit: string; help: string }[] = [
  { key: 'quality', label: '质量', unit: '', help: '1–100，越高越清晰、文件越大' },
  { key: 'maxLongSide', label: '长边上限', unit: 'px', help: '0 = 不限制' },
  { key: 'scalePercent', label: '缩放', unit: '%', help: '100 = 不缩放' },
  { key: 'skipIfSmallerKB', label: '小于此大小不压缩', unit: 'KB', help: '0 = 全部压缩' },
];

const undo = useUndoToast();
const open = computed({
  get: () => !!props.preset,
  set: (value) => { if (!value) emit('close'); },
});

const name = ref('');
const numbers = ref<Record<NumberField, string>>({ quality: '', maxLongSide: '', scalePercent: '', skipIfSmallerKB: '' });

watch(() => props.preset, (preset) => {
  if (!preset) return;
  name.value = preset.name;
  for (const field of NUMBERS) numbers.value[field.key] = String(preset[field.key]);
}, { immediate: true });

function update(patch: Partial<CompressionPreset>): void {
  const id = props.preset?.id;
  if (!id) return;
  void patchCompression((c) => ({ ...c, presets: c.presets.map((p) => (p.id === id ? normalizePreset({ ...p, ...patch }) : p)) }));
}

function commitName(): void {
  if (!props.preset) return;
  const next = uniquePresetName(name.value.trim() || props.preset.name, props.presets, props.preset.id);
  name.value = next;
  if (next !== props.preset.name) update({ name: next });
}

function commitNumber(key: NumberField): void {
  if (!props.preset) return;
  const typed = Number(numbers.value[key].trim());
  const next = normalizePreset({ ...props.preset, [key]: Number.isFinite(typed) && numbers.value[key].trim() !== '' ? typed : props.preset[key] })[key];
  numbers.value[key] = String(next);
  if (next !== props.preset[key]) update({ [key]: next });
}

async function remove(): Promise<void> {
  const preset = props.preset;
  if (!preset) return;
  const index = props.presets.findIndex((p) => p.id === preset.id);
  let wasActive = false;
  void patchCompression((c) => {
    wasActive = c.activePresetId === preset.id;
    return removePreset(c, preset.id);
  });
  emit('close');
  const kept = await undo.show(`已删除方案「${preset.name}」`);
  if (kept) return;
  void patchCompression((c) => {
    if (c.presets.some((p) => p.id === preset.id)) return null;
    const presets = [...c.presets];
    presets.splice(Math.min(index, presets.length), 0, preset);
    return { ...c, presets, activePresetId: wasActive ? preset.id : c.activePresetId };
  });
}
</script>

<template>
  <PnDialog v-model:open="open" title="编辑压缩方案" eyebrow="设置 › 上传与链接" icon="pencil">
    <div v-if="preset" class="preset">
      <label class="preset__field">
        <span class="preset__label">名称</span>
        <PnInput v-model="name" size="dialog" @blur="commitName" @keydown.enter="commitName" />
      </label>
      <div class="preset__field">
        <span class="preset__label">输出格式</span>
        <PnSegmented :model-value="preset.outputFormat" :segments="FORMATS" label="输出格式" @update:model-value="(v) => update({ outputFormat: v })" />
      </div>
      <div class="preset__grid">
        <label v-for="field in NUMBERS" :key="field.key" class="preset__field">
          <span class="preset__label">{{ field.label }}</span>
          <PnInput v-model="numbers[field.key]" size="dialog" @blur="commitNumber(field.key)" @keydown.enter="commitNumber(field.key)">
            <template v-if="field.unit" #suffix><span class="preset__unit">{{ field.unit }}</span></template>
          </PnInput>
          <span class="preset__help">{{ field.help }}</span>
        </label>
      </div>
      <div class="preset__switch">
        <span class="preset__switch-text">
          <span>去除 EXIF</span>
          <span class="preset__help">拍摄地点、设备等信息不随图片上传</span>
        </span>
        <PnSwitch :model-value="preset.stripExif" label="去除 EXIF" @update:model-value="(v) => update({ stripExif: v })" />
      </div>
    </div>
    <template v-if="presets.length > 1" #footer-left>
      <PnButton variant="ghost" size="dialog" class="preset__delete" @click="remove">删除方案</PnButton>
    </template>
    <template #footer>
      <PnButton variant="primary" size="dialog" @click="open = false">完成</PnButton>
    </template>
  </PnDialog>
</template>

<style scoped>
.preset {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-16);
}

.preset__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--pn-space-host-fields);
}

.preset__field {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-6);
}

.preset__label {
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
}

.preset__help {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
}

.preset__unit {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.preset__switch {
  display: flex;
  align-items: center;
  gap: var(--pn-space-16);
}

.preset__switch-text {
  display: flex;
  flex: 1;
  flex-direction: column;
}

/* 红字文字按钮：悬停 / 按下用红色浅底的两级，不用灰色（同图床页「移除图床」）；多一层 .pn-button 才盖得住 PnButton 的 ghost */
.preset__delete { color: var(--pn-danger); }
.preset__delete.pn-button:not(:disabled):hover { background: var(--pn-danger-soft); }
.preset__delete.pn-button:not(:disabled):active { background: var(--pn-danger-soft-press); }
</style>
