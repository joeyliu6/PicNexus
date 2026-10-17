<script setup lang="ts">
// 更换 Obsidian 端口（设计没画）：端口一改本机服务就要重启，所以不随打字保存，点「更换」才生效。
import { ref, watch } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnDialog from '@/components/pn/PnDialog.vue';
import PnInput from '@/components/pn/PnInput.vue';
import { isValidPort } from './useEditorCards';

const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ port: number }>();
const emit = defineEmits<{ change: [port: number] }>();

const draft = ref('');
const error = ref('');

watch(open, (value) => {
  if (!value) return;
  draft.value = String(props.port);
  error.value = '';
});

function submit(): void {
  const port = Number(draft.value.trim());
  if (!isValidPort(port)) {
    error.value = '端口须在 1024–65535 之间';
    return;
  }
  open.value = false;
  if (port !== props.port) emit('change', port);
}
</script>

<template>
  <PnDialog v-model:open="open" title="更换端口" eyebrow="设置 › 编辑器与命令行" icon="terminal">
    <div class="port">
      <label class="port__label" for="settings-obsidian-port">端口</label>
      <PnInput id="settings-obsidian-port" v-model="draft" size="dialog" mono :invalid="!!error" @keydown.enter="submit" />
      <span class="port__help" :class="{ 'port__help--error': error }">{{ error || 'Obsidian 插件设置里的端口要与这里相同' }}</span>
    </div>
    <template #footer>
      <PnButton variant="secondary" size="dialog" @click="open = false">取消</PnButton>
      <PnButton variant="primary" size="dialog" @click="submit">更换</PnButton>
    </template>
  </PnDialog>
</template>

<style scoped>
.port {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-6);
}

.port__label {
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
}

.port__help {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.port__help--error { color: var(--pn-danger); }
</style>
