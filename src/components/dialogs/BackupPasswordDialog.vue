<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="dialogTitle"
    :style="{ width: 'var(--dialog-width-md)' }"
    :closable="mode !== 'restore'"
    :draggable="false"
    :pt="{ root: { class: 'app-dialog' }, closeButton: { class: 'app-dialog-close-btn' } }"
    @hide="handleCancel"
  >
    <div class="backup-password-dialog">
      <div v-if="mode === 'restore'" class="dialog-description">
        <i class="pi pi-lock" />
        <p>你的配置文件已用备份密码加密。输入当时设置的密码，就能还原配置。</p>
      </div>

      <div v-if="mode === 'disable'" class="dialog-description dialog-description-danger">
        <i class="pi pi-lock-open" />
        <p>关闭后，后续导出的配置不再使用备份密码加密。已有备份仍需原密码打开。</p>
      </div>

      <div v-if="requiresCurrentPassword" class="field">
        <label for="backup-current-password">当前密码</label>
        <Password
          id="backup-current-password"
          v-model="currentPassword"
          :feedback="false"
          toggleMask
          :inputStyle="{ width: '100%' }"
          :inputProps="{ autocomplete: 'current-password' }"
          :class="{ 'p-invalid': currentPasswordError }"
          placeholder="输入当前备份密码"
          @keydown.enter="handleSubmit"
        />
        <small v-if="currentPasswordError" class="p-error">{{ currentPasswordError }}</small>
      </div>

      <div v-if="mode === 'set' || mode === 'restore'" class="field">
        <label for="backup-password">{{ mode === 'restore' ? '备份密码' : '密码' }}</label>
        <Password
          id="backup-password"
          v-model="password"
          :feedback="false"
          toggleMask
          :inputStyle="{ width: '100%' }"
          :inputProps="{ autocomplete: mode === 'restore' ? 'current-password' : 'new-password' }"
          :class="{ 'p-invalid': passwordError }"
          :placeholder="mode === 'restore' ? '输入你之前设置的备份密码' : '至少 8 位，包含数字'"
          @keydown.enter="handleSubmit"
        />
        <small v-if="passwordError" class="p-error">{{ passwordError }}</small>

        <div v-if="showStrengthHints" class="strength-hints">
          <span
            v-for="check in strengthChecks"
            :key="check.label"
            class="strength-check"
            :class="{ passed: check.passed }"
          >
            <i :class="check.passed ? 'pi pi-check-circle' : 'pi pi-circle'" />
            {{ check.label }}
          </span>
          <span
            v-for="suggestion in strengthSuggestions"
            :key="suggestion.label"
            class="strength-suggestion"
            :class="{ passed: suggestion.passed }"
          >
            <i :class="suggestion.passed ? 'pi pi-check-circle' : 'pi pi-circle'" />
            {{ suggestion.label }}
          </span>
        </div>
      </div>

      <div v-if="mode === 'change'" class="field">
        <label for="backup-new-password">新密码</label>
        <Password
          id="backup-new-password"
          v-model="newPassword"
          :feedback="false"
          toggleMask
          :inputStyle="{ width: '100%' }"
          :inputProps="{ autocomplete: 'new-password' }"
          :class="{ 'p-invalid': newPasswordError }"
          placeholder="至少 8 位，包含数字"
          @keydown.enter="handleSubmit"
        />
        <small v-if="newPasswordError" class="p-error">{{ newPasswordError }}</small>

        <div class="strength-hints">
          <span
            v-for="check in strengthChecks"
            :key="check.label"
            class="strength-check"
            :class="{ passed: check.passed }"
          >
            <i :class="check.passed ? 'pi pi-check-circle' : 'pi pi-circle'" />
            {{ check.label }}
          </span>
          <span
            v-for="suggestion in strengthSuggestions"
            :key="suggestion.label"
            class="strength-suggestion"
            :class="{ passed: suggestion.passed }"
          >
            <i :class="suggestion.passed ? 'pi pi-check-circle' : 'pi pi-circle'" />
            {{ suggestion.label }}
          </span>
        </div>
      </div>

      <div v-if="mode === 'set' || mode === 'change'" class="field">
        <label for="backup-password-confirm">确认密码</label>
        <Password
          id="backup-password-confirm"
          v-model="confirmPassword"
          :feedback="false"
          toggleMask
          :inputStyle="{ width: '100%' }"
          :inputProps="{ autocomplete: 'new-password' }"
          :class="{ 'p-invalid': confirmError }"
          placeholder="再次输入密码"
          @keydown.enter="handleSubmit"
        />
        <small v-if="confirmError" class="p-error">{{ confirmError }}</small>
      </div>

      <div v-if="mode === 'set' || mode === 'change'" class="dialog-note-warn">
        <i class="pi pi-info-circle" />
        <span>
          {{ mode === 'change'
            ? '修改后旧备份仍需旧密码打开。请妥善保管密码，忘记后将无法还原。'
            : '请妥善保管密码，忘记后将无法还原。'
          }}
        </span>
      </div>

      <div v-if="mode === 'restore' && failedAttempts > 0" class="error-box">
        <i class="pi pi-times-circle" />
        <span>密码不正确，剩余尝试次数：{{ MAX_ATTEMPTS - failedAttempts }}</span>
      </div>
    </div>

    <template #footer>
      <Button
        v-if="mode === 'restore'"
        label="跳过，使用默认配置"
        severity="secondary"
        text
        class="dialog-btn-secondary"
        @click="handleSkip"
      />
      <Button
        v-else
        label="取消"
        severity="secondary"
        outlined
        class="dialog-btn-reject"
        @click="handleCancel"
      />
      <Button
        :label="submitLabel"
        :severity="mode === 'disable' ? 'danger' : undefined"
        :loading="loading"
        class="dialog-btn-accept"
        @click="handleSubmit"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import Dialog from 'primevue/dialog';
