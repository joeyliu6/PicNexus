<script setup lang="ts">
import { computed, ref } from 'vue';
import InputText from 'primevue/inputtext';
import ToggleSwitch from 'primevue/toggleswitch';
import RadioButton from 'primevue/radiobutton';
import Button from 'primevue/button';
import { useConfirm } from '../../../composables/useConfirm';

interface Props {
  linkPrefixEnabled: boolean;
  prefixList: string[];
  selectedPrefixIndex: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:linkPrefixEnabled': [enabled: boolean];
  'update:prefixList': [list: string[]];
  'update:selectedPrefixIndex': [index: number];
  save: [];
  addPrefix: [];
  removePrefix: [index: number];
  resetToDefault: [];
}>();

const editingIndex = ref(-1);
const { showConfirm } = useConfirm();

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

const FRIENDLY_NAMES: Record<string, string> = {
  'image.baidu.com': '百度图片',
  'cdn.cdnjson.com': 'CDN JSON',
};

function shortDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || url;
  }
}

function friendlyName(url: string): string {
  const domain = shortDomain(url);
  return FRIENDLY_NAMES[domain] || domain;
}

function toggleEdit(idx: number) {
  editingIndex.value = editingIndex.value === idx ? -1 : idx;
}

function handlePrefixChange(index: number, value: string) {
  const newList = [...props.prefixList];
  newList[index] = value;
  emit('update:prefixList', newList);
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

function handleAdd() {
  emit('addPrefix');
  editingIndex.value = props.prefixList.length;
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
              <span class="prefix-name">{{ friendlyName(prefix) }}</span>
              <span class="prefix-dot">·</span>
              <span class="prefix-domain">{{ shortDomain(prefix) }}</span>
            </label>
            <div class="prefix-actions">
              <Button
                :icon="editingIndex === idx ? 'pi pi-chevron-up' : 'pi pi-pencil'"
                @click="toggleEdit(idx)"
                text
                rounded
                size="small"
              />
              <Button
                icon="pi pi-trash"
                @click="handleRemove(idx)"
                text
                rounded
                severity="danger"
                size="small"
                :disabled="prefixList.length <= 1"
              />
            </div>
          </div>

          <div v-if="editingIndex === idx" class="prefix-edit">
            <div class="prefix-field-row">
              <span class="prefix-field-label">地址</span>
              <InputText
                :modelValue="prefix"
                @update:modelValue="(val) => handlePrefixChange(idx, val as string)"
                @blur="emit('save')"
                placeholder="https://"
                class="flex-1"
                size="small"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="prefix-toolbar">
        <Button
          label="添加前缀"
          icon="pi pi-plus"
          @click="handleAdd"
          outlined
          size="small"
        />
        <Button
          label="恢复默认"
          icon="pi pi-refresh"
          @click="handleReset"
          outlined
          severity="secondary"
          size="small"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
@import '../../../styles/settings-shared.css';

.prefix-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.prefix-title-row .subsection-hint {
  margin-bottom: 0;
}

.prefix-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 14px;
}

.prefix-row {
  border-radius: 6px;
  transition: background-color var(--duration-fast) ease;
}

.prefix-row:hover {
  background: var(--hover-overlay-subtle);
}

.prefix-row.selected {
  background: var(--primary-alpha-5);
}

.prefix-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
}

.prefix-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
}

.prefix-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.prefix-dot {
  font-size: 13px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.prefix-domain {
  font-size: 12px;
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
  gap: 6px;
  padding: 0 10px 10px 38px;
}

.prefix-field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prefix-field-label {
  font-size: 12px;
  color: var(--text-muted);
  width: 32px;
  flex-shrink: 0;
}

.prefix-toolbar {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  padding-left: 10px;
}
</style>
