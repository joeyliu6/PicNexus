<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { onClickOutside, useElementBounding } from '@vueuse/core';
import Button from 'primevue/button';
import ToggleSwitch from 'primevue/toggleswitch';
import type { EditorServerConfig, ServerServiceType, ServiceType } from '../../config/types';
import { useServiceHealth } from '../../composables/useServiceHealth';

interface EditorApplyFeedbackState {
  status: 'idle' | 'applying' | 'applied' | 'error';
  message?: string;
  updatedAt?: number;
}

interface Props {
  editorServer: EditorServerConfig;
  executablePath?: string;
  embedded?: boolean;
  applyState?: EditorApplyFeedbackState;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:editorServer': [config: EditorServerConfig];
  'save': [];
  'retryApply': [];
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

const typoraPopoverOpen = ref(false);
const obsidianPopoverOpen = ref(false);
const execPathCopied = ref(false);
const typoraSelectorRef = ref<HTMLElement | null>(null);
const obsidianSelectorRef = ref<HTMLElement | null>(null);
const portDraft = ref(String(props.editorServer.port));
const portError = ref('');
const typoraExpanded = ref(false);
const obsidianExpanded = ref(false);

const { top: typoraSelectorTop, bottom: typoraSelectorBottom } = useElementBounding(typoraSelectorRef);
const { top: obsidianSelectorTop, bottom: obsidianSelectorBottom } = useElementBounding(obsidianSelectorRef);

onClickOutside(typoraSelectorRef, () => { typoraPopoverOpen.value = false; });
onClickOutside(obsidianSelectorRef, () => { obsidianPopoverOpen.value = false; });

const typoraDropdownUpward = computed(() => {
  const spaceBelow = window.innerHeight - typoraSelectorBottom.value;
  const spaceAbove = typoraSelectorTop.value;
  return spaceBelow < 220 && spaceAbove > spaceBelow;
});

const obsidianDropdownUpward = computed(() => {
  const spaceBelow = window.innerHeight - obsidianSelectorBottom.value;
  const spaceAbove = obsidianSelectorTop.value;
  return spaceBelow < 220 && spaceAbove > spaceBelow;
});

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
  typoraPopoverOpen.value = false;
}