import Password from 'primevue/password';
import Button from 'primevue/button';
import { validateBackupPassword } from '../../crypto';
import type { BackupPasswordConfirmPayload, BackupPasswordDialogMode } from './backupPasswordDialogTypes';

interface Props {
  modelValue: boolean;
  mode: BackupPasswordDialogMode;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'confirm': [payload: BackupPasswordConfirmPayload];
  'skip': [];
  'cancel': [];
}>();

const MAX_ATTEMPTS = 5;

const currentPassword = ref('');
const password = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const currentPasswordError = ref('');
const passwordError = ref('');
const newPasswordError = ref('');
const confirmError = ref('');
const loading = ref(false);
const failedAttempts = ref(0);

const requiresCurrentPassword = computed(() => props.mode === 'change' || props.mode === 'disable');
const showStrengthHints = computed(() => props.mode === 'set');
const passwordForStrength = computed(() => props.mode === 'change' ? newPassword.value : password.value);

const strengthChecks = computed(() => {
  const p = passwordForStrength.value;
  return [
    { label: '至少 8 位', passed: p.length >= 8 },
    { label: '包含数字', passed: /\d/.test(p) },
  ];
});

const strengthSuggestions = computed(() => {
  const p = passwordForStrength.value;
  return [
    { label: '大小写字母', passed: /[a-z]/.test(p) && /[A-Z]/.test(p) },
    { label: '特殊符号', passed: /[^a-zA-Z0-9]/.test(p) },
  ];
});

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const dialogTitle = computed(() => {
  switch (props.mode) {
    case 'restore': return '还原备份配置';
    case 'change': return '修改备份密码';
    case 'disable': return '关闭备份密码';
    default: return '设置备份密码';
  }
});

const submitLabel = computed(() => {
  switch (props.mode) {
    case 'restore': return '确认恢复';
    case 'change': return '确认修改';
    case 'disable': return '确认关闭';
    default: return '确认设置';
  }
});

function resetForm() {
  currentPassword.value = '';
  password.value = '';
  newPassword.value = '';
  confirmPassword.value = '';
  currentPasswordError.value = '';
  passwordError.value = '';
  newPasswordError.value = '';
  confirmError.value = '';
  loading.value = false;
}

function validateNewPassword(value: string): string {
  const result = validateBackupPassword(value);
  return result.valid ? '' : result.message;
}

function validate(): boolean {
  currentPasswordError.value = '';
  passwordError.value = '';
  newPasswordError.value = '';
  confirmError.value = '';

  if (props.mode === 'restore') {
    if (!password.value) {
      passwordError.value = '请输入密码';
      return false;
    }
    return true;
  }

  if (requiresCurrentPassword.value && !currentPassword.value) {
    currentPasswordError.value = '请输入当前密码';
    return false;
  }

  if (props.mode === 'disable') {
    return true;
  }

  const targetPassword = props.mode === 'change' ? newPassword.value : password.value;
  if (!targetPassword) {
    if (props.mode === 'change') newPasswordError.value = '请输入新密码';
    else passwordError.value = '请输入密码';
    return false;
  }

  const validationError = validateNewPassword(targetPassword);
  if (validationError) {
    if (props.mode === 'change') newPasswordError.value = validationError;
    else passwordError.value = validationError;
    return false;
  }

  if (targetPassword !== confirmPassword.value) {
    confirmError.value = '两次输入的密码不一致';
    return false;
  }

  return true;
}

