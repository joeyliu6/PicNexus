<script setup lang="ts">
// 自定义模板（STATES S02：「点占位符插入，下方实时预览」）。改动即保存（停手半秒或离开输入框），没有「保存」按钮；
// 清空后保存成 {url}。默认复制为不是「自定义」时，说明这个模板什么时候才用到。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnDialog from '@/components/pn/PnDialog.vue';
import PnInput from '@/components/pn/PnInput.vue';
import { DEFAULT_CONFIG } from '@/config/types';
import { applyTemplate, FORMAT_NAMES } from '@/utils/linkFormatter';
import { useSettingsConfig } from './useSettingsConfig';

const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ template: string }>();

const PLACEHOLDERS = ['{url}', '{filename}', '{width}', '{height}'] as const;
const SAMPLE = { url: 'https://img.example.com/2026/10/截图.png', filename: '截图.png', width: 1600, height: 1000 };
const SAVE_AFTER_MS = 500;

const settings = useSettingsConfig();
const draft = ref('');
const input = ref<InstanceType<typeof PnInput>>();
let timer: ReturnType<typeof setTimeout> | undefined;

const preview = computed(() => applyTemplate(draft.value || '{url}', SAMPLE));
const format = computed(() => settings.config.value.linkOutput?.defaultFormat ?? 'url');

watch(open, (value) => { if (value) draft.value = props.template || '{url}'; });

function save(): void {
  clearTimeout(timer);
  const next = draft.value.trim() ? draft.value : '{url}';
  if (next === (settings.config.value.linkOutput?.customTemplate ?? '{url}')) return;
  void settings.patch('customTemplate', (c) => { c.linkOutput = { ...DEFAULT_CONFIG.linkOutput!, ...c.linkOutput, customTemplate: next }; });
}

function onInput(): void {
  clearTimeout(timer);
  timer = setTimeout(save, SAVE_AFTER_MS);
}

async function insert(token: string): Promise<void> {
  const el = input.value?.element();
  const start = el?.selectionStart ?? draft.value.length;
  const end = el?.selectionEnd ?? draft.value.length;
  draft.value = draft.value.slice(0, start) + token + draft.value.slice(end);
  save();
  await nextTick();
  el?.focus();
  el?.setSelectionRange(start + token.length, start + token.length);
}

function close(): void {
  save();
  open.value = false;
}

watch(open, (value, was) => { if (was && !value) save(); });
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <PnDialog v-model:open="open" title="自定义模板" eyebrow="设置 › 上传与链接" icon="pencil">
    <div class="template">
      <label class="template__label" for="settings-template">模板</label>
      <PnInput
        id="settings-template"
        ref="input"
        v-model="draft"
        size="dialog"
        mono
        placeholder="{url}"
        @update:model-value="onInput"
        @blur="save"
      />
      <div class="template__tokens">
        <span class="template__hint">点击插入</span>
        <button v-for="token in PLACEHOLDERS" :key="token" type="button" class="template__token" @click="insert(token)">{{ token }}</button>
      </div>
      <div class="template__preview">
        <span class="template__label">预览</span>
        <code class="template__code pn-selectable">{{ preview }}</code>
      </div>
      <p v-if="format !== 'custom'" class="template__note">
        当前默认复制为 {{ FORMAT_NAMES[format] }}；默认复制为「自定义」时使用这个模板。
      </p>
    </div>
    <template #footer>
      <PnButton variant="primary" size="dialog" @click="close">完成</PnButton>
    </template>
  </PnDialog>
</template>

<style scoped>
.template {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-12);
}

.template > .template__label { margin-bottom: calc(-1 * var(--pn-space-6)); }

.template__tokens {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pn-space-6);
}

.template__hint {
  margin-right: var(--pn-space-2);
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.template__token {
  height: var(--pn-size-settings-token);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: var(--pn-subtle);
  box-shadow: inset 0 -1px 0 var(--pn-border);
  color: var(--pn-text2);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-caption);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in), color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 浅灰底的小按钮：悬停 / 按下再深一级、两级 */
.template__token:hover { background: var(--pn-ghost-press); color: var(--pn-text1); }
.template__token:active { background: var(--pn-subtle-press); color: var(--pn-text1); }

.template__preview {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-6);
}

.template__label {
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
}

.template__code {
  padding: var(--pn-space-8) var(--pn-space-12);
  border-radius: var(--pn-radius-md);
  background: var(--pn-subtle);
  color: var(--pn-text1);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-mono);
  line-height: var(--pn-leading-mono);
  overflow-wrap: anywhere;
}

.template__note {
  margin: 0;
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
}
</style>