function selectObsidianService(svc: ServerServiceType | null) {
  updateEditorServer({ obsidianService: svc });
  obsidianPopoverOpen.value = false;
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

function middleTruncate(path: string, maxChars: number): string {
  if (!path || path.length <= maxChars) return path || '...';
  const sep = path.includes('\\') ? '\\' : '/';
  const parts = path.split(sep);
  if (parts.length <= 3) {
    const half = Math.floor((maxChars - 1) / 2);
    return path.slice(0, half) + '…' + path.slice(-half);
  }
  const head = parts.slice(0, 2).join(sep);
  const tail = parts.slice(-1)[0];
  const fixed = head.length + tail.length + 4;
  if (maxChars <= fixed) return `${head}${sep}…${sep}${tail}`;
  const available = maxChars - fixed;
  const mid = parts.slice(2, -1);
  let kept = '';
  for (const p of mid) {
    const next = kept ? kept + sep + p : p;
    if (next.length > available) break;
    kept = next;
  }
  return kept ? `${head}${sep}${kept}${sep}…${sep}${tail}` : `${head}${sep}…${sep}${tail}`;
}

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

let resizeObserver: ResizeObserver | null = null;

watch(execPathRef, (el) => {
  resizeObserver?.disconnect();
  if (!el) return;
  resizeObserver = new ResizeObserver(() => recalcDisplayPath());
  resizeObserver.observe(el);
  nextTick(recalcDisplayPath);
});

watch(() => props.executablePath, () => nextTick(recalcDisplayPath));

onBeforeUnmount(() => resizeObserver?.disconnect());

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

const applyStatusClass = computed(() => {
  switch (props.applyState?.status) {
    case 'applying':
      return 'pending';
    case 'applied':
      return 'verified';
    case 'error':
      return 'error';
    default:
      return '';
  }
});

const applyStatusLabel = computed(() => {
  switch (props.applyState?.status) {
    case 'applying':
      return '应用中';
    case 'applied':
      return '已生效';
    case 'error':
      return '应用失败';
    default:
      return '';
  }
});
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
    <div class="editor-card" :class="{ expanded: typoraExpanded }">
      <div class="card-header" @click="typoraExpanded = !typoraExpanded">
        <div class="header-left">
          <span class="status-dot" :class="editorServer.typoraEnabled ? 'verified' : ''" v-tooltip.top="editorServer.typoraEnabled ? '已启用' : '未启用'" />
          <div class="header-info">
            <span class="card-title">Typora</span>
            <span class="card-description">在 Typora 中粘贴图片时自动上传</span>
          </div>
        </div>
        <div class="header-right">
          <ToggleSwitch
            :modelValue="editorServer.typoraEnabled"
            @update:modelValue="(v: boolean) => updateEditorServer({ typoraEnabled: v })"
            @click.stop
          />
          <i class="expand-icon pi" :class="typoraExpanded ? 'pi-chevron-up' : 'pi-chevron-down'" />
        </div>
      </div>

      <div class="card-content-wrapper">
      <div class="card-content">
        <div class="card-service-row">
          <div class="card-service-info">
            <span class="card-service-label">上传到</span>
            <span class="card-service-desc">Typora 上传时使用的图床</span>
          </div>
          <div ref="typoraSelectorRef" class="service-selector" :class="{ 'is-upward': typoraDropdownUpward }">
            <button
              class="service-trigger"
              v-tooltip.top="editorServer.typoraService ? getServiceLabel(editorServer.typoraService) : null"
              @click.stop="typoraPopoverOpen = !typoraPopoverOpen"
            >
              <span
                v-if="editorServer.typoraService"
                class="status-dot"
                :class="healthStatusMap[editorServer.typoraService as ServiceType]"
                v-tooltip.top="healthTooltipMap[editorServer.typoraService as ServiceType]"
              />
              <span v-else class="status-dot-placeholder" />
              <span class="service-trigger-name">
                {{ editorServer.typoraService ? getServiceLabel(editorServer.typoraService) : '请选择图床' }}
              </span>
              <i class="pi pi-chevron-down service-trigger-chevron" />
            </button>

            <Transition name="dropdown">
              <div v-if="typoraPopoverOpen" class="service-dropdown" :class="{ upward: typoraDropdownUpward }">
                <button
                  v-for="svc in configuredServices"
                  :key="svc.value"
                  class="service-item"
                  :class="{
                    active: editorServer.typoraService === svc.value,
                    disabled: CLI_UNSUPPORTED_SERVICES.has(svc.value),
                  }"
                  v-tooltip.top="CLI_UNSUPPORTED_SERVICES.has(svc.value)
                    ? '该图床不支持 CLI 模式（需要浏览器自动化）'
                    : (healthTooltipMap[svc.value as ServiceType] || null)"
                  @click="!CLI_UNSUPPORTED_SERVICES.has(svc.value) && selectTyporaService(svc.value)"
                >
                  <span
                    class="status-dot"
                    :class="CLI_UNSUPPORTED_SERVICES.has(svc.value) ? '' : (healthStatusMap[svc.value as ServiceType] || '')"
                  />
                  <span>{{ svc.label }}</span>
                </button>

                <div v-if="configuredServices.length === 0" class="service-empty">
                  <i class="pi pi-box service-empty-icon" />
                  <span class="service-empty-title">暂无可用图床</span>
                  <span class="service-empty-desc">需要先在「图床设置」中配置并验证至少一个图床</span>
                  <Button
                    text
                    size="small"
                    icon="pi pi-arrow-right"
                    label="前往图床设置"
                    @click="typoraPopoverOpen = false; emit('navigateHosting')"
                  />
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <div class="guide-card">
          <div class="guide-step">
            <span class="step-badge">1</span>
            <span class="step-text">打开 Typora，进入 <code class="inline-code">偏好设置</code> → <code class="inline-code">图像</code></span>
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
      </div>
    </div>

    <!-- Obsidian -->
    <div class="editor-card" :class="{ expanded: obsidianExpanded }">
      <div class="card-header" @click="obsidianExpanded = !obsidianExpanded">
        <div class="header-left">
          <span class="status-dot" :class="editorServer.enabled ? 'verified' : ''" v-tooltip.top="editorServer.enabled ? '已启用' : '未启用'" />
          <div class="header-info">
            <span class="card-title">Obsidian</span>
            <span class="card-description">在 Obsidian 中粘贴图片时自动上传</span>
          </div>
        </div>
        <div class="header-right">
          <ToggleSwitch
            :modelValue="editorServer.enabled"
            @update:modelValue="(v: boolean) => updateEditorServer({ enabled: v })"
            @click.stop
          />
          <i class="expand-icon pi" :class="obsidianExpanded ? 'pi-chevron-up' : 'pi-chevron-down'" />
        </div>
      </div>

      <div class="card-content-wrapper">
      <div class="card-content">
        <div v-if="props.applyState?.status && props.applyState.status !== 'idle' && props.applyState.status !== 'applied'" class="apply-feedback" :class="applyStatusClass">
          <span class="apply-badge" :class="applyStatusClass">{{ applyStatusLabel }}</span>
          <span v-if="props.applyState?.message" class="apply-text">{{ props.applyState.message }}</span>
          <Button
            v-if="props.applyState?.status === 'error'"
            label="重试应用"
            text
            size="small"
            @click="emit('retryApply')"
          />
        </div>

        <div class="card-service-row">
          <div class="card-service-info">
            <span class="card-service-label">上传到</span>
            <span class="card-service-desc">Obsidian 上传时使用的图床</span>
          </div>
          <div ref="obsidianSelectorRef" class="service-selector" :class="{ 'is-upward': obsidianDropdownUpward }">
            <button
              class="service-trigger"
              v-tooltip.top="editorServer.obsidianService ? getServiceLabel(editorServer.obsidianService) : null"
              @click.stop="obsidianPopoverOpen = !obsidianPopoverOpen"
            >
              <span
                v-if="editorServer.obsidianService"
                class="status-dot"
                :class="healthStatusMap[editorServer.obsidianService as ServiceType]"
                v-tooltip.top="healthTooltipMap[editorServer.obsidianService as ServiceType]"
              />
              <span v-else class="status-dot-placeholder" />
              <span class="service-trigger-name">
                {{ editorServer.obsidianService ? getServiceLabel(editorServer.obsidianService) : '请选择图床' }}
              </span>
              <i class="pi pi-chevron-down service-trigger-chevron" />
            </button>

            <Transition name="dropdown">
              <div v-if="obsidianPopoverOpen" class="service-dropdown" :class="{ upward: obsidianDropdownUpward }">
                <button
                  v-for="svc in configuredServices"
                  :key="svc.value"
                  class="service-item"
                  :class="{
                    active: editorServer.obsidianService === svc.value,
                    disabled: CLI_UNSUPPORTED_SERVICES.has(svc.value),
                  }"
                  v-tooltip.top="CLI_UNSUPPORTED_SERVICES.has(svc.value)
                    ? '该图床不支持外部编辑器模式（需要浏览器自动化）'
                    : (healthTooltipMap[svc.value as ServiceType] || null)"
                  @click="!CLI_UNSUPPORTED_SERVICES.has(svc.value) && selectObsidianService(svc.value)"
                >
                  <span
                    class="status-dot"
                    :class="CLI_UNSUPPORTED_SERVICES.has(svc.value) ? '' : (healthStatusMap[svc.value as ServiceType] || '')"
                  />
                  <span>{{ svc.label }}</span>
                </button>

                <div v-if="configuredServices.length === 0" class="service-empty">
                  <i class="pi pi-box service-empty-icon" />
                  <span class="service-empty-title">暂无可用图床</span>
                  <span class="service-empty-desc">需要先在「图床设置」中配置并验证至少一个图床</span>
                  <Button
                    text
                    size="small"
                    icon="pi pi-arrow-right"
                    label="前往图床设置"
                    @click="obsidianPopoverOpen = false; emit('navigateHosting')"
                  />
                </div>
              </div>
            </Transition>
          </div>
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
          <span v-if="portError" class="port-error guide-port-error">{{ portError }}</span>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

