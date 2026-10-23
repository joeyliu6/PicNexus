<script setup lang="ts">
// 备份密码弹窗里的一个密码框（Dialogs.dc.html）：标签 12/500、框高 34、右侧「显示密码」眼睛；下面一行说明（红 = 出错，绿 = 两次一致）
import { ref } from 'vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnInput from '@/components/pn/PnInput.vue';

const model = defineModel<string>({ default: '' });

withDefaults(defineProps<{
  id: string;
  label: string;
  autocomplete?: 'current-password' | 'new-password';
  message?: string;
  tone?: 'muted' | 'danger' | 'success';
  disabled?: boolean;
}>(), { autocomplete: 'current-password', message: '', tone: 'muted', disabled: false });

defineEmits<{ enter: [] }>();

const shown = ref(false);
</script>

<template>
  <div class="password-field">
    <label class="password-field__label" :for="id">{{ label }}</label>
    <PnInput
      :id="id"
      v-model="model"
      size="dialog"
      mono
      :type="shown ? 'text' : 'password'"
      :autocomplete="autocomplete"
      :invalid="tone === 'danger'"
      :disabled="disabled"
      @keydown.enter="$emit('enter')"
    >
      <template #suffix>
        <button type="button" class="password-field__eye" :aria-label="shown ? '隐藏密码' : '显示密码'" :aria-pressed="shown" :disabled="disabled" @click="shown = !shown">
          <PnIcon :name="shown ? 'eyeOff' : 'eye'" :size="15" :stroke="1.7" />
        </button>
      </template>
    </PnInput>
    <span v-if="message" class="password-field__msg" :class="`password-field__msg--${tone}`" :role="tone === 'danger' ? 'alert' : undefined">{{ message }}</span>
  </div>
</template>

<style scoped>
.password-field {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-6);
}

.password-field__label {
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
}

.password-field__eye {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-button-sm);
  height: var(--pn-size-button-sm);
  margin-right: calc(-1 * var(--pn-space-6));
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: transparent;
  color: var(--pn-text3);
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.password-field__eye:not(:disabled):hover { background: var(--pn-ghost-hover); }
.password-field__eye:not(:disabled):active { background: var(--pn-ghost-press); }
.password-field__eye:disabled { cursor: default; }

.password-field__msg { font-size: var(--pn-text-footnote); }
.password-field__msg--muted { color: var(--pn-text3); }
.password-field__msg--danger { color: var(--pn-danger); }
.password-field__msg--success { color: var(--pn-success); }
</style>
