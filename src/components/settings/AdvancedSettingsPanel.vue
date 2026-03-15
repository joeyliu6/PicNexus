<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import Divider from 'primevue/divider';
import ToggleSwitch from 'primevue/toggleswitch';

interface Props {
  analyticsEnabled: boolean;
  isClearingCache: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:analyticsEnabled': [enabled: boolean];
  clearHistory: [];
  clearCache: [];
  save: [];
}>();

const localAnalyticsEnabled = computed({
  get: () => props.analyticsEnabled,
  set: (val) => emit('update:analyticsEnabled', val)
});
</script>

<template>
  <div class="advanced-settings-panel">
    <div class="section-header">
      <h2>高级设置</h2>
      <p class="section-desc">记录管理与隐私设置。</p>
    </div>

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
