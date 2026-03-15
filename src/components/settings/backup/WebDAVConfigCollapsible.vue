<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Button from 'primevue/button';
import type { WebDAVConfig, WebDAVProfile } from '../../../config/types';
import { useConfirm } from '../../../composables/useConfirm';

interface Props {
  modelValue: WebDAVConfig;
  testing?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [config: WebDAVConfig];
  'save': [];
  'test': [];
}>();

const expanded = ref(false);
const { confirmDelete } = useConfirm();

const activeProfile = computed(() => {
  return props.modelValue.profiles.find(p => p.id === props.modelValue.activeId) || null;
});

const hasValidConfig = computed(() => {
  if (!activeProfile.value) return false;
  return !!(activeProfile.value.url && activeProfile.value.username);
});

const shouldAutoExpand = computed(() => {
  if (props.modelValue.profiles.length === 0) return true;
  if (!props.modelValue.activeId) return true;
  if (activeProfile.value && (!activeProfile.value.url || !activeProfile.value.username)) return true;
  return false;
});

// 状态文字
const statusLabel = computed(() => {
  if (props.testing) return '验证中...';
  if (!activeProfile.value) return '未启用';
  if (!hasValidConfig.value) return '需配置';
  if (activeProfile.value.connectionStatus === 'success') return '已连接';
  if (activeProfile.value.connectionStatus === 'failed') return '连接失败';
  return '待验证';
});

const statusClass = computed(() => {
  if (props.testing) return 'status-testing';
  if (!activeProfile.value) return 'status-disabled';
  if (activeProfile.value.connectionStatus === 'success') return 'status-success';
  if (activeProfile.value.connectionStatus === 'failed') return 'status-error';
  if (!hasValidConfig.value) return 'status-warning';
  return 'status-warning';
});

onMounted(() => {
  if (shouldAutoExpand.value) {
    expanded.value = true;
  }
});

watch(shouldAutoExpand, (needExpand) => {
  if (needExpand) {
    expanded.value = true;
  }
});

function toggleExpand() {
  expanded.value = !expanded.value;
}

function updateActiveProfileField(field: keyof WebDAVProfile, value: string) {
  if (!activeProfile.value) return;

  const updatedProfiles = props.modelValue.profiles.map(p => {
    if (p.id === props.modelValue.activeId) {
      return { ...p, [field]: value };
    }
    return p;
  });

  emit('update:modelValue', {
    ...props.modelValue,
    profiles: updatedProfiles
  });
}

function handleSwitchProfile(id: string) {
  emit('update:modelValue', {
    ...props.modelValue,
    activeId: id
  });
  emit('save');
}

function handleAddProfile() {
  const newProfile: WebDAVProfile = {
    id: Date.now().toString(),
    name: `新配置 ${props.modelValue.profiles.length + 1}`,
    url: '',
    username: '',
    password: '',
    remotePath: '/PicNexus/'
  };

  emit('update:modelValue', {
    ...props.modelValue,
    profiles: [...props.modelValue.profiles, newProfile],
    activeId: newProfile.id
  });
  emit('save');
}

function handleDeleteProfile(id: string) {
  const profile = props.modelValue.profiles.find(p => p.id === id);
  const profileName = profile?.name || '此配置';

  confirmDelete(`确定要删除「${profileName}」吗？此操作无法撤销。`, () => {
    const newProfiles = props.modelValue.profiles.filter(p => p.id !== id);
    let newActiveId = props.modelValue.activeId;

    if (props.modelValue.activeId === id) {
      newActiveId = newProfiles.length > 0 ? newProfiles[0].id : '';
    }

    emit('update:modelValue', {
      ...props.modelValue,
      profiles: newProfiles,
      activeId: newActiveId
    });
    emit('save');
  });
}

function handleSave() {
  emit('save');
}

function handleTest() {
  emit('save');
  emit('test');
}

// 服务商预设（扩展）
const providerPresets = [
  { name: '坚果云', url: 'https://dav.jianguoyun.com/dav/' },
  { name: 'Nextcloud', url: 'https://your-domain.com/remote.php/dav/files/USERNAME/' },
  { name: '群晖 NAS', url: 'https://your-nas-ip:5006/webdav/' },
  { name: 'Alist', url: 'http://localhost:5244/dav/' },
  { name: 'TeraCloud', url: 'https://seto.teracloud.jp/dav/' },
  { name: 'OwnCloud', url: 'https://your-domain.com/remote.php/webdav/' }
];

function applyPreset(preset: typeof providerPresets[0]) {
  if (!activeProfile.value) return;

  const updatedProfiles = props.modelValue.profiles.map(p => {
    if (p.id === props.modelValue.activeId) {
      return { ...p, url: preset.url, name: preset.name };
    }
    return p;
  });

  emit('update:modelValue', {
    ...props.modelValue,
    profiles: updatedProfiles
  });
}
</script>

