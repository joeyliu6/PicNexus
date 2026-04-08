<script setup lang="ts">
import { computed, ref } from 'vue';
import InputText from 'primevue/inputtext';
import ToggleSwitch from 'primevue/toggleswitch';
import RadioButton from 'primevue/radiobutton';
import Button from 'primevue/button';
import type { GithubCdnConfig, GithubCdnProvider } from '../../../config/types';
import { DEFAULT_GITHUB_CDN_LIST, DEFAULT_CDN_TEMPLATE } from '../../../config/types';
import { useConfirm } from '../../../composables/useConfirm';

interface Props {
  cdnConfig?: GithubCdnConfig;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:cdnConfig': [config: GithubCdnConfig];
  save: [];
}>();

const defaultConfig: GithubCdnConfig = {
  enabled: false,
  selectedIndex: 0,
  cdnList: [...DEFAULT_GITHUB_CDN_LIST]
};

const editingIndex = ref(-1);
const { showConfirm } = useConfirm();

function getConfig(): GithubCdnConfig {
  return props.cdnConfig ?? defaultConfig;
}

const cdnEnabled = computed({
  get: () => getConfig().enabled,
  set: (val: boolean) => {
    emit('update:cdnConfig', { ...getConfig(), enabled: val });
    emit('save');
  }
});

const selectedCdnIndex = computed({
  get: () => getConfig().selectedIndex,
  set: (val: number) => {
    emit('update:cdnConfig', { ...getConfig(), selectedIndex: val });
    emit('save');
  }
});

const cdnList = computed(() => getConfig().cdnList);

function toggleEdit(idx: number) {
  editingIndex.value = editingIndex.value === idx ? -1 : idx;
}

