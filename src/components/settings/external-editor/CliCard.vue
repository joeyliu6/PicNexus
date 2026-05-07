<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import Button from 'primevue/button';
import type { EditorServerConfig } from '../../../config/types';
import { useToast } from '../../../composables/useToast';
import CollapsibleSettingsCard from '../CollapsibleSettingsCard.vue';

interface Props {
  executablePath?: string;
}

interface CliPathStatus {
  supported: boolean;
  inPath: boolean;
  executableDir: string;
  commandName: 'picnexus';
  needsTerminalRestart: boolean;
  message?: string;
}

const props = defineProps<Props>();
const editorServer = defineModel<EditorServerConfig>('editorServer', { required: true });
const toast = useToast();
const copiedCommand = ref<'path' | 'full' | null>(null);
const pathStatus = ref<CliPathStatus | null>(null);
const pathLoading = ref(false);
const pathApplying = ref(false);
const pathError = ref('');
const expanded = ref(false);

const cliEnabled = computed(() => editorServer.value.cliEnabled === true);

const pathCommand = computed(() => 'picnexus --service r2 image.png');

const fullPathCommand = computed(() => {
  const executable = props.executablePath || 'picnexus';
  const quoted = /\s/.test(executable) ? `"${executable}"` : executable;
  return `${quoted} --service r2 image.png`;
});

const pathStatusText = computed(() => {
  const status = pathStatus.value;
  if (pathLoading.value) return '正在检测 PATH...';
  if (pathError.value) return pathError.value;
  if (!status) return '';
  if (!status.supported) return status.message || '当前平台暂不支持一键加入 PATH，请复制完整路径命令。';
  if (!cliEnabled.value || status.inPath) return '';
  if (status.message) return status.message;
  return 'CLI 已开启，但命令入口还未加入 PATH。请关闭后重试。';
});

const shouldShowPathStatusNote = computed(() => Boolean(pathStatusText.value));

const pathCommandLabel = computed(() => (
  pathStatus.value?.inPath
    ? '已加入 PATH，直接使用短命令：'
    : '加入 PATH 后，可直接使用短命令：'
));

const pathLinkNeedsShellSetup = computed(() => {
  const status = pathStatus.value;
  return Boolean(cliEnabled.value && status?.supported && !status.inPath && status.message);
});

const pathUnsupportedWhileEnabled = computed(() => (
  cliEnabled.value && pathStatus.value?.supported === false
));

const needsAttention = computed(() => (
  pathLinkNeedsShellSetup.value || pathUnsupportedWhileEnabled.value || Boolean(pathError.value)
));
const attentionTooltip = computed(() => (
  pathLinkNeedsShellSetup.value
    ? '命令链接已创建，但终端 PATH 还需要手动补充'
    : pathUnsupportedWhileEnabled.value
      ? '当前平台暂不支持自动启用命令入口'
      : pathError.value || '命令入口需要处理'
));

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }
  return '操作失败，请稍后重试';
}

async function refreshPathStatus() {
  pathLoading.value = true;
  pathError.value = '';
  try {
    const status = await invoke<CliPathStatus>('get_cli_path_status');
    if (status && typeof status.supported === 'boolean') {
      pathStatus.value = status;
    }
  } catch (error) {
    pathError.value = errorToMessage(error);
  } finally {
    pathLoading.value = false;
  }
}

async function applyPathStatus(enable: boolean, options: { showErrorToast?: boolean } = {}) {
  const { showErrorToast = true } = options;
  const status = pathStatus.value;
  if (!status?.supported || pathApplying.value) return null;

  pathApplying.value = true;
  pathError.value = '';
  const command = enable ? 'add_cli_to_path' : 'remove_cli_from_path';
  try {
    const nextStatus = await invoke<CliPathStatus>(command);
    pathStatus.value = nextStatus;
    return nextStatus;
  } catch (error) {
    const message = errorToMessage(error);
    pathError.value = message;
    if (showErrorToast) {
      toast.error('CLI 命令入口更新失败', `${message}\n请稍后重试，或继续使用完整路径命令。`);
    }
    return null;
  } finally {
    pathApplying.value = false;
  }
}

async function updateCliEnabled(value: boolean) {
  if (pathLoading.value || pathApplying.value) return;

  if (!value) {
    editorServer.value = { ...editorServer.value, cliEnabled: false };

    if (!pathStatus.value) {
      await refreshPathStatus();
    }

    const status = pathStatus.value;
    if (pathError.value) {
      toast.warn('已关闭 CLI', `${pathError.value}\n已停止导出 CLI 配置，但命令入口状态未知，请手动检查 PATH。`);
      return;
    }
    if (!status?.supported) {
      pathError.value = status?.message || '当前平台暂不支持自动移除 CLI 命令入口。';
      toast.warn('已关闭 CLI', `${pathError.value}\n已停止导出 CLI 配置，请手动检查命令入口。`);
      return;
    }

    const nextStatus = await applyPathStatus(false, { showErrorToast: false });
    if (nextStatus) {
      toast.success('已关闭 CLI', '已停止导出 CLI 配置并移除命令入口');
    } else {
      toast.warn('已关闭 CLI', `${pathError.value}\n已停止导出 CLI 配置，但命令入口移除失败，请手动清理 PATH。`);
    }
    return;
  }

  if (!pathStatus.value) {
    await refreshPathStatus();
  }

  const status = pathStatus.value;
  if (pathError.value) {
    toast.error('CLI 命令入口不可用', `${pathError.value}\n请稍后重试，或继续使用完整路径命令。`);
    return;
  }
  if (!status?.supported) {
    pathError.value = status?.message || '当前平台暂不支持一键启用 CLI 命令入口。';
    toast.error('CLI 命令入口不可用', `${pathError.value}\n请使用完整路径命令。`);
    return;
  }

  const nextStatus = await applyPathStatus(true);
  if (!nextStatus) return;

  editorServer.value = { ...editorServer.value, cliEnabled: true };
  expanded.value = true;

  const addNeedsShellSetup = !nextStatus.inPath && nextStatus.message;
  toast.success(
    addNeedsShellSetup ? '已创建命令链接' : '已启用 CLI',
    addNeedsShellSetup ? '请按页面提示配置 PATH' : '请重新打开终端后使用 picnexus',
  );
}

