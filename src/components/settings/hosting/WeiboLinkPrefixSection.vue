<script setup lang="ts">
import { computed, ref } from 'vue';
import InputText from 'primevue/inputtext';
import ToggleSwitch from 'primevue/toggleswitch';
import RadioButton from 'primevue/radiobutton';
import Button from 'primevue/button';
import type { LinkPrefixItem } from '../../../config/types';
import { applyPrefixTemplate } from '../../../utils/linkPrefixTemplate';
import { useConfirm } from '../../../composables/useConfirm';

interface Props {
  linkPrefixEnabled: boolean;
  prefixList: LinkPrefixItem[];
  selectedPrefixIndex: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:linkPrefixEnabled': [enabled: boolean];
  'update:selectedPrefixIndex': [index: number];
  save: [];
  addPrefix: [item: LinkPrefixItem];
  updatePrefix: [payload: { index: number; item: LinkPrefixItem }];
  removePrefix: [index: number];
  resetToDefault: [];
}>();

const { showConfirm } = useConfirm();

const editingIndex = ref(-1);

const localLinkPrefixEnabled = computed({
  get: () => props.linkPrefixEnabled,
  set: (val) => {
    emit('update:linkPrefixEnabled', val);
    emit('save');
  }
});

const localSelectedPrefixIndex = computed({
  get: () => props.selectedPrefixIndex,
  set: (val) => emit('update:selectedPrefixIndex', val)
});

function shortDomain(template: string): string {
  try {
    return new URL(template).hostname;
  } catch {
    return template.replace(/^https?:\/\//, '').split('/')[0] || template;
  }
}

function toggleEdit(idx: number) {
  editingIndex.value = editingIndex.value === idx ? -1 : idx;
}

function updatePrefixField(index: number, field: keyof LinkPrefixItem, value: string) {
  const current = props.prefixList[index];
  if (!current) return;
  emit('updatePrefix', { index, item: { ...current, [field]: value } });
}

function handleAdd() {
  const nextIndex = props.prefixList.length;
  emit('addPrefix', { name: '自定义前缀', template: 'https://' });
  editingIndex.value = nextIndex;
}

function handleRemove(index: number) {
  if (editingIndex.value === index) editingIndex.value = -1;
  else if (editingIndex.value > index) editingIndex.value--;
  emit('removePrefix', index);
}

function handleReset() {
  showConfirm({
    header: '恢复默认前缀',
    message: '将清除所有自定义前缀，恢复为初始配置。',
    icon: 'pi pi-refresh',
    acceptLabel: '恢复',
    rejectLabel: '取消',
    accept: () => {
      editingIndex.value = -1;
      emit('resetToDefault');
    }
  });
}

const SAMPLE_URL = 'https://ww1.sinaimg.cn/mw690/abc123.jpg';

function renderPreview(prefix: LinkPrefixItem): string {
  const t = (prefix.template || '').trim();
  if (!t) return '';
  return applyPrefixTemplate(t, SAMPLE_URL);
}
</script>

<template>
  <div class="card-subsection">
    <div class="prefix-title-row">
      <div>
        <label class="subsection-title">链接前缀</label>
        <p class="subsection-hint">为微博图片添加代理前缀以绕过防盗链限制。</p>
      </div>
      <ToggleSwitch v-model="localLinkPrefixEnabled" />
    </div>

    <template v-if="linkPrefixEnabled">
      <div class="prefix-list">
        <div
          v-for="(prefix, idx) in prefixList"
          :key="idx"
          class="prefix-row"
          :class="{ selected: localSelectedPrefixIndex === idx }"
        >
          <div class="prefix-row-main">
            <RadioButton
              v-model="localSelectedPrefixIndex"
              :value="idx"
              :inputId="'prefix-' + idx"
              @change="emit('save')"
            />
            <label :for="'prefix-' + idx" class="prefix-info" @click.stop>
              <span class="prefix-name">{{ prefix.name || '未命名' }}</span>
              <span class="prefix-dot">·</span>
              <span class="prefix-domain">{{ shortDomain(prefix.template) }}</span>
            </label>
            <div class="prefix-actions">
              <Button
                :icon="editingIndex === idx ? 'pi pi-chevron-up' : 'pi pi-pencil'"
                text
                rounded
                size="small"
                @click="toggleEdit(idx)"
              />
              <Button
                icon="pi pi-trash"
                text
                rounded
                severity="danger"
                size="small"
                :disabled="prefixList.length <= 1"
                @click="handleRemove(idx)"
              />
            </div>
          </div>

          <div v-if="editingIndex === idx" class="prefix-edit">
            <div class="prefix-field-row">
              <span class="prefix-field-label">名称</span>
              <InputText
                :modelValue="prefix.name"
                placeholder="如：搜狗图片"
                class="flex-1"
                size="small"
                @update:modelValue="(val) => updatePrefixField(idx, 'name', val as string)"
                @blur="emit('save')"
              />
            </div>
            <div class="prefix-field-row">
              <span class="prefix-field-label">模板</span>
              <InputText
                :modelValue="prefix.template"
                placeholder="https://example.com/{url_no_scheme}"
                class="flex-1 prefix-template-input"
                size="small"
                @update:modelValue="(val) => updatePrefixField(idx, 'template', val as string)"
                @blur="emit('save')"
              />
            </div>
            <div class="prefix-vars-hint">
              可用变量：<code>{url}</code> <code>{url_no_scheme}</code> <code>{path}</code> <code>{url_encoded}</code>
            </div>
            <div class="prefix-preview-inline">
              <span class="prefix-preview-label">转换效果</span>
              <code class="prefix-preview-url">{{ renderPreview(prefix) }}</code>
            </div>
          </div>
        </div>
      </div>

      <div class="prefix-toolbar">
        <Button
          label="添加前缀"
          icon="pi pi-plus"
          outlined
          size="small"
          @click="handleAdd"
        />
        <Button
          label="恢复默认"
          icon="pi pi-refresh"
          outlined
          severity="secondary"
          size="small"
          @click="handleReset"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
@import url('../../../styles/settings-shared.css');

.prefix-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm-md);
}

