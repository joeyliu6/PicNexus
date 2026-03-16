<script setup lang="ts">
// 常规设置面板组件

import { computed } from 'vue';
import Checkbox from 'primevue/checkbox';
import Divider from 'primevue/divider';
import type { ThemeMode, ServiceType } from '../../config/types';
import { PRIVATE_SERVICES, PUBLIC_SERVICES } from '../../config/types';

// ==================== Props ====================

interface Props {
  /** 当前主题 */
  currentTheme: ThemeMode;

  /** 启用的服务列表 */
  availableServices: ServiceType[];

  /** 服务名称映射 */
  serviceNames: Record<ServiceType, string>;

  /** 各服务的配置状态 */
  serviceConfigStatus: Record<ServiceType, boolean>;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  /** 主题变更 */
  'update:currentTheme': [theme: ThemeMode];

  /** 启用服务变更 */
  'update:availableServices': [services: ServiceType[]];

  /** 保存设置 */
  'save': [];
}>();

// ==================== 常量 ====================

const themeOptions = [
  { value: 'light', label: '浅色', icon: 'pi pi-sun' },
  { value: 'dark', label: '深色', icon: 'pi pi-moon' },
  { value: 'auto', label: '跟随系统', icon: 'pi pi-desktop' }
];

// ==================== 计算属性 ====================

const localAvailableServices = computed({
  get: () => props.availableServices,
  set: (val) => emit('update:availableServices', val)
});

// ==================== 方法 ====================

function handleThemeChange(theme: ThemeMode) {
  emit('update:currentTheme', theme);
}

function toggleService(service: ServiceType) {
  const current = localAvailableServices.value;
  localAvailableServices.value = current.includes(service)
    ? current.filter(s => s !== service)
    : [...current, service];
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
            :class="{ disabled: !serviceConfigStatus[svc] }"
            v-tooltip.top="!serviceConfigStatus[svc] ? '未配置，请前往图床设置' : ''"
            @click="serviceConfigStatus[svc] && toggleService(svc)"
          >
            <Checkbox
              :modelValue="localAvailableServices.includes(svc)"
              :binary="true"
              :disabled="!serviceConfigStatus[svc]"
              @click.stop
            />
            <span class="toggle-label">{{ serviceNames[svc] }}</span>
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
            :class="{ disabled: !serviceConfigStatus[svc] }"
            v-tooltip.top="!serviceConfigStatus[svc] ? '未配置，请前往图床设置' : ''"
            @click="serviceConfigStatus[svc] && toggleService(svc)"
          >
            <Checkbox
              :modelValue="localAvailableServices.includes(svc)"
              :binary="true"
              :disabled="!serviceConfigStatus[svc]"
              @click.stop
            />
            <span class="toggle-label">{{ serviceNames[svc] }}</span>
          </div>
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

.toggle-chip:hover:not(.disabled) {
  border-color: var(--primary);
}

.toggle-chip.disabled {
  cursor: not-allowed;
  background: var(--bg-app);
}

.toggle-chip .toggle-label {
  font-size: 13px;
  color: var(--text-primary);
}

.toggle-chip.disabled .toggle-label {
  color: var(--text-muted);
}

</style>
