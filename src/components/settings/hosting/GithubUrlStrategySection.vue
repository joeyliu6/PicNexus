<script setup lang="ts">
import { computed } from 'vue';
import Select from 'primevue/select';
import InputText from 'primevue/inputtext';
import RadioButton from 'primevue/radiobutton';
import Button from 'primevue/button';
import { generatePreviewUrl, validateCdnTemplate } from '../../../utils/githubCdn';
import type { GithubUrlStrategy, GithubUrlStrategyType } from '../../../config/types';
import { DEFAULT_GITHUB_CDN_LIST } from '../../../config/types';

interface Props {
  urlStrategy?: GithubUrlStrategy;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:urlStrategy': [strategy: GithubUrlStrategy];
  save: [];
}>();

const defaultStrategy: GithubUrlStrategy = {
  type: 'default',
  selectedCdnIndex: 0,
  cdnList: [...DEFAULT_GITHUB_CDN_LIST],
  customDomain: ''
};

function getStrategy(): GithubUrlStrategy {
  return props.urlStrategy ?? defaultStrategy;
}

const strategyType = computed({
  get: () => getStrategy().type,
  set: (val: GithubUrlStrategyType) => {
    emit('update:urlStrategy', { ...getStrategy(), type: val });
    emit('save');
  }
});

const selectedCdnIndex = computed({
  get: () => getStrategy().selectedCdnIndex,
  set: (val: number) => {
    emit('update:urlStrategy', { ...getStrategy(), selectedCdnIndex: val });
    emit('save');
  }
});

const customDomain = computed({
  get: () => getStrategy().customDomain,
  set: (val: string) => {
    emit('update:urlStrategy', { ...getStrategy(), customDomain: val });
  }
});

const cdnList = computed(() => getStrategy().cdnList);

const cdnOptions = computed(() =>
  cdnList.value.map((cdn, index) => ({ label: cdn.name, value: index }))
);

function getValidCdnIndex(strategy: GithubUrlStrategy): number {
  const { selectedCdnIndex, cdnList } = strategy;
  return (selectedCdnIndex >= 0 && selectedCdnIndex < cdnList.length) ? selectedCdnIndex : 0;
}

const selectedCdn = computed(() => {
  const strategy = getStrategy();
  return strategy.cdnList[getValidCdnIndex(strategy)];
});

const isCustomCdnSelected = computed(() => selectedCdn.value && !selectedCdn.value.isPreset);

const selectedCdnTemplate = computed(() =>
  isCustomCdnSelected.value ? selectedCdn.value.urlTemplate : ''
);

const previewUrl = computed(() => {
  const strategy = getStrategy();
  switch (strategy.type) {
    case 'cdn':
      return generatePreviewUrl(selectedCdn.value.urlTemplate);
    case 'custom-domain': {
      const domain = strategy.customDomain?.replace(/\/$/, '') || 'https://cdn.example.com';
      return `${domain}/images/example.png`;
    }
    default:
      return generatePreviewUrl(DEFAULT_GITHUB_CDN_LIST[0].urlTemplate);
  }
});

function updateCustomCdnTemplate(value: string) {
  const strategy = getStrategy();
  const newCdnList = [...strategy.cdnList];
  newCdnList[strategy.selectedCdnIndex] = {
    ...newCdnList[strategy.selectedCdnIndex],
    urlTemplate: value
  };
  emit('update:urlStrategy', { ...strategy, cdnList: newCdnList });
}

function addCustomCdn() {
  const strategy = getStrategy();
  const newCdnList = [...strategy.cdnList, {
    name: '自定义 CDN',
    urlTemplate: 'https://example.com/gh/{owner}/{repo}@{branch}/{path}',
    isPreset: false
  }];
  const newIndex = newCdnList.length - 1;
  emit('update:urlStrategy', { ...strategy, cdnList: newCdnList, selectedCdnIndex: newIndex });
  emit('save');
}

