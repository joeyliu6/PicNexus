<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import ToggleSwitch from 'primevue/toggleswitch';
import InputText from 'primevue/inputtext';
import Divider from 'primevue/divider';
import ShortcutInput from './ShortcutInput.vue';
import type { ThemeMode, ServiceType } from '../../config/types';
import { PRIVATE_SERVICES, PUBLIC_SERVICES } from '../../config/types';
import { LINK_FORMAT_OPTIONS, type LinkFormat } from '../../utils/linkFormatter';

// ==================== Props ====================

interface Props {
  currentTheme: ThemeMode;
  availableServices: ServiceType[];
  serviceNames: Record<ServiceType, string>;
  serviceConfigStatus: Record<ServiceType, boolean>;
  autoStart: boolean;
  minimizeToTrayOnStart: boolean;
  analyticsEnabled: boolean;
  isClearingCache: boolean;
  linkDefaultFormat: LinkFormat;
  linkCustomTemplate: string;
  linkAutoCopy: boolean;
  globalShortcutEnabled: boolean;
  shortcutUploadClipboard: string;
  shortcutUploadFromFile: string;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  'update:currentTheme': [theme: ThemeMode];
  'update:availableServices': [services: ServiceType[]];
  'update:autoStart': [enabled: boolean];
  'update:minimizeToTrayOnStart': [enabled: boolean];
  'update:analyticsEnabled': [enabled: boolean];
  'update:linkDefaultFormat': [format: LinkFormat];
  'update:linkCustomTemplate': [template: string];
  'update:linkAutoCopy': [enabled: boolean];
  'update:globalShortcutEnabled': [enabled: boolean];
  'update:shortcutUploadClipboard': [shortcut: string];
  'update:shortcutUploadFromFile': [shortcut: string];
  'navigate-to-hosting': [serviceId: ServiceType];
  'clearHistory': [];
  'clearCache': [];
  'reopenOnboarding': [];
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

const localAnalyticsEnabled = computed({
  get: () => props.analyticsEnabled,
  set: (val) => emit('update:analyticsEnabled', val)
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

function handleChipClick(svc: ServiceType) {
  if (props.serviceConfigStatus[svc]) {
    toggleService(svc);
  } else {
    emit('navigate-to-hosting', svc);
  }
}

function handleFormatChange(format: LinkFormat) {
  emit('update:linkDefaultFormat', format);
  emit('save');
}

function handleAutoCopyChange(enabled: boolean) {
  emit('update:linkAutoCopy', enabled);
  emit('save');
}

function handleTemplateChange(template: string | undefined) {
  emit('update:linkCustomTemplate', template || '{url}');
  emit('save');
}
</script>

<template>
  <div class="general-settings-panel">
    <div class="section-header">
      <h2>常规设置</h2>
      <p class="section-desc">管理应用外观、启动行为与启用的服务模块。</p>
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
      <p class="helper-text">点击服务卡片可跳转到图床配置，勾选复选框控制在「上传界面」的显示。</p>

      <div class="service-group-section">
        <div class="service-group-title">私有图床</div>
        <div class="service-toggles-grid">
          <div
            v-for="svc in PRIVATE_SERVICES"
            :key="svc"
            class="toggle-chip"
            :class="{ disabled: !serviceConfigStatus[svc] }"
            v-tooltip.top="!serviceConfigStatus[svc] ? '尚未配置，点击前往设置' : null"
            @click="handleChipClick(svc)"
          >
            <Checkbox
              :modelValue="localAvailableServices.includes(svc)"
              :binary="true"
              :disabled="!serviceConfigStatus[svc]"
              @click.stop
              @update:modelValue="toggleService(svc)"
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
            v-tooltip.top="!serviceConfigStatus[svc] ? '尚未配置，点击前往设置' : null"
            @click="handleChipClick(svc)"
          >
            <Checkbox
              :modelValue="localAvailableServices.includes(svc)"
              :binary="true"
              :disabled="!serviceConfigStatus[svc]"
              @click.stop
              @update:modelValue="toggleService(svc)"
            />
            <span class="toggle-label">{{ serviceNames[svc] }}</span>
          </div>
        </div>
      </div>
    </div>

    <Divider />

    <!-- 应用行为 -->
    <div class="form-group">
      <label class="group-label">应用行为</label>
      <div class="behavior-toggles">
        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-row-label">开机自启动</span>
            <span class="toggle-row-desc">系统启动时自动运行 PicNexus</span>
          </div>
          <ToggleSwitch
            :modelValue="autoStart"
            @update:modelValue="(v: boolean) => emit('update:autoStart', v)"
          />
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-row-label">启动时最小化到托盘</span>
            <span class="toggle-row-desc">启动后不显示主窗口，仅显示托盘图标</span>
          </div>
          <ToggleSwitch
            :modelValue="minimizeToTrayOnStart"
            @update:modelValue="(v: boolean) => emit('update:minimizeToTrayOnStart', v)"
          />
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-row-label">使用数据收集</span>
            <span class="toggle-row-desc">允许发送匿名使用统计，帮助改进应用。不收集任何个人信息或上传内容。</span>
          </div>
          <ToggleSwitch
            v-model="localAnalyticsEnabled"
            @change="emit('save')"
          />
        </div>
      </div>
    </div>

    <Divider />

    <!-- 全局快捷键 -->
    <div class="form-group">
      <label class="group-label">全局快捷键</label>
      <p class="helper-text">在任何应用中通过快捷键直接触发上传，无需切换窗口。</p>
      <div class="behavior-toggles">
        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-row-label">启用全局快捷键</span>
            <span class="toggle-row-desc">注册系统级快捷键，在后台也能触发上传</span>
          </div>
          <ToggleSwitch
            :modelValue="globalShortcutEnabled"
            @update:modelValue="(v: boolean) => { emit('update:globalShortcutEnabled', v); emit('save'); }"
          />
        </div>
      </div>
      <div v-if="globalShortcutEnabled" class="shortcut-config">
        <div class="shortcut-row">
          <span class="shortcut-label">剪贴板图片上传</span>
          <ShortcutInput
            :modelValue="shortcutUploadClipboard"
            placeholder="点击录入快捷键"
            @update:modelValue="(v: string) => { emit('update:shortcutUploadClipboard', v); emit('save'); }"
          />
        </div>
        <div class="shortcut-row">
          <span class="shortcut-label">选择文件上传</span>
          <ShortcutInput
            :modelValue="shortcutUploadFromFile"
            placeholder="点击录入快捷键"
            @update:modelValue="(v: string) => { emit('update:shortcutUploadFromFile', v); emit('save'); }"
          />
        </div>
      </div>
    </div>

    <Divider />

    <!-- 链接输出 -->
    <div class="form-group">
      <label class="group-label">链接输出</label>
      <p class="helper-text">控制上传完成后链接的复制格式和行为。</p>

      <div class="behavior-toggles">
        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-row-label">上传后自动复制链接</span>
            <span class="toggle-row-desc">全部上传完成后，自动将主力图床链接复制到剪贴板</span>
          </div>
          <ToggleSwitch
            :modelValue="linkAutoCopy"
            @update:modelValue="handleAutoCopyChange"
          />
        </div>
      </div>

      <div class="format-section">
        <span class="format-section-label">默认复制格式</span>
        <div class="format-options">
          <div
            v-for="opt in LINK_FORMAT_OPTIONS"
            :key="opt.format"
            class="format-card"
            :class="{ active: linkDefaultFormat === opt.format }"
            @click="handleFormatChange(opt.format)"
          >
            <i :class="'pi ' + opt.icon"></i>
            <span class="format-card-label">{{ opt.label }}</span>
          </div>
        </div>
      </div>

      <div v-if="linkDefaultFormat === 'custom'" class="custom-template-section">
        <span class="format-section-label">自定义模板</span>
        <InputText
          :modelValue="linkCustomTemplate"
          placeholder="{url}"
          class="template-input"
          @update:modelValue="handleTemplateChange"
        />
        <p class="helper-text template-hint">
          可用变量：<code>{url}</code>、<code>{filename}</code>、<code>{width}</code>、<code>{height}</code>
        </p>
      </div>
    </div>

    <Divider />

    <!-- 数据管理 -->
    <div class="form-group">
      <label class="group-label">数据管理</label>
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
          :loading="isClearingCache"
          @click="emit('clearCache')"
        />
        <Button
          label="重新打开引导"
          icon="pi pi-question-circle"
          severity="secondary"
          outlined
          @click="emit('reopenOnboarding')"
        />
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

/* 应用行为 */
.behavior-toggles {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-row-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.toggle-row-desc {
  font-size: 12px;
  color: var(--text-muted);
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
  cursor: pointer;
  background: var(--bg-app);
}

.toggle-chip.disabled:hover {
  border-color: var(--primary);
  border-style: dashed;
}

.toggle-chip .toggle-label {
  font-size: 13px;
  color: var(--text-primary);
  flex: 1;
}

.toggle-chip.disabled .toggle-label {
  color: var(--text-muted);
}

/* 快捷键配置 */
.shortcut-config {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
}

.shortcut-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

/* 链接输出格式 */
.format-section {
  margin-top: 12px;
}

.format-section-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.format-options {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.format-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background-color: var(--bg-card);
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-secondary);
  font-size: 13px;
}

.format-card:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.format-card.active {
  border-color: var(--primary);
  background-color: rgba(59, 130, 246, 0.05);
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--primary);
}

.format-card i {
  font-size: 14px;
}

.custom-template-section {
  margin-top: 12px;
}

.template-input {
  width: 100%;
  font-family: 'Fira Code', 'Cascadia Code', monospace;
  font-size: 13px;
}

.template-hint {
  margin-top: 6px;
}

.template-hint code {
  font-family: 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  padding: 1px 5px;
  background: var(--bg-app);
  border-radius: 3px;
  color: var(--primary);
}
</style>
