<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { EditorServerConfig, ServerServiceType } from '../../../config/types';
import ServiceSelectorDropdown from '../ServiceSelectorDropdown.vue';
import CollapsibleSettingsCard from '../CollapsibleSettingsCard.vue';

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

const obsidianExpanded = ref(false);
const portDraft = ref(String(editorServer.value.port));
const portError = ref('');

// 开关已开但未选图床 → 需要提醒用户配置
const needsService = computed(
  () => editorServer.value.enabled && !editorServer.value.obsidianService,
);

// 用户刚把开关从关切到开、且图床还没选时，自动展开卡片引导下一步
watch(
  () => editorServer.value.enabled,
  (curr, prev) => {
    if (curr && !prev && !editorServer.value.obsidianService) {
      obsidianExpanded.value = true;
    }
  },
);

const connectionTest = ref<{
  status: 'idle' | 'testing' | 'success' | 'warning' | 'error';
  message?: string;
}>({ status: 'idle' });

function updateEditorServer(patch: Partial<EditorServerConfig>) {
  editorServer.value = { ...editorServer.value, ...patch };
}

function selectObsidianService(svc: ServerServiceType | null) {
  updateEditorServer({ obsidianService: svc });
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
  portDraft.value = (e.target as HTMLInputElement).value;
  const error = validatePortInput(portDraft.value);
  portError.value = error ?? '';
  if (!error) {
    const port = Number(portDraft.value);
    if (port !== editorServer.value.port) {
      updateEditorServer({ port });
    }
  }
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
  <CollapsibleSettingsCard
    title="Obsidian"
    description="在 Obsidian 中粘贴图片时自动上传"
    :enabled="editorServer.enabled"
    :expanded="obsidianExpanded"
    :needsAttention="needsService"
    attentionTooltip="需选择图床才能使用"
    allowOverflow
    @update:enabled="(v: boolean) => updateEditorServer({ enabled: v })"
    @update:expanded="(v: boolean) => obsidianExpanded = v"
  >
    <div class="card-content-inner">
      <div v-if="needsService" class="missing-service-banner">
        <i class="pi pi-exclamation-circle" />
        <span>开关已开启，但还没选择图床。请在下方选择一个图床后才能正常使用。</span>
      </div>
      <div class="card-service-row">
        <div class="card-service-info">
          <span class="card-service-label">上传到</span>
          <span class="card-service-desc">Obsidian 上传时使用的图床</span>
        </div>
        <ServiceSelectorDropdown
          :modelValue="editorServer.obsidianService"
          :configuredServices="configuredServices"
          :healthStatusMap="healthStatusMap"
          :healthTooltipMap="healthTooltipMap"
          :cliUnsupportedServices="cliUnsupportedServices"
          :serviceLabelMap="serviceLabelMap"
          @update:modelValue="selectObsidianService"
          @navigateHosting="emit('navigateHosting')"
        />
      </div>

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
    </div>
  </CollapsibleSettingsCard>
</template>

<style scoped>
.card-content-inner {
  display: flex;
  flex-direction: column;
}

.missing-service-banner {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--warning-alpha-8);
  border-bottom: 1px solid var(--warning-border);
  color: var(--warning);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.missing-service-banner .pi {
  font-size: var(--text-sm);
  flex-shrink: 0;
}

.card-service-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.card-service-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-service-label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.card-service-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.guide-card {
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.guide-step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  position: relative;
  padding-bottom: 12px;
}

.guide-step:last-child {
  padding-bottom: 0;
}

.guide-step::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 18px;
  bottom: 0;
  width: 1px;
  background: var(--border-subtle);
}

.guide-step:last-child::before {
  display: none;
}

.step-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  border: 1.5px solid var(--border-subtle);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--text-2xs);
  font-weight: 600;
  flex-shrink: 0;
  position: relative;
  top: 1px;
}

.step-text {
  flex: 1;
  min-width: 0;
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--text-muted);
}

.inline-code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  padding: 1px 5px;
  background: var(--primary-alpha-8);
  border-radius: 3px;
  color: var(--primary);
}

.inline-port {
  width: 70px;
  display: inline-block;
  vertical-align: baseline;
  margin: 0 2px;
}

.port-input {
  width: 80px;
  padding: 4px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
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
  gap: 10px;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--border-subtle);
  flex-wrap: wrap;
}

.test-connection-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 500;
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
  gap: 4px;
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

@media (width <= 760px) {
  .card-service-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
