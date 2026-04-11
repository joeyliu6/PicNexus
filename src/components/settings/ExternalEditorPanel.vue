<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import { invoke } from '@tauri-apps/api/core';
import Button from 'primevue/button';
import type { EditorServerConfig, ServerServiceType, ServiceType } from '../../config/types';
import { useServiceHealth } from '../../composables/useServiceHealth';
import { middleTruncate } from '../../utils/pathUtils';
import ServiceSelectorDropdown from './ServiceSelectorDropdown.vue';
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue';

interface Props {
  editorServer: EditorServerConfig;
  executablePath?: string;
  embedded?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:editorServer': [config: EditorServerConfig];
  'save': [];
  'navigateHosting': [];
}>();

const SERVICE_LABEL_MAP: Record<ServerServiceType, string> = {
  jd: '京东图床',
  qiyu: '七鱼图床',
  github: 'GitHub',
  smms: 'SM.MS',
  imgur: 'Imgur',
  r2: 'Cloudflare R2',
  tencent: '腾讯云 COS',
  aliyun: '阿里云 OSS',
  qiniu: '七牛云',
  upyun: '又拍云',
  weibo: '微博',
  bilibili: '哔哩哔哩',
  zhihu: '知乎',
  nowcoder: '牛客',
  chaoxing: '超星',
  nami: '纳米图床',
  custom_s3: '自定义 S3',
};

const CLI_UNSUPPORTED_SERVICES: Set<ServerServiceType> = new Set(['qiyu', 'nami']);

const ALL_SERVICES: Array<{ value: ServerServiceType; label: string }> = [
  { value: 'jd', label: '京东图床' },
  { value: 'qiyu', label: '七鱼图床' },
  { value: 'r2', label: 'Cloudflare R2' },
  { value: 'tencent', label: '腾讯云 COS' },
  { value: 'aliyun', label: '阿里云 OSS' },
  { value: 'qiniu', label: '七牛云' },
  { value: 'upyun', label: '又拍云' },
  { value: 'github', label: 'GitHub' },
  { value: 'smms', label: 'SM.MS' },
  { value: 'imgur', label: 'Imgur' },
  { value: 'weibo', label: '微博' },
  { value: 'bilibili', label: '哔哩哔哩' },
  { value: 'zhihu', label: '知乎' },
  { value: 'nowcoder', label: '牛客' },
  { value: 'chaoxing', label: '超星' },
  { value: 'nami', label: '纳米图床' },
];

const { healthStatusMap, healthTooltipMap } = useServiceHealth();

const execPathCopied = ref(false);
const portDraft = ref(String(props.editorServer.port));
const portError = ref('');
const typoraExpanded = ref(false);
const obsidianExpanded = ref(false);

const connectionTest = ref<{
  status: 'idle' | 'testing' | 'success' | 'warning' | 'error';
  message?: string;
}>({ status: 'idle' });

async function testObsidianConnection() {
  const port = props.editorServer.port;

  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    connectionTest.value = { status: 'error', message: '端口无效，必须在 1024-65535 之间' };
    return;
  }

  if (!props.editorServer.enabled) {
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

const configuredServices = computed(() =>
  ALL_SERVICES
    .filter((svc) => {
      const status = healthStatusMap.value[svc.value as ServiceType];
      return status && status !== 'unconfigured';
    })
    .sort((a, b) => {
      const aVerified = healthStatusMap.value[a.value as ServiceType] === 'verified';
      const bVerified = healthStatusMap.value[b.value as ServiceType] === 'verified';
      return aVerified === bVerified ? 0 : aVerified ? -1 : 1;
    }),
);

function getServiceLabel(service: ServerServiceType): string {
  return SERVICE_LABEL_MAP[service] || service;
}

function updateEditorServer(patch: Partial<EditorServerConfig>) {
  emit('update:editorServer', { ...props.editorServer, ...patch });
}

function selectTyporaService(svc: ServerServiceType | null) {
  updateEditorServer({ typoraService: svc });
}

function selectObsidianService(svc: ServerServiceType | null) {
  updateEditorServer({ obsidianService: svc });
}

const summaryText = computed(() => {
  const typoraService = props.editorServer.typoraService;
  const obsidianService = props.editorServer.obsidianService;
  const typoraText = props.editorServer.typoraEnabled
    ? `Typora → ${typoraService ? getServiceLabel(typoraService) : '未选择'}`
    : 'Typora 关闭';
  const obsidianText = props.editorServer.enabled
    ? `Obsidian → ${obsidianService ? getServiceLabel(obsidianService) : '未选择'} (${props.editorServer.port})`
    : 'Obsidian 关闭';
  return `${typoraText} · ${obsidianText}`;
});


const execPathRef = ref<HTMLElement | null>(null);
const displayPath = ref(props.executablePath || '...');

function recalcDisplayPath() {
  const el = execPathRef.value;
  const path = props.executablePath;
  if (!el || !path) {
    displayPath.value = path || '...';
    return;
  }
  const containerWidth = el.clientWidth;
  const charWidth = 7.2;
  const maxChars = Math.max(20, Math.floor(containerWidth / charWidth));
  displayPath.value = middleTruncate(path, maxChars);
}

useResizeObserver(execPathRef, () => recalcDisplayPath());
watch(() => props.executablePath, () => nextTick(recalcDisplayPath));

async function copyExecutablePath() {
  if (!props.executablePath) return;
  await navigator.clipboard.writeText(props.executablePath);
  execPathCopied.value = true;
  setTimeout(() => { execPathCopied.value = false; }, 2000);
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
    if (port !== props.editorServer.port) {
      updateEditorServer({ port });
    }
  }
}

