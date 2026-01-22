<script setup lang="ts">
// WebDAV 配置区域组件

import { computed, ref } from 'vue';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Button from 'primevue/button';
import type { WebDAVConfig, WebDAVProfile } from '../../../config/types';

// ==================== Props ====================

interface Props {
  modelValue: WebDAVConfig;
  testing?: boolean;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  'update:modelValue': [config: WebDAVConfig];
  'save': [];
  'test': [];
}>();

// ==================== Computed ====================

const activeProfile = computed(() => {
  return props.modelValue.profiles.find(p => p.id === props.modelValue.activeId) || null;
});

// ==================== Methods ====================

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
  // Switching profile might not need immediate save, but let's follow parent logic if needed.
  // Parent handled switch via emit 'switchWebDAVProfile' which likely updated config and saved.
  // Here we update v-model. Parent should watch or we emit save.
  // Usually switching active ID should save.
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
}

function handleSave() {
  emit('save');
}

function handleTest() {
  emit('test');
}
</script>

<template>
  <div class="sub-section">
    <h3>WebDAV 配置</h3>

    <!-- 配置切换卡片 -->
    <div class="webdav-profile-tabs">
      <button
        v-for="profile in modelValue.profiles"
        :key="profile.id"
        class="profile-tab"
        :class="{ active: modelValue.activeId === profile.id }"
        @click="handleSwitchProfile(profile.id)"
      >
        <span class="profile-indicator"></span>
        <span>{{ profile.name }}</span>
      </button>
      <button class="profile-tab add-btn" @click="handleAddProfile">
        <i class="pi pi-plus"></i>
      </button>
    </div>

    <!-- 当前配置表单 -->
    <div v-if="activeProfile" class="webdav-form">
      <div class="form-grid">
        <div class="form-item">
          <label>配置名称</label>
          <InputText
            :modelValue="activeProfile.name"
            @update:modelValue="(v) => updateActiveProfileField('name', v as string)"
            @blur="handleSave"
            placeholder="如：坚果云、群晖 NAS"
          />
        </div>
        <div class="form-item">
          <label>服务器 URL</label>
          <InputText
            :modelValue="activeProfile.url"
            @update:modelValue="(v) => updateActiveProfileField('url', v as string)"
            @blur="handleSave"
            placeholder="https://dav.example.com"
          />
        </div>
        <div class="form-item">
          <label>用户名</label>
          <InputText
            :modelValue="activeProfile.username"
            @update:modelValue="(v) => updateActiveProfileField('username', v as string)"
            @blur="handleSave"
          />
        </div>
        <div class="form-item">
          <label>密码</label>
          <Password
            :modelValue="activeProfile.password"
            @update:modelValue="(v) => updateActiveProfileField('password', v as string)"
            @blur="handleSave"
            :feedback="false"
            toggleMask
          />
        </div>
        <div class="form-item span-full">
          <label>远程路径</label>
          <InputText
            :modelValue="activeProfile.remotePath"
            @update:modelValue="(v) => updateActiveProfileField('remotePath', v as string)"
            @blur="handleSave"
            placeholder="/PicNexus/"
          />
        </div>
      </div>
      <div class="webdav-actions-row">
        <Button
          label="测试连接"
          icon="pi pi-check"
          @click="handleTest"
          :loading="testing"
          outlined
          size="small"
        />
        <Button
          label="删除此配置"
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
</template>

<style scoped>
@import '../../../styles/settings-shared.css';

/* WebDAV 配置特有样式 */
.webdav-profile-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.profile-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 13px;
}

.profile-tab:hover {
  border-color: var(--primary);
  color: var(--text-primary);
}

.profile-tab.active {
  border-color: var(--primary);
  background: rgba(59, 130, 246, 0.1);
  color: var(--primary);
}

.profile-tab .profile-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}

.profile-tab.active .profile-indicator {
  background: var(--primary);
}

.profile-tab.add-btn {
  border-style: dashed;
  padding: 8px 12px;
}

.profile-tab.add-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.webdav-form {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 20px;
}

.webdav-actions-row {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}

.empty-webdav {
  text-align: center;
  padding: 32px;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border-radius: 8px;
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