.editor-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.editor-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  overflow: visible;
  transition: border-color 0.2s ease;
}

.editor-card:hover {
  border-color: var(--primary);
}

.editor-card.expanded {
  border-color: var(--primary);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;
}

.card-header:hover {
  background-color: var(--hover-overlay-subtle);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.card-description {
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.3;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.expand-icon {
  font-size: 0.875rem;
  color: var(--text-muted);
  transition: transform 0.2s ease, color 0.2s ease;
}

.editor-card:hover .expand-icon {
  color: var(--text-secondary);
}

.editor-card.expanded .expand-icon {
  color: var(--primary);
}

.card-content-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.25s ease;
}

.editor-card.expanded .card-content-wrapper {
  grid-template-rows: 1fr;
}

.card-content {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

@keyframes show-overflow {
  to { overflow: visible; }
}

.editor-card.expanded .card-content {
  animation: show-overflow 0s 0.25s forwards;
}

.card-content > :first-child {
  border-top: 1px solid var(--border-subtle);
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
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.card-service-desc {
  font-size: 12px;
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
  font-size: 12px;
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
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  position: relative;
  top: 1px;
}

.step-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
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
  font-size: 12px;
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
  font-size: 12px;
  color: var(--primary);
}

.apply-feedback {
  margin: 0;
  padding: 8px 16px;
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  border-radius: 0;
  background: var(--bg-input);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.apply-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 600;
}

.apply-badge.pending {
  color: var(--warning);
  background: var(--warning-soft);
}

.apply-badge.verified {
  color: var(--success);
  background: var(--success-soft);
}

.apply-badge.error {
  color: var(--error);
  background: var(--error-soft);
}

.apply-text {
  font-size: 12px;
  color: var(--text-muted);
}


.port-input {
  width: 80px;
  padding: 4px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-mono);
  text-align: center;
  transition: border-color 0.2s;
  flex-shrink: 0;
}

.port-input.invalid {
  border-color: var(--error);
}

.port-input:focus {
  outline: none;
  border-color: var(--primary);
}

.port-error {
  font-size: 12px;
  color: var(--error);
}


.service-selector {
  position: relative;
  flex-shrink: 0;
  width: 110px;
}

.service-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-main);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.service-trigger:hover {
  background: var(--hover-overlay-subtle);
  border-color: var(--primary-alpha-30);
}