function commitPortInput() {
  const error = validatePortInput(portDraft.value);
  portError.value = error ?? '';
  if (!error) {
    const port = Number(portDraft.value);
    if (port !== props.editorServer.port) {
      updateEditorServer({ port });
    }
  }
}

watch(
  () => props.editorServer.port,
  (port) => {
    portDraft.value = String(port);
    if (!validatePortInput(portDraft.value)) {
      portError.value = '';
    }
  },
);

</script>

<template>
  <div class="editor-panel">
    <div v-if="!embedded" class="section-header">
      <h2>外部编辑器集成</h2>
      <p class="section-desc">连接 Typora、Obsidian 等笔记软件，实现粘贴图片自动上传到图床。</p>
    </div>

    <div v-if="!embedded" class="panel-summary">
      <i class="pi pi-link" />
      <span>{{ summaryText }}</span>
    </div>

    <!-- Typora -->
    <CollapsibleSettingsCard
      title="Typora"
      description="在 Typora 中粘贴图片时自动上传"
      :enabled="editorServer.typoraEnabled"
      :expanded="typoraExpanded"
      allowOverflow
      @update:enabled="(v: boolean) => updateEditorServer({ typoraEnabled: v })"
      @update:expanded="(v: boolean) => typoraExpanded = v"
    >
      <div class="card-content-inner">
        <div class="card-service-row">
          <div class="card-service-info">
            <span class="card-service-label">上传到</span>
            <span class="card-service-desc">Typora 上传时使用的图床</span>
          </div>
          <ServiceSelectorDropdown
            :modelValue="editorServer.typoraService"
            :configuredServices="configuredServices"
            :healthStatusMap="(healthStatusMap as Record<string, string>)"
            :healthTooltipMap="(healthTooltipMap as Record<string, string>)"
            :cliUnsupportedServices="CLI_UNSUPPORTED_SERVICES"
            :serviceLabelMap="SERVICE_LABEL_MAP"
            @update:modelValue="selectTyporaService"
            @navigateHosting="emit('navigateHosting')"
          />
        </div>

        <div class="guide-card">
          <div class="guide-step">
            <span class="step-badge">1</span>
            <span class="step-text">打开 Typora，进入 <code class="menu-label">偏好设置</code> → <code class="menu-label">图像</code></span>
          </div>
          <div class="guide-step">
            <span class="step-badge">2</span>
            <span class="step-text">「上传服务」选择 <code class="inline-code">Custom Command</code></span>
          </div>
          <div class="guide-step">
            <span class="step-badge">3</span>
            <span class="step-text">
              「命令」栏填入以下路径：
              <div class="guide-path-inline">
                <div class="exec-path-row">
                  <code ref="execPathRef" class="exec-path-text" v-tooltip.top="executablePath || ''">{{ displayPath }}</code>
                  <Button
                    :icon="execPathCopied ? 'pi pi-check' : 'pi pi-copy'"
                    text
                    size="small"
                    v-tooltip.top="execPathCopied ? '已复制！' : '复制路径'"
                    @click="copyExecutablePath"
                  />
                </div>
              </div>
            </span>
          </div>
        </div>
      </div>
    </CollapsibleSettingsCard>

    <!-- Obsidian -->
    <CollapsibleSettingsCard
      title="Obsidian"
      description="在 Obsidian 中粘贴图片时自动上传"
      :enabled="editorServer.enabled"
      :expanded="obsidianExpanded"
      allowOverflow
      @update:enabled="(v: boolean) => updateEditorServer({ enabled: v })"
      @update:expanded="(v: boolean) => obsidianExpanded = v"
    >
      <div class="card-content-inner">
        <div class="card-service-row">
          <div class="card-service-info">
            <span class="card-service-label">上传到</span>
            <span class="card-service-desc">Obsidian 上传时使用的图床</span>
          </div>
          <ServiceSelectorDropdown
            :modelValue="editorServer.obsidianService"
            :configuredServices="configuredServices"
            :healthStatusMap="(healthStatusMap as Record<string, string>)"
            :healthTooltipMap="(healthTooltipMap as Record<string, string>)"
            :cliUnsupportedServices="CLI_UNSUPPORTED_SERVICES"
            :serviceLabelMap="SERVICE_LABEL_MAP"
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
  </div>
</template>

<style scoped>
@import url('../../styles/settings-shared.css');

.editor-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-content-inner {
  display: flex;
  flex-direction: column;
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

.panel-summary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.inline-port {
  width: 70px;
  display: inline-block;
  vertical-align: baseline;
  margin: 0 2px;
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

.guide-port-error {
  display: block;
  padding: 0 0 0 27px;
}

.guide-path-block {
  padding: 2px 0 0 27px;
}

.guide-path-inline {
  margin-top: 6px;
}

.inline-code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  padding: 1px 5px;
  background: var(--primary-alpha-8);
  border-radius: 3px;
  color: var(--primary);
}

.menu-label {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 500;
  padding: 1px 5px;
  background: var(--primary-alpha-8);
  border-radius: 3px;
  color: var(--primary);
}

.exec-path-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--primary-alpha-8);
  border: 1px solid var(--primary-alpha-15);
  border-radius: 6px;
  padding: 5px 6px 5px 10px;
}

.exec-path-text {
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--primary);
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

.port-error {
  font-size: var(--text-xs);
  color: var(--error);
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
