<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="dialogTitle"
    :style="{ width: '420px' }"
    :closable="mode !== 'restore'"
    :draggable="false"
    @hide="handleCancel"
  >
    <div class="backup-password-dialog">
      <!-- 恢复模式：检测到加密配置 -->
      <div v-if="mode === 'restore'" class="dialog-description">
        <i class="pi pi-lock" />
        <p>当前配置文件使用备份密码加密。请输入你之前设置的备份密码来恢复配置。</p>
      </div>

      <!-- 设置模式 -->
      <div v-else-if="mode === 'set'" class="dialog-description">
        <i class="pi pi-shield" />
        <p>此密码用于加密你的配置文件，换电脑时输入此密码即可完整恢复所有设置。</p>
      </div>

      <!-- 修改模式 -->
      <div v-else-if="mode === 'change'" class="dialog-description">
        <i class="pi pi-pencil" />
        <p>修改备份密码后，配置文件将使用新密码重新加密。</p>
      </div>

      <!-- 密码输入 -->
      <div class="field">
        <label for="backup-password">{{ mode === 'restore' ? '备份密码' : '密码' }}</label>
        <Password
          id="backup-password"
          v-model="password"
          :feedback="false"
          toggleMask
          :inputStyle="{ width: '100%' }"
          :class="{ 'p-invalid': passwordError }"
          :placeholder="mode === 'restore' ? '输入你之前设置的备份密码' : '至少 8 位，包含字母和数字'"
          @keydown.enter="handleSubmit"
        />
        <small v-if="passwordError" class="p-error">{{ passwordError }}</small>
      </div>

      <!-- 确认密码（仅设置/修改模式） -->
      <div v-if="mode === 'set' || mode === 'change'" class="field">
        <label for="backup-password-confirm">确认密码</label>
        <Password
          id="backup-password-confirm"
          v-model="confirmPassword"
          :feedback="false"
          toggleMask
          :inputStyle="{ width: '100%' }"
          :class="{ 'p-invalid': confirmError }"
          placeholder="再次输入密码"
          @keydown.enter="handleSubmit"
        />
        <small v-if="confirmError" class="p-error">{{ confirmError }}</small>
      </div>

      <!-- 警告提示 -->
      <div v-if="mode !== 'restore'" class="warning-box">
        <i class="pi pi-exclamation-triangle" />
        <span>请务必牢记此密码！密码丢失将无法恢复加密的配置数据。</span>
      </div>

      <!-- 错误次数提示（恢复模式） -->
      <div v-if="mode === 'restore' && failedAttempts > 0" class="error-box">
        <i class="pi pi-times-circle" />
        <span>密码不正确，剩余尝试次数：{{ MAX_ATTEMPTS - failedAttempts }}</span>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button
          v-if="mode === 'restore'"
          label="跳过，使用默认配置"
          severity="secondary"
          text
          @click="handleSkip"
        />
        <Button
          v-else
          label="取消"
          severity="secondary"
          text
          @click="handleCancel"
        />
        <Button
          :label="submitLabel"
          :loading="loading"
          @click="handleSubmit"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import Dialog from 'primevue/dialog';
import Password from 'primevue/password';
import Button from 'primevue/button';
import { validateBackupPassword } from '../../crypto';

type DialogMode = 'set' | 'change' | 'restore';

interface Props {
  modelValue: boolean;
  mode: DialogMode;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'confirm': [password: string];
  'skip': [];
  'cancel': [];
}>();

const MAX_ATTEMPTS = 5;

const password = ref('');
const confirmPassword = ref('');
const passwordError = ref('');
const confirmError = ref('');
const loading = ref(false);
const failedAttempts = ref(0);

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const dialogTitle = computed(() => {
  switch (props.mode) {
    case 'restore': return '检测到加密配置';
    case 'change': return '修改备份密码';
    default: return '设置备份密码';
  }
});

const submitLabel = computed(() => {
  switch (props.mode) {
    case 'restore': return '确认恢复';
    case 'change': return '确认修改';
    default: return '确认设置';
  }
});

function resetForm() {
  password.value = '';
  confirmPassword.value = '';
  passwordError.value = '';
  confirmError.value = '';
}

function validate(): boolean {
  passwordError.value = '';
  confirmError.value = '';

  if (!password.value) {
    passwordError.value = '请输入密码';
    return false;
  }

  if (props.mode !== 'restore') {
    // 设置/修改模式需要强度验证
    const result = validateBackupPassword(password.value);
    if (!result.valid) {
      passwordError.value = result.message;
      return false;
    }

    if (password.value !== confirmPassword.value) {
      confirmError.value = '两次输入的密码不一致';
      return false;
    }
  }

  return true;
}

async function handleSubmit() {
  if (!validate()) return;

  loading.value = true;
  emit('confirm', password.value);
}

function handleSkip() {
  resetForm();
  emit('skip');
  visible.value = false;
}

function handleCancel() {
  resetForm();
  emit('cancel');
  visible.value = false;
}

/** 外部调用：密码验证失败时增加计数 */
function onPasswordFailed() {
  loading.value = false;
  failedAttempts.value++;
  passwordError.value = '密码不正确';
  password.value = '';

  if (failedAttempts.value >= MAX_ATTEMPTS) {
    handleSkip();
  }
}

/** 外部调用：密码验证成功后关闭 */
function onPasswordSuccess() {
  loading.value = false;
  resetForm();
  failedAttempts.value = 0;
  visible.value = false;
}

defineExpose({
  onPasswordFailed,
  onPasswordSuccess
});
</script>

<style scoped>
.backup-password-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dialog-description {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
  background: var(--surface-100);
  color: var(--text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.dialog-description i {
  color: var(--primary-color);
  font-size: 16px;
  margin-top: 2px;
  flex-shrink: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
}

.field :deep(.p-password) {
  width: 100%;
}

.field :deep(.p-password input) {
  width: 100%;
}

.warning-box {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--yellow-50);
  border: 1px solid var(--yellow-200);
  font-size: 12px;
  color: var(--yellow-900);
  line-height: 1.4;
}

.warning-box i {
  color: var(--yellow-600);
  font-size: 14px;
  margin-top: 1px;
  flex-shrink: 0;
}

.error-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--red-50);
  border: 1px solid var(--red-200);
  font-size: 12px;
  color: var(--red-700);
}

.error-box i {
  color: var(--red-500);
  font-size: 14px;
  flex-shrink: 0;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* 暗色模式适配 */
:root.dark-theme .dialog-description {
  background: var(--surface-800);
}

:root.dark-theme .warning-box {
  background: var(--warning-soft);
  border-color: var(--warning-border);
  color: var(--yellow-300);
}

:root.dark-theme .warning-box i {
  color: var(--yellow-400);
}

:root.dark-theme .error-box {
  background: var(--error-soft);
  border-color: var(--error-border);
  color: var(--red-300);
}

:root.dark-theme .error-box i {
  color: var(--red-400);
}
</style>