function removeCustomCdn(index: number) {
  const strategy = getStrategy();
  const cdn = strategy.cdnList[index];
  if (cdn.isPreset) return;
  const newCdnList = strategy.cdnList.filter((_, i) => i !== index);
  let newSelectedIndex = strategy.selectedCdnIndex;
  if (newSelectedIndex >= newCdnList.length) {
    newSelectedIndex = 0;
  }
  emit('update:urlStrategy', { ...strategy, cdnList: newCdnList, selectedCdnIndex: newSelectedIndex });
  emit('save');
}

function resetCdnToDefault() {
  const strategy = getStrategy();
  emit('update:urlStrategy', { ...strategy, selectedCdnIndex: 0, cdnList: [...DEFAULT_GITHUB_CDN_LIST] });
  emit('save');
}
</script>

<template>
  <div class="card-subsection">
    <label class="subsection-title">URL 策略</label>
    <p class="subsection-hint">控制上传后生成的图片链接格式。</p>

    <div class="strategy-options">
      <label class="strategy-option" for="strategy-default">
        <RadioButton v-model="strategyType" value="default" inputId="strategy-default" />
        <span>默认（GitHub Raw）</span>
      </label>
      <label class="strategy-option" for="strategy-cdn">
        <RadioButton v-model="strategyType" value="cdn" inputId="strategy-cdn" />
        <span>CDN 加速</span>
      </label>
      <label class="strategy-option" for="strategy-custom">
        <RadioButton v-model="strategyType" value="custom-domain" inputId="strategy-custom" />
        <span>自定义域名</span>
      </label>
    </div>

    <div v-if="strategyType === 'cdn'" class="strategy-detail">
      <div class="cdn-select-row">
        <Select
          v-model="selectedCdnIndex"
          :options="cdnOptions"
          optionLabel="label"
          optionValue="value"
          class="cdn-select"
          placeholder="选择 CDN"
        />
        <Button
          icon="pi pi-plus"
          @click="addCustomCdn"
          v-tooltip.top="'添加自定义 CDN'"
          outlined
          size="small"
        />
        <Button
          icon="pi pi-refresh"
          @click="resetCdnToDefault"
          v-tooltip.top="'恢复默认'"
          outlined
          severity="secondary"
          size="small"
        />
      </div>

      <div v-if="isCustomCdnSelected" class="custom-cdn-template">
        <div class="template-input-row">
          <InputText
            :modelValue="selectedCdnTemplate"
            @update:modelValue="(val) => updateCustomCdnTemplate(val as string)"
            @blur="emit('save')"
            class="flex-1"
            :class="{ 'p-invalid': !validateCdnTemplate(selectedCdnTemplate) }"
            placeholder="https://example.com/gh/{owner}/{repo}@{branch}/{path}"
          />
          <Button
            icon="pi pi-times"
            @click="removeCustomCdn(selectedCdnIndex)"
            text
            severity="danger"
            size="small"
          />
        </div>
        <small v-if="!validateCdnTemplate(selectedCdnTemplate)" class="form-hint text-red-400">
          模板必须包含 {owner}、{repo}、{branch}、{path} 占位符
        </small>
      </div>
    </div>

    <div v-if="strategyType === 'custom-domain'" class="strategy-detail">
      <InputText
        v-model="customDomain"
        @blur="emit('save')"
        class="w-full"
        placeholder="https://cdn.example.com"
      />
      <small class="form-hint">自定义域名，将替代默认的 raw.githubusercontent.com</small>
    </div>

    <div class="cdn-preview">
      <span class="cdn-preview-label">预览</span>
      <code>{{ previewUrl }}</code>
    </div>
  </div>
</template>

<style scoped>
@import '../../../styles/settings-shared.css';

.strategy-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.strategy-option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 14px;
  color: var(--text-primary);
}

.strategy-detail {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cdn-select-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cdn-select {
  flex: 1;
}

.custom-cdn-template {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.template-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
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