.prefix-title-row .subsection-hint {
  margin-bottom: 0;
}

.prefix-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: var(--space-md);
}

.prefix-row {
  border-radius: var(--radius-sm);
  transition: background-color var(--duration-fast) ease;
}

.prefix-row:hover {
  background: var(--hover-overlay-subtle);
}

.prefix-row.selected {
  background: var(--primary-alpha-8);
}

.prefix-row-main {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-sm-md);
}

.prefix-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
}

.prefix-name {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  white-space: nowrap;
}

.prefix-dot {
  font-size: var(--text-sm);
  color: var(--text-muted);
  flex-shrink: 0;
}

.prefix-domain {
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prefix-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.prefix-edit {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: 0 var(--space-sm-md) var(--space-sm-md) 38px;
}

.prefix-field-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.prefix-field-label {
  font-size: var(--text-xs);
  color: var(--text-muted);
  width: 32px;
  flex-shrink: 0;
}

.prefix-template-input {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.prefix-vars-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
  padding-top: 2px;
}

.prefix-vars-hint code {
  font-size: var(--text-xs);
  padding: 1px 4px;
  background: var(--hover-overlay);
  border-radius: var(--radius-xs-sm);
  color: var(--primary);
  margin: 0 1px;
}

.prefix-preview-inline {
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-sm-md);
  background: var(--hover-overlay-subtle);
  border-radius: var(--radius-xs-sm);
}

.prefix-preview-label {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-bottom: var(--space-2xs);
}

.prefix-preview-url {
  font-size: var(--text-xs);
  color: var(--primary);
  font-family: var(--font-mono);
  word-break: break-all;
  line-height: 1.4;
}

.prefix-toolbar {
  display: flex;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
  padding-left: var(--space-sm-md);
}
</style>
