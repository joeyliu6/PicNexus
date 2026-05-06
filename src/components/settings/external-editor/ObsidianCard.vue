<script setup lang="ts">
import { ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { EditorServerConfig, ServerServiceType } from '../../../config/types';
import EditorServiceCard from './EditorServiceCard.vue';

interface Props {
  configuredServices: Array<{ value: ServerServiceType; label: string }>;
  healthStatusMap: Record<string, string>;
  healthTooltipMap: Record<string, string>;
  cliUnsupportedServices: Set<ServerServiceType>;
  serviceLabelMap: Record<ServerServiceType, string>;
}

defineProps<Props>();

const editorServer = defineModel<EditorServerConfig>('editorServer', { required: true });

const emit = defineEmits<{
  navigateHosting: [];
}>();

const portDraft = ref(String(editorServer.value.port));
const portError = ref('');

const connectionTest = ref<{
  status: 'idle' | 'testing' | 'success' | 'warning' | 'error';
  message?: string;
}>({ status: 'idle' });

function updateEditorServer(patch: Partial<EditorServerConfig>) {
  editorServer.value = { ...editorServer.value, ...patch };
}

async function testObsidianConnection() {
  const port = editorServer.value.port;

  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    connectionTest.value = { status: 'error', message: '端口无效，必须在 1024-65535 之间' };
    return;
  }

  if (!editorServer.value.enabled) {
    connectionTest.value = { status: 'error', message: '服务未启用，请先开启开关' };
    return;
  }

  connectionTest.value = { status: 'testing' };

  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.app !== 'PicNexus') {
      connectionTest.value = { status: 'error', message: '该端口运行的不是 PicNexus 服务，请更换端口' };
      return;
    }
    if (data.ready) {
      connectionTest.value = { status: 'success', message: `连接正常，服务: ${data.serviceName || data.service}` };
    } else {
      connectionTest.value = { status: 'warning', message: '连接正常，未选择图床' };
    }
  } catch {
    try {
      const isFree = await invoke<boolean>('check_port_free', { port });
      connectionTest.value = {
        status: 'error',
        message: isFree
          ? '服务未启动，请检查配置'
          : `端口 ${port} 已被占用，请更换端口`,
      };
    } catch {
      connectionTest.value = {
        status: 'error',
        message: '无法连接，请检查服务是否正常',
      };
    }
  }
}

function validatePortInput(value: string): string | null {
  if (!value.trim()) return '端口不能为空';
  const val = Number(value);
  if (!Number.isInteger(val) || val < 1024 || val > 65535) {
    return '端口必须在 1024-65535 之间';
  }
  return null;
}

function handlePortInput(e: Event) {
  // Why: 旧实现一边输入就 emit，外层 SettingsView 直接 await applyEditorServer 会让本地 HTTP server
  //   每个中间合法值都重启一次（4773→47731 期间至少 bounce 两次，期间 Obsidian 插件断连）。
  //   现在 input 阶段只更新 draft + 校验提示，真正提交端口走 commitPortInput（blur / Enter）。
  portDraft.value = (e.target as HTMLInputElement).value;
  portError.value = validatePortInput(portDraft.value) ?? '';
}

function commitPortInput() {
  const error = validatePortInput(portDraft.value);
  portError.value = error ?? '';
  if (!error) {
    const port = Number(portDraft.value);
    if (port !== editorServer.value.port) {
      updateEditorServer({ port });
    }
  }
}

watch(
  () => editorServer.value.port,
  (port) => {
    portDraft.value = String(port);
    if (!validatePortInput(portDraft.value)) {
      portError.value = '';
    }
  },
);
</script>

<template>
  <EditorServiceCard
    title="Obsidian"
    description="在 Obsidian 中粘贴图片时自动上传"
    serviceDesc="Obsidian 上传时使用的图床"
    :configuredServices="configuredServices"
    :healthStatusMap="healthStatusMap"
    :healthTooltipMap="healthTooltipMap"
    :cliUnsupportedServices="cliUnsupportedServices"
    :serviceLabelMap="serviceLabelMap"
    :enabled="editorServer.enabled"
    :service="editorServer.obsidianService"
    @update:enabled="(v: boolean) => updateEditorServer({ enabled: v })"
    @update:service="(v: ServerServiceType | null) => updateEditorServer({ obsidianService: v })"
    @navigateHosting="emit('navigateHosting')"
  >
    <div class="guide-card">
      <div class="guide-step">
        <span class="step-badge">1</span>
        <span class="step-text">在 Obsidian 插件市场安装 <code class="inline-code">obsidian-picnexus</code> 插件</span>
      </div>
      <div class="guide-step">
        <span class="step-badge">2</span>
        <span class="step-text">
          在插件设置中填写端口
          <input
            type="number"
            class="port-input inline-port"
            :class="{ invalid: !!portError }"
            :value="portDraft"
            min="1024"
            max="65535"
            @input="handlePortInput"
            @blur="commitPortInput"
            @keyup.enter="commitPortInput"
            @click.stop
          />
          ，保存后即可生效
        </span>
      </div>
    </div>

    <template #footer>
      <div class="test-connection-row">
        <button
          class="test-connection-btn"
          :disabled="connectionTest.status === 'testing'"
          @click="testObsidianConnection"
        >
          <i v-if="connectionTest.status === 'testing'" class="pi pi-spin pi-spinner" />
          <i v-else class="pi pi-bolt" />
          {{ connectionTest.status === 'testing' ? '测试中...' : '测试连接' }}
        </button>
        <span v-if="portError" class="test-result test-error">
          <i class="pi pi-times-circle" />
          {{ portError }}
        </span>
        <span v-else-if="connectionTest.status === 'success'" class="test-result test-success">
          <i class="pi pi-check-circle" />
          {{ connectionTest.message }}
        </span>
        <span v-else-if="connectionTest.status === 'warning'" class="test-result test-warning">
          <i class="pi pi-exclamation-circle" />
          {{ connectionTest.message }}
        </span>
        <span v-else-if="connectionTest.status === 'error'" class="test-result test-error">
          <i class="pi pi-times-circle" />
          {{ connectionTest.message }}
        </span>
      </div>
    </template>
  </EditorServiceCard>
</template>

<style scoped>
.inline-port {
  width: 70px;
  display: inline-block;
  vertical-align: baseline;
  margin: 0 var(--space-2xs);
}

.port-input {
  width: 80px;
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  text-align: center;
  transition: border-color var(--duration-normal);
  flex-shrink: 0;
  appearance: textfield;
}

.port-input::-webkit-outer-spin-button,
.port-input::-webkit-inner-spin-button {
  appearance: none;
  margin: 0;
}

.port-input.invalid {
  border-color: var(--error);
}

.port-input:focus {
  outline: none;
  border-color: var(--primary);
}

.test-connection-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  padding: var(--space-sm-md) var(--space-lg) var(--space-md-lg);
  border-top: 1px solid var(--border-subtle);
  flex-wrap: wrap;
}

.test-connection-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  padding: var(--space-xs) var(--space-md-lg);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: all var(--duration-fast);
}

.test-connection-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.test-connection-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.test-result {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-xs);
}

.test-result .pi {
  font-size: var(--text-xs);
}

.test-success {
  color: var(--success);
}

.test-warning {
  color: var(--warning);
}

.test-error {
  color: var(--error);
}
</style>
