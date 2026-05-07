<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import Button from 'primevue/button';
import type { EditorServerConfig, ServerServiceType } from '../../../config/types';
import { middleTruncate } from '../../../utils/pathUtils';
import { useToast } from '../../../composables/useToast';
import EditorServiceCard from './EditorServiceCard.vue';

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

const toast = useToast();

const commandCopied = ref(false);
const commandRef = ref<HTMLElement | null>(null);
const typoraCommand = computed(() => {
  const executable = props.executablePath || 'picnexus';
  const quoted = /\s/.test(executable) ? `"${executable}"` : executable;
  return `${quoted} --profile typora`;
});
const displayCommand = ref(typoraCommand.value);

function updateEditorServer(patch: Partial<EditorServerConfig>) {
  editorServer.value = { ...editorServer.value, ...patch };
}

function recalcDisplayPath() {
  const el = commandRef.value;
  const command = typoraCommand.value;
  if (!el || !command) {
    displayCommand.value = command || '...';
    return;
  }
  const containerWidth = el.clientWidth;
  const charWidth = 7.2;
  const maxChars = Math.max(20, Math.floor(containerWidth / charWidth));
  displayCommand.value = middleTruncate(command, maxChars);
}

useResizeObserver(commandRef, () => recalcDisplayPath());
watch(typoraCommand, () => nextTick(recalcDisplayPath));

async function copyTyporaCommand() {
  try {
    await navigator.clipboard.writeText(typoraCommand.value);
    commandCopied.value = true;
    setTimeout(() => { commandCopied.value = false; }, 2000);
  } catch (_e) {
    // 剪贴板权限被拒或 webview 不支持时，按钮不会变绿勾，必须显式提示
    toast.error('复制失败', '请手动选中命令复制');
  }
}
</script>

<template>
  <EditorServiceCard
    title="Typora"
    description="在 Typora 中粘贴图片时自动上传"
    serviceDesc="Typora 上传时使用的图床"
    :configuredServices="configuredServices"
    :healthStatusMap="healthStatusMap"
    :healthTooltipMap="healthTooltipMap"
    :cliUnsupportedServices="cliUnsupportedServices"
    :serviceLabelMap="serviceLabelMap"
    :enabled="editorServer.typoraEnabled"
    :service="editorServer.typoraService"
    @update:enabled="(v: boolean) => updateEditorServer({ typoraEnabled: v })"
    @update:service="(v: ServerServiceType | null) => updateEditorServer({ typoraService: v })"
    @navigateHosting="emit('navigateHosting')"
  >
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
          「命令」栏填入以下命令：
          <div class="guide-path-inline">
            <div class="exec-path-row">
              <code ref="commandRef" class="exec-path-text" v-tooltip.top="typoraCommand">{{ displayCommand }}</code>
              <Button
                :icon="commandCopied ? 'pi pi-check' : 'pi pi-copy'"
                text
                size="small"
                v-tooltip.top="commandCopied ? '已复制！' : '复制命令'"
                @click="copyTyporaCommand"
              />
            </div>
          </div>
        </span>
      </div>
    </div>
  </EditorServiceCard>
</template>

<style scoped>
.guide-path-inline {
  margin-top: var(--space-xs-sm);
}

.menu-label {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 微型 code badge，1px 无对应 token */
  padding: 1px var(--space-xs);
  background: var(--primary-alpha-8);
  border-radius: var(--radius-xs-sm);
  color: var(--primary);
}

.exec-path-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  background: var(--primary-alpha-8);
  border: 1px solid var(--primary-alpha-15);
  border-radius: var(--radius-sm-md);
  padding: var(--space-xs) var(--space-xs-sm) var(--space-xs) var(--space-sm-md);
}

.exec-path-text {
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--primary);
}
</style>
