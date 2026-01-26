<script setup lang="ts">
// 高级设置面板组件 - 整合链接前缀、记录与缓存管理、隐私设置

import { computed } from 'vue';
import InputText from 'primevue/inputtext';
import Checkbox from 'primevue/checkbox';
import RadioButton from 'primevue/radiobutton';
import Button from 'primevue/button';
import Divider from 'primevue/divider';
import ToggleSwitch from 'primevue/toggleswitch';

// ==================== Props ====================

interface Props {
  /** 是否启用链接前缀 */
  linkPrefixEnabled: boolean;

  /** 前缀列表 */
  prefixList: string[];

  /** 选中的前缀索引 */
  selectedPrefixIndex: number;

  /** 是否启用数据分析 */
  analyticsEnabled: boolean;

  /** 是否正在清理缓存 */
  isClearingCache: boolean;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  /** 链接前缀启用状态变更 */
  'update:linkPrefixEnabled': [enabled: boolean];

  /** 前缀列表变更 */
  'update:prefixList': [list: string[]];

  /** 选中索引变更 */
  'update:selectedPrefixIndex': [index: number];

  /** 数据分析开关变更 */
  'update:analyticsEnabled': [enabled: boolean];

  /** 清空历史记录 */
  'clearHistory': [];

  /** 清理缓存 */
  'clearCache': [];

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

const localLinkPrefixEnabled = computed({
  get: () => props.linkPrefixEnabled,
  set: (val) => emit('update:linkPrefixEnabled', val)
});

const localSelectedPrefixIndex = computed({
  get: () => props.selectedPrefixIndex,
  set: (val) => emit('update:selectedPrefixIndex', val)
});

const localAnalyticsEnabled = computed({
  get: () => props.analyticsEnabled,
  set: (val) => emit('update:analyticsEnabled', val)
});

// ==================== 方法 ====================

function handlePrefixChange(index: number, value: string) {
  const newList = [...props.prefixList];
  newList[index] = value;
  emit('update:prefixList', newList);
}
</script>

<template>
  <div class="advanced-settings-panel">
    <div class="section-header">
      <h2>高级设置</h2>
      <p class="section-desc">链接前缀、记录管理与隐私设置。</p>
    </div>

    <!-- 链接前缀 -->
    <div class="form-group">
      <label class="group-label">链接前缀</label>
      <p class="helper-text">为微博图片添加代理前缀以绕过防盗链限制。</p>

      <div class="flex items-center gap-2 mb-3">
        <Checkbox
          v-model="localLinkPrefixEnabled"
          :binary="true"
          inputId="prefix-enable"
          @change="emit('save')"
        />
        <label for="prefix-enable" class="font-medium cursor-pointer">启用链接前缀</label>
      </div>

      <div v-if="linkPrefixEnabled" class="prefix-list">
        <div v-for="(prefix, idx) in prefixList" :key="idx" class="prefix-row">
          <RadioButton
            v-model="localSelectedPrefixIndex"
            :value="idx"
            :inputId="'p-' + idx"
            @change="emit('save')"
          />
          <InputText
            :modelValue="prefix"
            @update:modelValue="(val) => handlePrefixChange(idx, val as string)"
            @blur="emit('save')"
            class="flex-1"
          />
          <Button
            icon="pi pi-trash"
            @click="emit('removePrefix', idx)"
            text
            severity="danger"
            :disabled="prefixList.length <= 1"
          />
        </div>
        <div class="flex gap-2 mt-2">
          <Button
            label="添加新前缀"
            icon="pi pi-plus"
            @click="emit('addPrefix')"
            outlined
            size="small"
          />
          <Button
            label="恢复默认前缀"
            icon="pi pi-refresh"
            @click="emit('resetToDefault')"
            outlined
            severity="secondary"
            size="small"
          />
        </div>
      </div>
    </div>

    <Divider />

    <!-- 记录与缓存管理 -->
    <div class="form-group">
      <label class="group-label">记录与缓存管理</label>
      <p class="helper-text">管理上传历史记录和应用缓存。</p>
      <div class="flex gap-2 flex-wrap">
        <Button
          label="清空历史记录"
          icon="pi pi-trash"
          severity="danger"
          outlined
          @click="emit('clearHistory')"
        />
        <Button
          label="清理应用缓存"
          icon="pi pi-refresh"
          severity="secondary"
          outlined
          @click="emit('clearCache')"
          :loading="isClearingCache"
        />
      </div>
    </div>

    <Divider />

    <!-- 隐私设置 -->
    <div class="form-group">
      <label class="group-label">隐私设置</label>
      <p class="helper-text">管理应用使用数据的收集。</p>

      <div class="privacy-setting">
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">使用数据收集</span>
            <span class="setting-desc">
              允许发送匿名使用统计，帮助改进应用。不收集任何个人信息或上传内容。
            </span>
          </div>
          <ToggleSwitch
            v-model="localAnalyticsEnabled"
            @change="emit('save')"
          />
        </div>
      </div>
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

/* 隐私设置 */
.privacy-setting {
  background: var(--selected-bg);
  border: 1px solid var(--primary-border);
  border-radius: 8px;
  padding: 16px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.setting-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.setting-desc {
  font-size: 13px;
  color: var(--text-muted);
}
</style>
