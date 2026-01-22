<script setup lang="ts">
// 常规设置面板组件

import { computed } from 'vue';
import Checkbox from 'primevue/checkbox';
import RadioButton from 'primevue/radiobutton';
import Divider from 'primevue/divider';
import type { ThemeMode, ServiceType } from '../../config/types';
import { PRIVATE_SERVICES, PUBLIC_SERVICES } from '../../config/types';

// ==================== Props ====================

interface Props {
  /** 当前主题 */
  currentTheme: ThemeMode;

  /** 启用的服务列表 */
  availableServices: ServiceType[];

  /** 默认历史视图模式 */
  defaultHistoryViewMode: 'grid' | 'table';

  /** 服务名称映射 */
  serviceNames: Record<ServiceType, string>;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  /** 主题变更 */
  'update:currentTheme': [theme: ThemeMode];

  /** 启用服务变更 */
  'update:availableServices': [services: ServiceType[]];

  /** 默认视图模式变更 */
  'update:defaultHistoryViewMode': [mode: 'grid' | 'table'];

  /** 保存设置 */
  'save': [];
}>();

// ==================== 常量 ====================

const themeOptions = [
  { value: 'light', label: '浅色', icon: 'pi pi-sun' },
  { value: 'dark', label: '深色', icon: 'pi pi-moon' }
];

// ==================== 计算属性 ====================

const localAvailableServices = computed({
  get: () => props.availableServices,
  set: (val) => emit('update:availableServices', val)
});

const localDefaultHistoryViewMode = computed({
  get: () => props.defaultHistoryViewMode,
  set: (val) => emit('update:defaultHistoryViewMode', val)
});

// ==================== 方法 ====================

function handleThemeChange(theme: ThemeMode) {
  emit('update:currentTheme', theme);
  emit('save');
}

function handleServiceChange() {
  emit('save');
}

function handleViewModeChange() {
  emit('save');
}
</script>

<template>
  <div class="general-settings-panel">
    <div class="section-header">
      <h2>常规设置</h2>
      <p class="section-desc">管理应用外观与启用的服务模块。</p>
    </div>

    <!-- 外观主题 -->
    <div class="form-group">
      <label class="group-label">外观主题</label>
      <div class="theme-options">
        <div
          v-for="opt in themeOptions"
          :key="opt.value"
          class="theme-card"
          :class="{ active: currentTheme === opt.value }"
          @click="handleThemeChange(opt.value as ThemeMode)"
        >
          <i :class="opt.icon"></i>
          <span>{{ opt.label }}</span>
        </div>
      </div>
    </div>

    <Divider />

    <!-- 启用的图床服务 -->
    <div class="form-group">
      <label class="group-label">启用的图床服务</label>
      <p class="helper-text">勾选要在"上传界面"显示的服务。</p>

      <div class="service-group-section">
        <div class="service-group-title">私有图床</div>
        <div class="service-toggles-grid">
          <div
            v-for="svc in PRIVATE_SERVICES"
            :key="svc"
            class="toggle-chip"
          >
            <Checkbox
              :inputId="'svc-' + svc"
              v-model="localAvailableServices"
              :value="svc"
              @change="handleServiceChange"
            />
            <label :for="'svc-' + svc">{{ serviceNames[svc] }}</label>
          </div>
        </div>
      </div>

      <div class="service-group-section">
        <div class="service-group-title">公共图床</div>
        <div class="service-toggles-grid">
          <div
            v-for="svc in PUBLIC_SERVICES"
            :key="svc"
            class="toggle-chip"
          >
            <Checkbox
              :inputId="'svc-' + svc"
              v-model="localAvailableServices"
              :value="svc"
              @change="handleServiceChange"
            />
            <label :for="'svc-' + svc">{{ serviceNames[svc] }}</label>
          </div>
        </div>
      </div>
    </div>

    <Divider />

    <!-- 浏览界面默认视图 -->
    <div class="form-group">
      <label class="group-label">浏览界面默认视图</label>
      <p class="helper-text">设置进入"浏览界面"页面时默认显示的视图模式。</p>
      <div class="view-mode-options">
        <div class="radio-option">
          <RadioButton
            v-model="localDefaultHistoryViewMode"
            inputId="view-grid"
            value="grid"
            @change="handleViewModeChange"
          />
          <label for="view-grid" class="radio-label">瀑布流视图</label>
        </div>
        <div class="radio-option">
          <RadioButton
            v-model="localDefaultHistoryViewMode"
            inputId="view-table"
            value="table"
            @change="handleViewModeChange"
          />
          <label for="view-table" class="radio-label">表格视图</label>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

/* 主题卡片 */
.theme-options {
  display: flex;
  gap: 16px;
}

.theme-card {
  flex: 1;
  padding: 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background-color: var(--bg-card);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: all 0.2s;
  color: var(--text-secondary);
}

.theme-card:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.theme-card.active {
  border-color: var(--primary);
  background-color: rgba(59, 130, 246, 0.05);
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--primary);
}

/* 服务分组样式 */
.service-group-section {
  margin-bottom: 16px;
}

.service-group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.service-toggles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.toggle-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-chip:hover {
  border-color: var(--text-muted);
}

.toggle-chip label {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
}

/* 视图模式选择器 */
.view-mode-options {
  display: flex;
  gap: 16px;
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.radio-option:hover {
  border-color: var(--primary);
}

.radio-option:has(:deep(.p-radiobutton-checked)) {
  border-color: var(--primary);
  background-color: rgba(59, 130, 246, 0.05);
}

.radio-label {
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 14px;
}

.radio-option:has(:deep(.p-radiobutton-checked)) .radio-label {
  color: var(--primary);
  font-weight: 500;
}
</style>