<template>
  <div class="webdav-collapsible" :class="{ expanded, 'needs-attention': shouldAutoExpand }">
    <!-- 折叠头部 -->
    <button class="collapsible-header" @click="toggleExpand">
      <div class="header-left">
        <span class="header-title">WebDAV 同步</span>
        <span class="header-status-text" :class="statusClass">{{ statusLabel }}</span>
      </div>
      <i :class="expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
    </button>

    <!-- 展开内容（CSS Grid auto-height 动画） -->
    <div class="collapsible-content-wrapper">
      <div class="collapsible-content">
        <!-- 下划线风格 Tabs -->
        <div class="tabs-row">
          <div class="tabs-list">
            <button
              v-for="profile in modelValue.profiles"
              :key="profile.id"
              class="tab-btn"
              :class="{ active: modelValue.activeId === profile.id }"
              @click="handleSwitchProfile(profile.id)"
            >
              {{ profile.name }}
            </button>
          </div>
          <button class="add-btn" @click="handleAddProfile" title="新建配置">+</button>
        </div>

        <!-- 当前配置表单 -->
        <div v-if="activeProfile" class="simple-form">
          <!-- 快速填充预设（独立区块） -->
          <div class="form-row">
            <label class="row-label">快速填充</label>
            <div class="preset-chips">
              <button
                v-for="preset in providerPresets"
                :key="preset.name"
                class="chip-btn"
                @click="applyPreset(preset)"
                :title="preset.url"
              >
                {{ preset.name }}
              </button>
            </div>
          </div>

          <!-- 配置名称（单列） -->
          <div class="form-field">
            <label>配置名称</label>
            <InputText
              :modelValue="activeProfile.name"
              @update:modelValue="(v) => updateActiveProfileField('name', v as string)"
              @blur="handleSave"
              placeholder="如：坚果云、群晖 NAS"
            />
          </div>

          <!-- 服务器 URL（单列） -->
          <div class="form-field">
            <label>服务器 URL</label>
            <InputText
              :modelValue="activeProfile.url"
              @update:modelValue="(v) => updateActiveProfileField('url', v as string)"
              @blur="handleSave"
              placeholder="https://dav.example.com"
            />
          </div>

          <!-- 用户名/密码（并排） -->
          <div class="form-row-split">
            <div class="form-field">
              <label>用户名</label>
              <InputText
                :modelValue="activeProfile.username"
                @update:modelValue="(v) => updateActiveProfileField('username', v as string)"
                @blur="handleSave"
              />
            </div>
            <div class="form-field">
              <label>密码</label>
              <Password
                :modelValue="activeProfile.password"
                @update:modelValue="(v) => updateActiveProfileField('password', v as string)"
                @blur="handleSave"
                :feedback="false"
                toggleMask
              />
            </div>
          </div>

          <!-- 远程路径（单列） -->
          <div class="form-field">
            <label>远程路径</label>
            <InputText
              :modelValue="activeProfile.remotePath"
              @update:modelValue="(v) => updateActiveProfileField('remotePath', v as string)"
              @blur="handleSave"
              placeholder="/PicNexus/"
            />
          </div>

          <!-- 操作按钮 -->
          <div class="form-actions">
            <Button
              label="测试连接"
              icon="pi pi-check"
              @click="handleTest"
              :loading="testing"
              :disabled="!hasValidConfig"
              size="small"
            />
            <div class="spacer"></div>
            <Button
              label="删除配置"
              icon="pi pi-trash"
              @click="handleDeleteProfile(activeProfile.id)"
              severity="danger"
              text
              size="small"
            />
          </div>
        </div>

        <!-- 无配置提示 -->
        <div v-else class="empty-webdav">
          <p>尚未配置 WebDAV 连接</p>
          <Button label="添加配置" icon="pi pi-plus" @click="handleAddProfile" outlined />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '../../../styles/settings-shared.css';

/* 可折叠容器 */
.webdav-collapsible {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  overflow: hidden;
}

.webdav-collapsible.expanded {
  border-color: var(--border-subtle);
}

.webdav-collapsible.needs-attention {
  border-color: var(--warning);
}

/* 折叠头部 */
.collapsible-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-primary);
  transition: background 0.15s;
}

.collapsible-header:hover {
  background: var(--hover-overlay-subtle);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-title {
  font-size: 14px;
  font-weight: 600;
}

.header-status-text {
  font-size: 12px;
  color: var(--text-muted);
}

.header-status-text.status-testing {
  color: var(--primary);
}

.header-status-text.status-warning {
  color: var(--warning);
}

.header-status-text.status-success {
  color: var(--success);
}

.header-status-text.status-error {
  color: var(--error);
}

.header-status-text.status-disabled {
  color: var(--text-muted);
}

/* CSS Grid auto-height 动画 */
.collapsible-content-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.25s ease;
}

.expanded .collapsible-content-wrapper {
  grid-template-rows: 1fr;
}

.collapsible-content {
  overflow: hidden;
  padding: 0 16px;
}

.expanded .collapsible-content {
  padding-bottom: 16px;
}

/* 下划线风格 Tabs */
.tabs-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 16px;
}

.tabs-list {
  display: flex;
  gap: 4px;
}

.tab-btn {
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: -1px;
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.add-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  transition: all 0.15s;
}

.add-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

/* 简洁表单 */
.simple-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.row-label {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* 纯文字 Chips */
.preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip-btn {
  padding: 4px 10px;
  background: var(--bg-secondary);
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.chip-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field label {
  font-size: 13px;
  color: var(--text-secondary);
}

/* 用户名/密码并排 */
.form-row-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 500px) {
  .form-row-split {
    grid-template-columns: 1fr;
  }
}

/* 操作按钮 */
.form-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle);
}

.spacer {
  flex: 1;
}

/* 空状态 */
.empty-webdav {
  text-align: center;
  padding: 32px 16px;
  color: var(--text-muted);
}

.empty-webdav p {
  margin-bottom: 16px;
}

/* Password 组件样式 */
:deep(.p-password) {
  position: relative;
  display: flex;
  width: 100%;
}

:deep(.p-password-input) {
  width: 100%;
}
</style>
