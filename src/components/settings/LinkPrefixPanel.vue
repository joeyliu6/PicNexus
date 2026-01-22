<script setup lang="ts">
// 链接前缀设置面板组件

import { computed } from 'vue';
import InputText from 'primevue/inputtext';
import Checkbox from 'primevue/checkbox';
import RadioButton from 'primevue/radiobutton';
import Button from 'primevue/button';

// ==================== Props ====================

interface Props {
  /** 是否启用链接前缀 */
  enabled: boolean;

  /** 前缀列表 */
  prefixList: string[];

  /** 选中的前缀索引 */
  selectedIndex: number;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  /** 启用状态变更 */
  'update:enabled': [enabled: boolean];

  /** 前缀列表变更 */
  'update:prefixList': [list: string[]];

  /** 选中索引变更 */
  'update:selectedIndex': [index: number];

  /** 保存设置 */
  'save': [];

  /** 添加前缀 */
  'addPrefix': [];

  /** 删除前缀 */
  'removePrefix': [index: number];

  /** 恢复默认前缀 */
  'resetToDefault': [];
}>();

// ==================== 计算属性 ====================

const localEnabled = computed({
  get: () => props.enabled,
  set: (val) => emit('update:enabled', val)
});

const localSelectedIndex = computed({
  get: () => props.selectedIndex,
  set: (val) => emit('update:selectedIndex', val)
});

// ==================== 方法 ====================

function handleEnabledChange() {
  emit('save');
}

function handlePrefixChange(index: number, value: string) {
  const newList = [...props.prefixList];
  newList[index] = value;
  emit('update:prefixList', newList);
}

function handlePrefixBlur() {
  emit('save');
}

function handleSelectedChange() {
  emit('save');
}

function handleAddPrefix() {
  emit('addPrefix');
}

function handleRemovePrefix(index: number) {
  emit('removePrefix', index);
}

function handleResetToDefault() {
  emit('resetToDefault');
}
</script>

<template>
  <div class="link-prefix-panel">
    <div class="section-header">
      <h2>链接前缀</h2>
      <p class="section-desc">为微博图片添加代理前缀以绕过防盗链限制。</p>
    </div>

    <div class="form-group mb-4">
      <div class="flex items-center gap-2">
        <Checkbox
          v-model="localEnabled"
          :binary="true"
          inputId="prefix-enable"
          @change="handleEnabledChange"
        />
        <label for="prefix-enable" class="font-medium cursor-pointer">启用链接前缀</label>
      </div>
    </div>

    <div v-if="enabled" class="prefix-list">
      <div v-for="(prefix, idx) in prefixList" :key="idx" class="prefix-row">
        <RadioButton
          v-model="localSelectedIndex"
          :value="idx"
          :inputId="'p-' + idx"
          @change="handleSelectedChange"
        />
        <InputText
          :modelValue="prefix"
          @update:modelValue="(val) => handlePrefixChange(idx, val as string)"
          @blur="handlePrefixBlur"
          class="flex-1"
        />
        <Button
          icon="pi pi-trash"
          @click="handleRemovePrefix(idx)"
          text
          severity="danger"
          :disabled="prefixList.length <= 1"
        />
      </div>
      <Button
        label="添加新前缀"
        icon="pi pi-plus"
        @click="handleAddPrefix"
        outlined
        class="w-full mt-2"
        size="small"
      />
      <Button
        label="恢复默认前缀"
        icon="pi pi-refresh"
        @click="handleResetToDefault"
        outlined
        severity="secondary"
        size="small"
        class="w-full mt-2"
      />
    </div>
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

/* 前缀列表 */
.prefix-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prefix-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