async function copyCommand(kind: 'path' | 'full', command: string) {
  try {
    await navigator.clipboard.writeText(command);
    copiedCommand.value = kind;
    setTimeout(() => {
      if (copiedCommand.value === kind) copiedCommand.value = null;
    }, 2000);
  } catch (_e) {
    toast.error('复制失败', '请手动选中命令复制');
  }
}

onMounted(() => {
  void refreshPathStatus();
});
</script>

<template>
  <CollapsibleSettingsCard
    title="命令行 CLI"
    description="在终端指定图床上传"
    :enabled="cliEnabled"
    :expanded="expanded"
    :toggleDisabled="pathLoading || pathApplying"
    :needsAttention="needsAttention"
    :attentionTooltip="attentionTooltip"
    @update:enabled="updateCliEnabled"
    @update:expanded="(v: boolean) => expanded = v"
  >
    <div class="cli-card-content">
      <div v-if="!cliEnabled" class="cli-disabled-banner">
        <i class="pi pi-info-circle" />
        <span>打开开关后会启用 CLI 图床配置，并尝试安装 <code class="inline-code">picnexus</code> 命令入口。</span>
      </div>

      <div class="guide-card cli-guide-card">
        <div
          v-if="shouldShowPathStatusNote"
          class="path-status-note"
          :class="{ warning: pathLinkNeedsShellSetup || pathUnsupportedWhileEnabled, error: !!pathError }"
        >
          <i
            class="pi"
            :class="pathError ? 'pi-times-circle' : pathLinkNeedsShellSetup ? 'pi-exclamation-circle' : 'pi-terminal'"
          />
          <span>{{ pathStatusText }}</span>
        </div>
        <div class="guide-step">
          <span class="step-badge">1</span>
          <span class="step-text">打开 CLI 后，PicNexus 会导出已配置且支持 CLI 的图床命令。</span>
        </div>
        <div class="guide-step">
          <span class="step-badge">2</span>
          <span class="step-text">
            上传时用 <code class="inline-code">--service &lt;图床名&gt;</code> 指定目标，例如
            <code class="inline-code">r2</code>、<code class="inline-code">smms</code>、<code class="inline-code">github</code>。
          </span>
        </div>
        <div class="guide-step">
          <span class="step-badge">3</span>
          <span class="step-text">
            {{ pathCommandLabel }}
            <div class="guide-path-inline">
              <div class="exec-path-row">
                <code class="exec-path-text" v-tooltip.top="pathCommand">{{ pathCommand }}</code>
                <Button
                  :icon="copiedCommand === 'path' ? 'pi pi-check' : 'pi pi-copy'"
                  text
                  size="small"
                  v-tooltip.top="copiedCommand === 'path' ? '已复制！' : '复制 PATH 命令'"
                  @click="copyCommand('path', pathCommand)"
                />
              </div>
            </div>
          </span>
        </div>
        <div class="guide-step">
          <span class="step-badge">4</span>
          <span class="step-text">
            未加入 PATH 时，复制完整路径命令：
            <div class="guide-path-inline">
              <div class="exec-path-row">
                <code class="exec-path-text" v-tooltip.top="fullPathCommand">{{ fullPathCommand }}</code>
                <Button
                  :icon="copiedCommand === 'full' ? 'pi pi-check' : 'pi pi-copy'"
                  text
                  size="small"
                  v-tooltip.top="copiedCommand === 'full' ? '已复制！' : '复制完整路径命令'"
                  @click="copyCommand('full', fullPathCommand)"
                />
              </div>
            </div>
          </span>
        </div>
      </div>
    </div>
  </CollapsibleSettingsCard>
</template>

<style>
@import url('../../../styles/editor-card.css');
</style>

<style scoped>
@import url('../../../styles/settings-shared.css');

.cli-card-content {
  display: flex;
  flex-direction: column;
}

.cli-disabled-banner {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-sm-md) var(--space-md);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.cli-disabled-banner .pi {
  font-size: var(--text-sm);
  flex-shrink: 0;
  margin-top: var(--space-2xs);
}

.path-status-note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs-sm);
  padding: var(--space-xs-sm) var(--space-sm-md);
  margin-bottom: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.6;
}

.path-status-note span {
  min-width: 0;
  flex: 1;
  white-space: pre-line;
}

.path-status-note .pi {
  flex-shrink: 0;
  margin-top: var(--space-2xs);
  font-size: var(--text-xs);
}

.path-status-note.warning {
  border-color: var(--warning-border);
  background: var(--warning-alpha-8);
  color: var(--warning);
}

.path-status-note.error {
  border-color: var(--error-alpha-15);
  background: var(--error-alpha-10);
  color: var(--error);
}

.cli-guide-card {
  padding-top: var(--space-md);
}

.guide-path-inline {
  margin-top: var(--space-xs-sm);
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
  overflow-wrap: anywhere;
  line-height: 1.7;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--primary);
}

</style>