function buildPayload(): BackupPasswordConfirmPayload {
  switch (props.mode) {
    case 'change':
      return {
        mode: 'change',
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
        confirmPassword: confirmPassword.value,
      };
    case 'disable':
      return {
        mode: 'disable',
        currentPassword: currentPassword.value,
      };
    case 'restore':
      return {
        mode: 'restore',
        password: password.value,
      };
    default:
      return {
        mode: 'set',
        password: password.value,
      };
  }
}

async function handleSubmit() {
  if (!validate()) return;

  loading.value = true;
  emit('confirm', buildPayload());
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

function onPasswordFailed() {
  loading.value = false;

  if (requiresCurrentPassword.value) {
    currentPasswordError.value = '密码不正确';
    currentPassword.value = '';
    return;
  }

  failedAttempts.value++;
  passwordError.value = '密码不正确';
  password.value = '';

  if (failedAttempts.value >= MAX_ATTEMPTS) {
    handleSkip();
  }
}

function resetLoading() {
  loading.value = false;
}

function onPasswordSuccess() {
  loading.value = false;
  resetForm();
  failedAttempts.value = 0;
  visible.value = false;
}

defineExpose({
  onPasswordFailed,
  onPasswordSuccess,
  resetLoading
});
</script>

<style scoped>
.backup-password-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.dialog-description {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm-md);
  padding: var(--space-md) var(--space-md-lg);
  border-radius: var(--radius-md);
  background: var(--primary-alpha-15);
  color: var(--primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  line-height: 1.5;
}

.dialog-description-danger {
  background: var(--error-alpha-8);
  color: var(--error);
}

.dialog-description i {
  font-size: var(--text-xl);
  flex-shrink: 0;
  color: currentcolor;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1px 微调对齐，无对应 spacing token */
  margin-top: 1px;
}

.dialog-description p {
  margin: 0;
  color: var(--text-secondary);
}

.dialog-note-warn {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.6;
}

.dialog-note-warn i {
  font-size: var(--text-xs);
  flex-shrink: 0;
  margin-top: var(--space-2xs);
  opacity: 0.7;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs-sm);
}

.field label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
}

.field :deep(.p-password) {
  width: 100%;
}

.field :deep(.p-password input) {
  width: 100%;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  border: none;
  padding: var(--space-md) var(--space-lg);
  color: var(--text-primary);
}

.field :deep(.p-password input:focus) {
  box-shadow: none;
}

.strength-hints {
  display: flex;
  gap: var(--space-sm-md);
  flex-wrap: wrap;
  margin-top: var(--space-2xs);
}

.strength-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-xs);
  color: var(--text-muted);
  transition: color var(--duration-fast);
}

.strength-check i {
  font-size: var(--text-xs);
}

.strength-check.passed {
  color: var(--success);
}

.strength-suggestion {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-xs);
  color: var(--text-muted);
  opacity: 0.6;
  transition: color var(--duration-fast), opacity var(--duration-fast);
}

.strength-suggestion i {
  font-size: var(--text-xs);
}

.strength-suggestion.passed {
  color: var(--success);
  opacity: 1;
}

.error-box {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm-md) var(--space-md-lg);
  border-radius: var(--radius-md);
  background: var(--error-alpha-8);
  border: 1px solid var(--error-alpha-15);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--error);
}

.error-box i {
  font-size: var(--text-base);
  flex-shrink: 0;
}

:deep(.dialog-btn-reject) {
  flex: 1;
  border-radius: var(--radius-md) !important;
  padding: var(--space-md) var(--space-lg-xl) !important;
  font-size: var(--text-base) !important;
  font-weight: var(--weight-semibold) !important;
  background: var(--bg-button-secondary) !important;
  border: none !important;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 按钮文字白色为固定设计值 */
  color: white !important;
}

:deep(.dialog-btn-reject:hover) {
  background: var(--bg-button-secondary-hover) !important;
}

:deep(.dialog-btn-accept) {
  flex: 1;
  border-radius: var(--radius-md) !important;
  padding: var(--space-md) var(--space-lg-xl) !important;
  font-size: var(--text-base) !important;
  font-weight: var(--weight-semibold) !important;
}

:deep(.dialog-btn-secondary) {
  border-radius: var(--radius-md) !important;
  font-weight: var(--weight-semibold) !important;
}
</style>
