<script setup lang="ts">
// 图床表单（HostsScreen.dc.html 的 ghFields / r2Fields / nasFields）：两列网格，窄窗口单列；
// 普通字段失焦且有改动即提交，敏感字段走 HostSecretField；测试失败的那一格红框 + 红字原因；
// 明文 HTTP 地址标「HTTP · 已允许」（只对这个地址生效）；输入框里的链接（「在 GitHub 生成」）用系统浏览器打开。
import { reactive, ref, watch } from 'vue';
import PnInput from '@/components/pn/PnInput.vue';
import { openTrustedExternalUrl } from '@/security/shellOpen';
import type { HostField } from './hostCatalog';
import HostSecretField from './HostSecretField.vue';

const props = defineProps<{
  fields: readonly HostField[];
  values: Record<string, string>;
  /** 标红的那一格与原因 */
  invalidField?: string;
  invalidReason?: string;
  /** 哪些格要标「HTTP · 已允许」 */
  httpAllowed?: ReadonlySet<string>;
  /** 敏感字段按需取明文 */
  reveal: (key: string) => Promise<string>;
  narrow?: boolean;
  /** 字段 id 前缀（同一页可能同时有两份表单） */
  idPrefix: string;
}>();

const emit = defineEmits<{ commit: [key: string, value: string] }>();

const local = reactive<Record<string, string>>({});
watch(() => props.values, (values) => {
  for (const field of props.fields) local[field.key] = values[field.key] ?? '';
}, { immediate: true, deep: true });

function commit(key: string): void {
  const value = (local[key] ?? '').trim();
  if (value !== (props.values[key] ?? '')) emit('commit', key, value);
}

const secretRefs = ref<Record<string, InstanceType<typeof HostSecretField> | null>>({});

/** Cookie「手动粘贴」：把那一格切成编辑态 */
function editSecret(key: string): void {
  secretRefs.value[key]?.beginEdit();
}

defineExpose({ editSecret });
</script>

<template>
  <div class="host-fields" :class="{ 'host-fields--narrow': narrow }">
    <div v-for="field in fields" :key="field.key" class="host-fields__cell" :class="{ 'host-fields__cell--wide': field.wide }">
      <HostSecretField
        v-if="field.secret"
        :id="`${idPrefix}-${field.key}`"
        :ref="(el) => { secretRefs[field.key] = el as InstanceType<typeof HostSecretField> | null; }"
        :label="field.label"
        :required="field.required"
        :link="field.link"
        :has-value="!!values[field.key]"
        :reveal="() => reveal(field.key)"
        :invalid="invalidField === field.key"
        :help="invalidField === field.key ? invalidReason : field.help"
        :placeholder="field.placeholder"
        @commit="(value) => emit('commit', field.key, value)"
      />
      <template v-else>
        <label class="host-fields__label" :for="`${idPrefix}-${field.key}`">
          {{ field.label }}<span v-if="field.required" class="host-fields__required"> *</span>
        </label>
        <PnInput
          :id="`${idPrefix}-${field.key}`"
          v-model="local[field.key]"
          mono
          :placeholder="field.placeholder"
          :invalid="invalidField === field.key"
          @blur="commit(field.key)"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        >
          <template #suffix>
            <span v-if="httpAllowed?.has(field.key)" class="host-fields__http" title="明文 HTTP，仅对此地址生效">HTTP · 已允许</span>
            <a v-if="field.link" class="host-fields__link" href="#" @click.prevent="openTrustedExternalUrl(field.link.url)">{{ field.link.label }}</a>
          </template>
        </PnInput>
        <span v-if="invalidField === field.key && invalidReason" class="host-fields__help host-fields__help--error">{{ invalidReason }}</span>
        <span v-else-if="field.help" class="host-fields__help">{{ field.help }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.host-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--pn-space-host-fields);
}

.host-fields--narrow { grid-template-columns: minmax(0, 1fr); }

.host-fields__cell {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-6);
  min-width: 0;
}

.host-fields__cell--wide { grid-column: 1 / -1; }

.host-fields__label {
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
}

.host-fields__required { color: var(--pn-danger); }

.host-fields__help {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.host-fields__help--error { color: var(--pn-danger); }

.host-fields__http {
  display: flex;
  flex: none;
  align-items: center;
  height: var(--pn-size-host-badge);
  padding: 0 var(--pn-space-host-badge-x);
  border-radius: var(--pn-radius-host-badge);
  background: var(--pn-warning-soft);
  color: var(--pn-warning);
  font-family: var(--pn-font-ui);
  font-size: var(--pn-text-caption);
  font-weight: var(--pn-weight-medium);
  white-space: nowrap;
}

.host-fields__link {
  flex: none;
  color: var(--pn-brand-text);
  font-family: var(--pn-font-ui);
  font-size: var(--pn-text-footnote);
  text-decoration: none;
  white-space: nowrap;
}
</style>
