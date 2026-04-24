<script setup lang="ts">
import { computed, ref } from 'vue';
import InputText from 'primevue/inputtext';
import ToggleSwitch from 'primevue/toggleswitch';
import RadioButton from 'primevue/radiobutton';
import Button from 'primevue/button';
import type { LinkPrefixItem } from '../../../config/types';
import { applyPrefixTemplate, findUnknownPlaceholders, KNOWN_PLACEHOLDERS } from '../../../utils/linkPrefixTemplate';
import { useConfirm } from '../../../composables/useConfirm';
import { useToast } from '../../../composables/useToast';

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
const toast = useToast();

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

// blur 时：trim 并校验占位符，再统一触发 save
// Why: 防止用户误输入纯空白/空字符串/未知占位符（如 {wrong}）落盘后产生畸形链接
function handleFieldBlur(index: number) {
  const current = props.prefixList[index];
  if (!current) { emit('save'); return; }

  const trimmedName = (current.name ?? '').trim();
  const trimmedTemplate = (current.template ?? '').trim();

  let nextName = trimmedName;
  const nextTemplate = trimmedTemplate;
  let changed = false;

  if (nextName !== current.name) { changed = true; }
  if (nextTemplate !== current.template) { changed = true; }

  // 名称空 → 回退到"未命名"占位，避免持久化空串
  if (!nextName) {
    nextName = '未命名';
    changed = true;
    toast.showConfig('warn', {
      summary: '前缀名称不能为空',
      detail: '已自动填入"未命名"，请稍后重新命名。',
      life: 3000,
    });
  }

  // 模板空 → 阻止保存并回滚，提示用户
  if (!nextTemplate) {
    toast.showConfig('warn', {
      summary: '模板不能为空',
      detail: '请填入 https:// 开头的地址或包含 {url} 等占位符的模板。',
      life: 3500,
    });
    // 不 emit save，让用户继续编辑；同步清理名称 trim
    if (changed && nextName !== current.name) {
      emit('updatePrefix', { index, item: { ...current, name: nextName } });
    }
    return;
  }

  // 校验未知占位符：宽松模式——不阻止保存，仅 warn（用户可能是故意写字面量）
  const unknown = findUnknownPlaceholders(nextTemplate);
  if (unknown.length > 0) {
    const supported = KNOWN_PLACEHOLDERS.map(t => `{${t}}`).join(' ');
    toast.showConfig('warn', {
      summary: '存在未知占位符',
      detail: `以下占位符不会被替换，将作为字面量保留：${unknown.map(t => `{${t}}`).join(' ')}。支持的占位符：${supported}。`,
      life: 5000,
    });
  }

  if (changed) {
    emit('updatePrefix', { index, item: { ...current, name: nextName, template: nextTemplate } });
  }
  emit('save');
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
                @blur="handleFieldBlur(idx)"
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
                @blur="handleFieldBlur(idx)"
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
  gap: var(--space-2xs);
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
  gap: var(--space-2xs);
  flex-shrink: 0;
}

.prefix-edit {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 38px 左缩进对齐图标，无对应 spacing token */
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
  padding-top: var(--space-2xs);
}

.prefix-vars-hint code {
  font-size: var(--text-xs);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1px 为 inline code 微调间距 */
  padding: 1px var(--space-xs);
  background: var(--hover-overlay);
  border-radius: var(--radius-xs-sm);
  color: var(--primary);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1px 为 inline code 微调间距 */
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
