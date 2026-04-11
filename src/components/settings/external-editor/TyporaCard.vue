<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import Button from 'primevue/button';
import type { EditorServerConfig, ServerServiceType } from '../../../config/types';
import { middleTruncate } from '../../../utils/pathUtils';
import ServiceSelectorDropdown from '../ServiceSelectorDropdown.vue';
import CollapsibleSettingsCard from '../CollapsibleSettingsCard.vue';

interface Props {
  executablePath?: string;
  configuredServices: Array<{ value: ServerServiceType; label: string }>;
  healthStatusMap: Record<string, string>;
  healthTooltipMap: Record<string, string>;
  cliUnsupportedServices: Set<ServerServiceType>;
  serviceLabelMap: Record<ServerServiceType, string>;
}

const props = defineProps<Props>();

const editorServer = defineModel<EditorServerConfig>('editorServer', { required: true });

const emit = defineEmits<{
  navigateHosting: [];
}>();

const typoraExpanded = ref(false);
const execPathCopied = ref(false);
const execPathRef = ref<HTMLElement | null>(null);
const displayPath = ref(props.executablePath || '...');

// 开关已开但未选图床 → 需要提醒用户配置
const needsService = computed(
  () => editorServer.value.typoraEnabled && !editorServer.value.typoraService,
);

// 用户刚把开关从关切到开、且图床还没选时，自动展开卡片引导下一步
watch(
  () => editorServer.value.typoraEnabled,
  (curr, prev) => {
    if (curr && !prev && !editorServer.value.typoraService) {
      typoraExpanded.value = true;
    }
  },
);

function updateEditorServer(patch: Partial<EditorServerConfig>) {
  editorServer.value = { ...editorServer.value, ...patch };
}

function selectTyporaService(svc: ServerServiceType | null) {
  updateEditorServer({ typoraService: svc });
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

useResizeObserver(execPathRef, () => recalcDisplayPath());
watch(() => props.executablePath, () => nextTick(recalcDisplayPath));

async function copyExecutablePath() {
  if (!props.executablePath) return;
  await navigator.clipboard.writeText(props.executablePath);
  execPathCopied.value = true;
  setTimeout(() => { execPathCopied.value = false; }, 2000);
}
</script>

<template>
  <CollapsibleSettingsCard
    title="Typora"
    description="在 Typora 中粘贴图片时自动上传"
    :enabled="editorServer.typoraEnabled"
    :expanded="typoraExpanded"
    :needsAttention="needsService"
    attentionTooltip="需选择图床才能使用"
    allowOverflow
    @update:enabled="(v: boolean) => updateEditorServer({ typoraEnabled: v })"
    @update:expanded="(v: boolean) => typoraExpanded = v"
  >
    <div class="card-content-inner">
      <div v-if="needsService" class="missing-service-banner">
        <i class="pi pi-exclamation-circle" />
        <span>开关已开启，但还没选择图床。请在下方选择一个图床后才能正常使用。</span>
      </div>
      <div class="card-service-row">
        <div class="card-service-info">
          <span class="card-service-label">上传到</span>
          <span class="card-service-desc">Typora 上传时使用的图床</span>
        </div>
        <ServiceSelectorDropdown
          :modelValue="editorServer.typoraService"
          :configuredServices="configuredServices"
          :healthStatusMap="healthStatusMap"
          :healthTooltipMap="healthTooltipMap"
          :cliUnsupportedServices="cliUnsupportedServices"
          :serviceLabelMap="serviceLabelMap"
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

@media (width <= 760px) {
  .card-service-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
