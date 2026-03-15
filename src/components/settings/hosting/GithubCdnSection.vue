<script setup lang="ts">
import { computed } from 'vue';
import InputText from 'primevue/inputtext';
import Checkbox from 'primevue/checkbox';
import RadioButton from 'primevue/radiobutton';
import Button from 'primevue/button';
import { generatePreviewUrl, validateCdnTemplate } from '../../../utils/githubCdn';
import type { GithubCdnConfig } from '../../../config/types';
import { DEFAULT_GITHUB_CDN_LIST } from '../../../config/types';

interface Props {
  githubCdnConfig?: GithubCdnConfig;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:githubCdnConfig': [config: GithubCdnConfig];
  save: [];
}>();

const githubCdnEnabled = computed({
  get: () => props.githubCdnConfig?.enabled ?? false,
  set: (val) => {
    const newConfig: GithubCdnConfig = props.githubCdnConfig
      ? { ...props.githubCdnConfig, enabled: val }
      : { enabled: val, selectedIndex: 0, cdnList: [...DEFAULT_GITHUB_CDN_LIST] };
    emit('update:githubCdnConfig', newConfig);
    emit('save');
  }
});

const githubCdnSelectedIndex = computed({
  get: () => props.githubCdnConfig?.selectedIndex ?? 0,
  set: (val) => {
    if (props.githubCdnConfig) {
      emit('update:githubCdnConfig', { ...props.githubCdnConfig, selectedIndex: val });
      emit('save');
    }
  }
});

const githubCdnList = computed(() => {
  return props.githubCdnConfig?.cdnList ?? DEFAULT_GITHUB_CDN_LIST;
});

const githubCdnPreviewUrl = computed(() => {
  const cdnConfig = props.githubCdnConfig;
  if (!cdnConfig?.enabled || !cdnConfig.cdnList?.length) {
    return generatePreviewUrl(DEFAULT_GITHUB_CDN_LIST[0].urlTemplate);
  }
  const index = cdnConfig.selectedIndex >= 0 && cdnConfig.selectedIndex < cdnConfig.cdnList.length
    ? cdnConfig.selectedIndex
    : 0;
  return generatePreviewUrl(cdnConfig.cdnList[index].urlTemplate);
});

function updateGithubCdnTemplate(index: number, value: string) {
  if (props.githubCdnConfig?.cdnList) {
    const newCdnList = [...props.githubCdnConfig.cdnList];
    newCdnList[index] = { ...newCdnList[index], urlTemplate: value };
    emit('update:githubCdnConfig', { ...props.githubCdnConfig, cdnList: newCdnList });
  }
}

function addCustomGithubCdn() {
  const currentConfig = props.githubCdnConfig ?? {
    enabled: true,
    selectedIndex: 0,
    cdnList: [...DEFAULT_GITHUB_CDN_LIST]
  };
  const newCdnList = [...currentConfig.cdnList, {
    name: '自定义 CDN',
    urlTemplate: 'https://example.com/gh/{owner}/{repo}@{branch}/{path}',
    isPreset: false
  }];
  emit('update:githubCdnConfig', { ...currentConfig, cdnList: newCdnList });
  emit('save');
}

function removeGithubCdn(index: number) {
  if (props.githubCdnConfig?.cdnList) {
    const cdn = props.githubCdnConfig.cdnList[index];
    if (cdn.isPreset) return;
    const newCdnList = props.githubCdnConfig.cdnList.filter((_, i) => i !== index);
    let newSelectedIndex = props.githubCdnConfig.selectedIndex;
    if (newSelectedIndex >= newCdnList.length) {
      newSelectedIndex = 0;
    }
    emit('update:githubCdnConfig', { ...props.githubCdnConfig, cdnList: newCdnList, selectedIndex: newSelectedIndex });
    emit('save');
  }
}

function resetGithubCdnToDefault() {
  emit('update:githubCdnConfig', {
    enabled: props.githubCdnConfig?.enabled ?? false,
    selectedIndex: 0,
    cdnList: [...DEFAULT_GITHUB_CDN_LIST]
  });
  emit('save');
}

</script>

<template>
  <div class="card-subsection">
    <label class="subsection-title">CDN 加速</label>
    <p class="subsection-hint">使用第三方 CDN 加速 GitHub 图片访问，提升国内访问速度。</p>

    <div class="flex items-center gap-2 mb-3">
      <Checkbox
        v-model="githubCdnEnabled"
        :binary="true"
        inputId="cdn-enable"
      />
      <label for="cdn-enable" class="font-medium cursor-pointer">启用 CDN 加速</label>
    </div>

    <div v-if="githubCdnEnabled" class="cdn-list">
      <div v-for="(cdn, idx) in githubCdnList" :key="idx" class="cdn-row">
        <RadioButton
          v-model="githubCdnSelectedIndex"
          :value="idx"
          :inputId="'cdn-' + idx"
        />
        <template v-if="cdn.isPreset">
          <label :for="'cdn-' + idx" class="cdn-name">{{ cdn.name }}</label>
        </template>
        <template v-else>
          <InputText
            :modelValue="cdn.urlTemplate"
            @update:modelValue="(val) => updateGithubCdnTemplate(idx, val as string)"
            @blur="emit('save')"
            class="flex-1"
            :class="{ 'p-invalid': !validateCdnTemplate(cdn.urlTemplate) }"
            placeholder="https://example.com/gh/{owner}/{repo}@{branch}/{path}"
          />
          <Button
            icon="pi pi-times"
            @click="removeGithubCdn(idx)"
            text
            severity="danger"
          />
        </template>
      </div>
      <div class="flex gap-2 mt-2">
        <Button
          label="添加自定义"
          icon="pi pi-plus"
          @click="addCustomGithubCdn"
          outlined
          size="small"
        />
        <Button
          label="恢复默认"
          icon="pi pi-refresh"
          @click="resetGithubCdnToDefault"
          outlined
          severity="secondary"
          size="small"
        />
      </div>
      <div class="cdn-preview">
        <span class="cdn-preview-label">预览</span>
        <code>{{ githubCdnPreviewUrl }}</code>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '../../../styles/settings-shared.css';

.cdn-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cdn-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cdn-name {
  font-size: 14px;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
}

.cdn-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--surface-section);
  border-radius: 4px;
}

.cdn-preview-label {
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.cdn-preview code {
  font-size: 11px;
  color: var(--text-secondary);
  word-break: break-all;
  font-family: 'SF Mono', 'Consolas', monospace;
}
</style>
