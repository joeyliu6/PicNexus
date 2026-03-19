<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import ToggleSwitch from 'primevue/toggleswitch';
import InputText from 'primevue/inputtext';
import Divider from 'primevue/divider';
import ShortcutInput from './ShortcutInput.vue';
import type { ThemeMode } from '../../config/types';
import { LINK_FORMAT_OPTIONS, type LinkFormat } from '../../utils/linkFormatter';

// ==================== Props ====================

interface Props {
  currentTheme: ThemeMode;
  autoStart: boolean;
  minimizeToTrayOnStart: boolean;
  closeToTray: boolean;
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
  'update:autoStart': [enabled: boolean];
  'update:minimizeToTrayOnStart': [enabled: boolean];
  'update:closeToTray': [enabled: boolean];
  'update:analyticsEnabled': [enabled: boolean];
  'update:linkDefaultFormat': [format: LinkFormat];
  'update:linkCustomTemplate': [template: string];
  'update:linkAutoCopy': [enabled: boolean];
  'update:globalShortcutEnabled': [enabled: boolean];
  'update:shortcutUploadClipboard': [shortcut: string];
  'update:shortcutUploadFromFile': [shortcut: string];
  'clearHistory': [];
  'clearCache': [];

  'save': [];
}>();

// ==================== 常量 ====================

const themeOptions = [
  { value: 'light', label: '浅色', icon: 'pi pi-sun' },
  { value: 'dark', label: '深色', icon: 'pi pi-moon' },
  { value: 'auto', label: '跟随系统', icon: 'pi pi-desktop' }
];

// ==================== 计算属性 ====================

const localAnalyticsEnabled = computed({
  get: () => props.analyticsEnabled,
  set: (val) => emit('update:analyticsEnabled', val)
});

// ==================== 方法 ====================

function handleThemeChange(theme: ThemeMode) {
  emit('update:currentTheme', theme);
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
      <p class="section-desc">管理应用外观、启动行为与链接输出。</p>
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

    <!-- 应用行为 -->
    <div class="form-group">
      <label class="group-label">应用行为</label>
      <div class="behavior-toggles">
        <div class="toggle-group">
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
              <span class="toggle-row-label">静默启动</span>
              <span class="toggle-row-desc">启动时直接最小化到托盘，不弹出主窗口</span>
            </div>
            <ToggleSwitch
              :modelValue="minimizeToTrayOnStart"
              @update:modelValue="(v: boolean) => emit('update:minimizeToTrayOnStart', v)"
            />
          </div>
          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-row-label">关闭时最小化到托盘</span>
              <span class="toggle-row-desc">关闭窗口时不退出应用，最小化到系统托盘</span>
            </div>
            <ToggleSwitch
              :modelValue="closeToTray"
              @update:modelValue="(v: boolean) => emit('update:closeToTray', v)"
            />
          </div>
        </div>
      </div>
    </div>

    <Divider />

    <!-- 全局快捷键 -->
    <div class="form-group">
      <label class="group-label">全局快捷键</label>
      <p class="helper-text">在任何应用中通过快捷键直接触发上传，无需切换窗口。</p>
      <div class="behavior-toggles">
        <div class="toggle-group">
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
          <div v-if="globalShortcutEnabled" class="shortcut-row-in-group">
            <span class="shortcut-label">剪贴板图片上传</span>
            <ShortcutInput
              :modelValue="shortcutUploadClipboard"
              placeholder="点击录入快捷键"
              @update:modelValue="(v: string) => { emit('update:shortcutUploadClipboard', v); emit('save'); }"
            />
          </div>
          <div v-if="globalShortcutEnabled" class="shortcut-row-in-group">
            <span class="shortcut-label">选择文件上传</span>
            <ShortcutInput
              :modelValue="shortcutUploadFromFile"
              placeholder="点击录入快捷键"
              @update:modelValue="(v: string) => { emit('update:shortcutUploadFromFile', v); emit('save'); }"
            />
          </div>
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

    <!-- 数据与隐私 -->
    <div class="form-group">
      <label class="group-label">数据与隐私</label>
      <p class="helper-text">管理上传历史、应用缓存与隐私偏好。</p>
      <div class="behavior-toggles">
        <div class="toggle-group">
          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-row-label">帮助改进 PicNexus</span>
              <span class="toggle-row-desc">发送匿名使用统计，帮助我们持续优化体验。不涉及个人信息或上传内容。</span>
            </div>
            <ToggleSwitch
              v-model="localAnalyticsEnabled"
              @change="emit('save')"
            />
          </div>
        </div>
      </div>
      <div class="flex gap-2 flex-wrap" style="margin-top: 20px;">
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
  background-color: var(--primary-alpha-5);
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--primary);
}

/* 应用行为 */
.behavior-toggles {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toggle-group {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-card);
}

.toggle-group .toggle-row {
  border: none;
  border-radius: 0;
  background: transparent;
  border-bottom: 1px solid var(--border-subtle);
}

.toggle-group .toggle-row:last-child {
  border-bottom: none;
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

/* 快捷键配置（卡片内） */
.shortcut-row-in-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.shortcut-row-in-group:last-child {
  border-bottom: none;
}

.shortcut-label {
  font-size: 14px;
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
  background-color: var(--primary-alpha-5);
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