function shortDomain(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function updateCdnField(index: number, field: keyof GithubCdnProvider, value: string) {
  const config = getConfig();
  const newList = config.cdnList.map((item, i) =>
    i === index ? { ...item, [field]: value } : item
  );
  emit('update:cdnConfig', { ...config, cdnList: newList });
}

function addCdn() {
  const config = getConfig();
  const newItem: GithubCdnProvider = {
    name: '自定义 CDN',
    url: 'https://',
    template: DEFAULT_CDN_TEMPLATE
  };
  const newList = [...config.cdnList, newItem];
  emit('update:cdnConfig', { ...config, cdnList: newList });
  editingIndex.value = newList.length - 1;
  emit('save');
}

function removeCdn(index: number) {
  const config = getConfig();
  if (config.cdnList.length <= 1) return;
  const newList = config.cdnList.filter((_, i) => i !== index);
  let newSelectedIndex = config.selectedIndex;
  if (newSelectedIndex >= newList.length) {
    newSelectedIndex = 0;
  }
  if (editingIndex.value === index) editingIndex.value = -1;
  else if (editingIndex.value > index) editingIndex.value--;
  emit('update:cdnConfig', { ...config, cdnList: newList, selectedIndex: newSelectedIndex });
  emit('save');
}

function resetToDefault() {
  showConfirm({
    header: '恢复默认配置',
    message: '将清除所有自定义 CDN，恢复为初始的 jsDelivr 配置。',
    icon: 'pi pi-refresh',
    acceptLabel: '恢复',
    rejectLabel: '取消',
    accept: () => {
      editingIndex.value = -1;
      const config = getConfig();
      emit('update:cdnConfig', { ...config, selectedIndex: 0, cdnList: [...DEFAULT_GITHUB_CDN_LIST] });
      emit('save');
    }
  });
}

function renderTemplate(cdn: GithubCdnProvider): string {
  const domain = cdn.url.replace(/\/$/, '');
  return (cdn.template || DEFAULT_CDN_TEMPLATE)
    .replace(/\{domain\}/g, domain)
    .replace(/\{owner\}/g, 'user')
    .replace(/\{repo\}/g, 'repo')
    .replace(/\{branch\}/g, 'main')
    .replace(/\{path\}/g, 'images/example.png')
    .replace(/\{rawUrl\}/g, 'https://raw.githubusercontent.com/user/repo/main/images/example.png');
}

</script>

<template>
  <div class="card-subsection">
    <div class="cdn-title-row">
      <div>
        <label class="subsection-title">CDN 加速</label>
        <p class="subsection-hint">通过 jsDelivr 或其镜像加速 GitHub 图片访问。</p>
      </div>
      <ToggleSwitch v-model="cdnEnabled" />
    </div>

    <template v-if="cdnEnabled">
      <div class="cdn-list">
        <div
          v-for="(cdn, idx) in cdnList"
          :key="idx"
          class="cdn-row"
          :class="{ selected: selectedCdnIndex === idx }"
        >
          <div class="cdn-row-main">
            <RadioButton
              v-model="selectedCdnIndex"
              :value="idx"
              :inputId="'cdn-' + idx"
            />
            <label :for="'cdn-' + idx" class="cdn-info" @click.stop>
              <span class="cdn-name">{{ cdn.name }}</span>
              <span class="cdn-dot">·</span>
              <span class="cdn-domain">{{ shortDomain(cdn.url) }}</span>
            </label>
            <div class="cdn-actions">
              <Button
                :icon="editingIndex === idx ? 'pi pi-chevron-up' : 'pi pi-pencil'"
                @click="toggleEdit(idx)"
                text
                rounded
                size="small"
              />
              <Button
                icon="pi pi-trash"
                @click="removeCdn(idx)"
                text
                rounded
                severity="danger"
                size="small"
                :disabled="cdnList.length <= 1"
              />
            </div>
          </div>

          <div v-if="editingIndex === idx" class="cdn-edit">
            <div class="cdn-field-row">
              <span class="cdn-field-label">名称</span>
              <InputText
                :modelValue="cdn.name"
                @update:modelValue="(val) => updateCdnField(idx, 'name', val as string)"
                @blur="emit('save')"
                placeholder="CDN 名称"
                class="flex-1"
                size="small"
              />
            </div>
            <div class="cdn-field-row">
              <span class="cdn-field-label">域名</span>
              <InputText
                :modelValue="cdn.url"
                @update:modelValue="(val) => updateCdnField(idx, 'url', val as string)"
                @blur="emit('save')"
                placeholder="https://cdn.jsdelivr.net"
                class="flex-1"
                size="small"
              />
            </div>
            <div class="cdn-field-row">
              <span class="cdn-field-label">模板</span>
              <InputText
                :modelValue="cdn.template"
                @update:modelValue="(val) => updateCdnField(idx, 'template', val as string)"
                @blur="emit('save')"
                :placeholder="DEFAULT_CDN_TEMPLATE"
                class="flex-1 cdn-template-input"
                size="small"
              />
            </div>
            <div class="cdn-vars-hint">
              可用变量：<code>{domain}</code> <code>{owner}</code> <code>{repo}</code> <code>{branch}</code> <code>{path}</code> <code>{rawUrl}</code>
            </div>
            <div class="cdn-preview-inline">
              <span class="cdn-preview-label">转换效果</span>
              <code class="cdn-preview-url">{{ renderTemplate(cdn) }}</code>
            </div>
          </div>
        </div>
      </div>

      <div class="cdn-toolbar">
        <Button
          label="添加 CDN"
          icon="pi pi-plus"
          @click="addCdn"
          outlined
          size="small"
        />
        <Button
          label="恢复默认"
          icon="pi pi-refresh"
          @click="resetToDefault"
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

.cdn-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.cdn-title-row .subsection-hint {
  margin-bottom: 0;
}

.cdn-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 14px;
}

.cdn-row {
  border-radius: 6px;
  transition: background-color var(--duration-fast) ease;
}

.cdn-row:hover {
  background: var(--hover-overlay-subtle);
}

.cdn-row.selected {
  background: var(--primary-alpha-5);
}

.cdn-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
}

.cdn-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
}

.cdn-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.cdn-dot {
  font-size: 13px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.cdn-domain {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cdn-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.cdn-edit {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 10px 10px 38px;
}

.cdn-field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cdn-field-label {
  font-size: 12px;
  color: var(--text-muted);
  width: 32px;
  flex-shrink: 0;
}

.cdn-template-input {
  font-family: var(--font-mono);
  font-size: 12px;
}

.cdn-vars-hint {
  font-size: var(--text-2xs-xs);
  color: var(--text-muted);
  padding-top: 2px;
}

.cdn-vars-hint code {
  font-size: var(--text-2xs-xs);
  padding: 1px 4px;
  background: var(--hover-overlay);
  border-radius: 3px;
  color: var(--primary);
  margin: 0 1px;
}

.cdn-toolbar {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  padding-left: 10px;
}

.cdn-preview-inline {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--hover-overlay-subtle);
  border-radius: 5px;
}

.cdn-preview-label {
  display: block;
  font-size: var(--text-2xs-xs);
  color: var(--text-muted);
  margin-bottom: 4px;
}

.cdn-preview-url {
  font-size: var(--text-2xs-xs);
  color: var(--primary);
  font-family: var(--font-mono);
  word-break: break-all;
  line-height: 1.4;
}
</style>
