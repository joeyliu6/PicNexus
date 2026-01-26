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

const activeProfileName = computed(() => {
  return activeProfile.value?.name || '';
});

const shouldAutoExpand = computed(() => {
  // 无配置
  if (props.modelValue.profiles.length === 0) return true;
  // 未选择活动配置
  if (!props.modelValue.activeId) return true;
  // 活动配置不完整
  if (activeProfile.value && (!activeProfile.value.url || !activeProfile.value.username)) return true;
  return false;
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
  emit('test');
}
</script>

<template>
  <div class="webdav-collapsible" :class="{ expanded, 'needs-attention': shouldAutoExpand }">
    <!-- 折叠头部 -->
    <button class="collapsible-header" @click="toggleExpand">
      <div class="header-left">
        <span class="header-title">WebDAV 配置</span>
        <span v-if="hasValidConfig" class="config-badge success">
          <i class="pi pi-check-circle"></i>
          {{ activeProfileName }}
        </span>
        <span v-else class="config-badge warning">
          <i class="pi pi-exclamation-circle"></i>
          未配置
        </span>
      </div>
      <i :class="expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
    </button>

    <!-- 展开内容 -->
    <Transition name="collapse">
      <div v-if="expanded" class="collapsible-content">
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
    </Transition>
  </div>
</template>

<style scoped>
@import '../../../styles/settings-shared.css';

/* 可折叠容器 */
.webdav-collapsible {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  margin-top: 24px;
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.webdav-collapsible:hover {
  border-color: var(--primary);
}

.webdav-collapsible.expanded {
  border-color: var(--primary);
}

.webdav-collapsible.needs-attention {
  border-color: var(--warning);
}

.webdav-collapsible.needs-attention:hover {
  border-color: var(--warning);
}

/* 折叠头部 */
.collapsible-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
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
  gap: 12px;
}

.header-left > i {
  font-size: 18px;
  color: var(--text-secondary);
}

.header-title {
  font-size: 15px;
  font-weight: 600;
}

/* 配置状态徽章 */
.config-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.config-badge.success {
  background: rgba(16, 185, 129, 0.1);
  color: var(--success);
}

.config-badge.warning {
  background: rgba(245, 158, 11, 0.1);
  color: var(--warning);
}

.config-badge i {
  font-size: 12px;
}

/* 展开内容 */
.collapsible-content {
  padding: 0 20px 20px;
}

/* WebDAV 配置标签页 */
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

/* 表单 */
.webdav-form {
  background: var(--bg-card);
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
  background: var(--bg-card);
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

/* 折叠动画 */
.collapse-enter-active,
.collapse-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}

.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.collapse-enter-to,
.collapse-leave-from {
  max-height: 600px;
}
</style>