.service-trigger-name {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-trigger-chevron {
  font-size: 10px;
  color: var(--text-muted);
}

.service-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  bottom: auto;
  z-index: var(--z-dropdown);
  min-width: 220px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  box-shadow: var(--shadow-float);
  padding: 4px 0;
  overflow: hidden;
}

.service-dropdown.upward {
  top: auto;
  bottom: calc(100% + 6px);
}

.is-upward .dropdown-enter-from,
.is-upward .dropdown-leave-to {
  transform: translateY(8px);
}

.service-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border: none;
  background: transparent;
  color: var(--text-main);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: background 0.1s;
}

.service-item:hover:not(.disabled) {
  background: var(--hover-overlay);
}

.service-item.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.service-item.active {
  background: var(--primary-alpha-10);
  color: var(--primary);
}

.service-empty {
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
}

.service-empty-icon {
  font-size: 24px;
  color: var(--text-muted);
  opacity: 0.5;
  margin-bottom: 4px;
}

.service-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.service-empty-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  max-width: 200px;
}

.editor-card > .card-header .status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
  transition: all 0.2s ease;
  box-shadow: 0 0 0 2px var(--bg-card);
}

.editor-card > .card-header .status-dot.verified {
  background: var(--success);
  box-shadow: 0 0 0 2px var(--bg-card), 0 0 6px var(--success-border);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.status-dot.configured,
.status-dot.verified {
  background: var(--success);
  box-shadow: 0 0 6px var(--success-border);
}

.status-dot.pending {
  background: var(--warning);
  box-shadow: 0 0 6px var(--warning-border);
}

.status-dot.error {
  background: var(--error);
  box-shadow: 0 0 6px var(--error-border);
}

.status-dot-placeholder {
  display: inline-block;
  width: 7px;
  height: 7px;
  flex-shrink: 0;
}

@media (max-width: 760px) {
  .card-service-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .service-selector {
    width: 100%;
  }

  .service-trigger {
    width: 100%;
    justify-content: space-between;
  }

  .card-header {
    padding: 12px 14px;
  }

  .card-title {
    font-size: 0.875rem;
  }

  .port-status-left {
    flex-wrap: wrap;
  }
}
</style>
