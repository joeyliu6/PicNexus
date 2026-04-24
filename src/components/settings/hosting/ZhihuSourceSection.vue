<script setup lang="ts">
import { computed, ref } from 'vue';
import InputText from 'primevue/inputtext';
import ToggleSwitch from 'primevue/toggleswitch';
import Button from 'primevue/button';
import { ZHIHU_SOURCE_DEFAULT_VALUE } from '../../../utils/zhihuSource';

interface Props {
  enabled: boolean;
  value: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:enabled': [enabled: boolean];
  'update:value': [value: string];
  save: [];
}>();

const showDetails = ref(false);

const localEnabled = computed({
  get: () => props.enabled,
  set: (v) => {
    emit('update:enabled', v);
    emit('save');
  }
});

const localValue = computed({
  get: () => props.value,
  set: (v) => emit('update:value', v),
});

function handleBlur() {
  const trimmed = (localValue.value ?? '').trim();
  if (trimmed !== localValue.value) {
    emit('update:value', trimmed);
  }
  emit('save');
}

function handleResetDefault() {
  emit('update:value', ZHIHU_SOURCE_DEFAULT_VALUE);
  emit('save');
}
</script>

<template>
  <div class="card-subsection">
    <div class="source-title-row">
      <div class="source-title-text">
        <label class="subsection-title">让知乎图片正常显示</label>
        <span class="source-title-desc">在链接后自动补一个参数，避免外链 403</span>
      </div>
      <ToggleSwitch v-model="localEnabled" class="source-toggle" />
    </div>

    <div v-if="enabled" class="source-body">
      <div class="source-field-row">
        <span class="source-field-label">参数值</span>
        <InputText
          v-model="localValue"
          :placeholder="ZHIHU_SOURCE_DEFAULT_VALUE"
          class="flex-1 source-value-input"
          size="small"
          @blur="handleBlur"
        />
        <Button
          v-tooltip.top="'恢复默认值'"
          icon="pi pi-refresh"
          text
          rounded
          size="small"
          @click="handleResetDefault"
        />
      </div>

      <button type="button" class="source-details-toggle" @click="showDetails = !showDetails">
        <i :class="['pi', showDetails ? 'pi-chevron-down' : 'pi-chevron-right']"></i>
        <span>这个参数是什么？要不要改？</span>
      </button>

      <div v-if="showDetails" class="source-details">
        <p>
          知乎的图片只有在「从知乎内部打开」时才放行。外部打开会被拒绝（HTTP 403），
          表现为图片加载失败。给链接结尾加一个 <code>?source=xxx</code> 可以骗过校验，
          这样图片在 Markdown 预览、博客、飞书、Notion 里都能正常显示。
        </p>
        <p class="source-details-tip">
          默认 <code>{{ ZHIHU_SOURCE_DEFAULT_VALUE }}</code> 是从知乎网页端抓包拿到的可用值，
          非官方文档。万一哪天失效（显示回 403），你可以自己在浏览器里打开任意知乎图片，
          复制链接里的 <code>source=</code> 值填在这里。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('../../../styles/settings-shared.css');

.source-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.source-title-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  min-width: 0;
  flex: 1;
}

.source-title-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: 1.4;
}

.source-toggle {
  flex-shrink: 0;
}

.source-body {
  margin-top: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.source-field-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.source-field-label {
  font-size: var(--text-xs);
  color: var(--text-muted);
  flex-shrink: 0;
}

.source-value-input {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.source-details-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) 0;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--text-muted);
  transition: color var(--duration-fast) ease;
  align-self: flex-start;
}

.source-details-toggle:hover {
  color: var(--primary);
}

.source-details-toggle i {
  font-size: var(--text-xs);
}

.source-details {
  padding: var(--space-sm) var(--space-sm-md);
  background: var(--hover-overlay-subtle);
  border-radius: var(--radius-xs-sm);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.source-details p {
  margin: 0;
}

.source-details-tip {
  color: var(--text-muted);
}

.source-details code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1px 为 inline code 微调间距 */
  padding: 1px var(--space-xs);
  background: var(--hover-overlay);
  border-radius: var(--radius-xs-sm);
  color: var(--primary);
}
</style>
