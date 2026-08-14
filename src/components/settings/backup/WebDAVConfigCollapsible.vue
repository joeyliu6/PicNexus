<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import type { WebDAVConfig } from '../../../config/types';
import { useConfirm } from '../../../composables/useConfirm';
import { useWebDAVProfileEditor } from '../../../composables/settings/useWebDAVProfileEditor';
import { useSensitiveDraft } from '../../../composables/settings/useSensitiveDraft';
import { WebDAVClient } from '../../../utils/webdav';
import { createLogger } from '../../../utils/logger';
import SensitiveField from '../../common/SensitiveField.vue';

const log = createLogger('WebDAVBackupConfig');

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

const {
  activeProfile,
  hasValidConfig,
  shouldAutoExpand,
  statusLabel,
  statusClass,
  securityHint,
  updateActiveProfileField,
  setActivePassword,
  switchProfile: handleSwitchProfile,
  addProfile: handleAddProfile,
  deleteProfile: handleDeleteProfile,
} = useWebDAVProfileEditor({
  config: () => props.modelValue,
  testing: () => !!props.testing,
  onUpdate: config => emit('update:modelValue', config),
  onSave: () => emit('save'),
  confirmDelete,
});

/**
 * 备份密码：密文常驻、明文按需
 *
 * 以前是加载时解密到 `p.password` 常驻内存、输入框里回填明文。现在明文只在用户
 * 正在输入的那一瞬存在，失焦即加密写 `passwordEncrypted`，草稿随即清空。
 *
 * 老配置里遗留的明文（还没被重新保存过的）仍然认作"已保存"，揭示时直接返回，
 * 用户下次改密码时由 setActivePassword 一并清掉。
 */
const PASSWORD_KEY = 'backup-webdav-password';

const passwordSecret = useSensitiveDraft({
  hasStored: () => !!(activeProfile.value?.passwordEncrypted || activeProfile.value?.password),

  reveal: async () => {
    const profile = activeProfile.value;
    if (!profile) return '';
    if (!profile.passwordEncrypted) return profile.password || '';

    const plaintext = await WebDAVClient.decryptPassword(profile.passwordEncrypted);
    // decryptPassword 把错误吞掉返回空串——这里补一个显式失败，
    // 否则"解不开"和"存的就是空密码"在界面上长得一模一样
    if (!plaintext) throw new Error('WebDAV 备份密码解密失败');
    return plaintext;
  },

  commit: async (_key, draft) => {
    setActivePassword(await WebDAVClient.encryptPassword(draft));
    emit('save');
  },

  onRevealError: error => log.error('WebDAV 备份密码解密失败，无法查看', error),
  onCommitError: error => log.error('WebDAV 备份密码加密失败', error),
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

function handleSave() {
  emit('save');
}

function handleTest() {
  emit('save');
  emit('test');
}

</script>

<template>
  <div class="webdav-collapsible" :class="{ expanded, 'needs-attention': shouldAutoExpand }">
    <!-- 折叠头部 -->
    <button class="card-header" @click="toggleExpand">
      <div class="header-left">
        <span class="card-title">WebDAV 同步</span>
        <span class="header-status-text" :class="statusClass">{{ statusLabel }}</span>
      </div>
      <i :class="expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
    </button>

    <!-- 展开内容（CSS Grid auto-height 动画） -->
    <div class="card-content-wrapper">
      <div class="card-content">
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
          <button class="add-btn" @click="handleAddProfile" v-tooltip.top="'新建配置'">+</button>
        </div>

        <!-- 当前配置表单 -->
        <form v-if="activeProfile" class="simple-form" @submit.prevent>
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
            <small class="field-hint">{{ securityHint }}</small>
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
              <label>
                密码
                <span v-if="passwordSecret.hasStored(PASSWORD_KEY)" class="saved-chip">
                  <i class="pi pi-check" aria-hidden="true"></i>{{ passwordSecret.chipLabel(PASSWORD_KEY) }}
                </span>
              </label>
              <SensitiveField
                v-bind="passwordSecret.bindingsFor(PASSWORD_KEY, '输入 WebDAV 密码')"
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
        </form>

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
@import url('../../../styles/settings-shared.css');

/* 可折叠容器 */
.webdav-collapsible {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.webdav-collapsible.expanded {
  border-color: var(--border-subtle);
}

.webdav-collapsible.needs-attention {
  border-color: var(--warning);
}

.header-status-text {
  font-size: var(--text-xs);
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

.expanded .card-content-wrapper {
  grid-template-rows: 1fr;
}

.card-content {
  padding: 0 var(--space-lg);
}

.expanded .card-content {
  padding-bottom: var(--space-lg);
}

/* 下划线风格 Tabs */
.tabs-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-xs-sm) 0;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: var(--space-lg);
}

.tabs-list {
  display: flex;
  gap: var(--space-xs);
}

.tab-btn {
  padding: var(--space-xs-sm) var(--space-md);
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 20px;
  cursor: pointer;
  transition: all var(--duration-fast);
  border-radius: var(--radius-sm-md);
}

.tab-btn:hover {
  color: var(--text-primary);
  background: var(--hover-overlay-subtle);
}

.tab-btn.active {
  color: var(--primary);
  font-weight: var(--weight-semibold);
}

.add-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: var(--text-lg);
  cursor: pointer;
  transition: all var(--duration-fast);
}

.add-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

/* 简洁表单 */
.simple-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md-lg);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs-sm);
}

.form-field label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

/* 用户名/密码并排 */
.form-row-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}

@media (width <= 500px) {
  .form-row-split {
    grid-template-columns: 1fr;
  }
}

/* 操作按钮 */
.form-actions {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-top: var(--space-sm);
  padding-top: var(--space-md-lg);
  border-top: 1px solid var(--border-subtle);
}

.spacer {
  flex: 1;
}

/* 空状态 */
.empty-webdav {
  text-align: center;
  padding: var(--space-2xl) var(--space-lg);
  color: var(--text-muted);
}

.empty-webdav p {
  margin-bottom: var(--space-lg);
}

</style>
