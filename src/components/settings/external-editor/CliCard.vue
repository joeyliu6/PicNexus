<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import Button from 'primevue/button';
import { useToast } from '../../../composables/useToast';

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
const toast = useToast();
const copiedCommand = ref<'path' | 'full' | null>(null);
const pathStatus = ref<CliPathStatus | null>(null);
const pathLoading = ref(false);
const pathApplying = ref(false);
const pathError = ref('');

const pathCommand = computed(() => 'picnexus --service r2 image.png');

const fullPathCommand = computed(() => {
  const executable = props.executablePath || 'picnexus';
  const quoted = /\s/.test(executable) ? `"${executable}"` : executable;
  return `${quoted} --service r2 image.png`;
});

const pathStatusText = computed(() => {
  const status = pathStatus.value;
  if (pathLoading.value) return '正在检测 PATH 状态...';
  if (pathError.value) return pathError.value;
  if (!status) return '可使用完整路径命令，或加入 PATH 后直接使用 picnexus。';
  if (!status.supported) return status.message || '当前平台暂不支持一键加入 PATH，请使用完整路径命令。';
  if (status.inPath) return '已加入 PATH，新终端可直接使用 picnexus 命令。';
  if (status.message) return status.message;
  return '未加入 PATH，加入后新终端可直接使用 picnexus 命令。';
});

const pathLinkNeedsShellSetup = computed(() => {
  const status = pathStatus.value;
  return Boolean(status?.supported && !status.inPath && status.message);
});

const pathActionLabel = computed(() => {
  if (pathLoading.value) return '检测中...';
  if (pathApplying.value) return '处理中...';
  if (!pathStatus.value?.supported) return '暂不支持';
  if (pathLinkNeedsShellSetup.value) return '移除链接';
  return pathStatus.value.inPath ? '移除 PATH' : '加入 PATH';
});

const pathActionIcon = computed(() => (
  pathStatus.value?.inPath || pathLinkNeedsShellSetup.value ? 'pi pi-times' : 'pi pi-plus'
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

async function togglePathStatus() {
  const status = pathStatus.value;
  if (!status?.supported || pathApplying.value) return;

  pathApplying.value = true;
  pathError.value = '';
  const removingCreatedLink = pathLinkNeedsShellSetup.value;
  const shouldRemove = status.inPath || removingCreatedLink;
  const command = shouldRemove ? 'remove_cli_from_path' : 'add_cli_to_path';
  try {
    const nextStatus = await invoke<CliPathStatus>(command);
    pathStatus.value = nextStatus;
    const addNeedsShellSetup = !shouldRemove && !nextStatus.inPath && nextStatus.message;
    toast.success(
      shouldRemove
        ? (removingCreatedLink ? '已移除链接' : '已移除 PATH')
        : (addNeedsShellSetup ? '已创建链接' : '已加入 PATH'),
      addNeedsShellSetup ? '请按页面提示配置 PATH' : '请重新打开终端后使用 picnexus',
    );
  } catch (error) {
    const message = errorToMessage(error);
    pathError.value = message;
    toast.error('PATH 更新失败', message);
  } finally {
    pathApplying.value = false;
  }
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
  <section class="cli-card">
    <div class="cli-card-header">
      <div class="header-left">
        <span class="status-dot active" v-tooltip.top="'保存设置后自动导出可用图床'" />
        <div class="header-info">
          <span class="card-title">CLI</span>
          <span class="card-description">命令行显式指定图床上传</span>
        </div>
      </div>
    </div>

    <div class="guide-card">
      <div class="path-manager">
        <div class="path-manager-info">
          <span class="path-manager-title">终端快捷命令</span>
          <span class="path-manager-desc">{{ pathStatusText }}</span>
          <span v-if="pathStatus?.needsTerminalRestart" class="restart-hint">
            请重新打开终端后使用 <code class="inline-code">picnexus</code>
          </span>
        </div>
        <Button
          :label="pathActionLabel"
          :icon="pathActionIcon"
          size="small"
          outlined
          :disabled="pathLoading || pathApplying || !pathStatus?.supported"
          @click="togglePathStatus"
        />
      </div>

      <div class="guide-step">
        <span class="step-badge">1</span>
        <span class="step-text">在设置页配置图床并保存，PicNexus 会自动导出所有 CLI 可用图床。</span>
      </div>
      <div class="guide-step">
        <span class="step-badge">2</span>
        <span class="step-text">命令行使用 <code class="inline-code">--service &lt;图床名&gt;</code> 指定目标图床，例如 <code class="inline-code">r2</code>、<code class="inline-code">smms</code>、<code class="inline-code">github</code>。</span>
      </div>
      <div class="guide-step">
        <span class="step-badge">3</span>
        <span class="step-text">
          PATH 命令：
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
          完整路径命令：
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
  </section>
</template>

<style>
@import url('../../../styles/editor-card.css');
</style>

<style scoped>
@import url('../../../styles/settings-shared.css');

.cli-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--settings-card-radius, var(--radius-lg));
  overflow: hidden;
  transition: border-color var(--duration-normal) ease;
}

.cli-card:hover {
  border-color: var(--primary);
}

.cli-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md) var(--space-lg);
}

.path-manager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
  background: var(--bg-input);
}

.path-manager-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.path-manager-title {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

.path-manager-desc,
.restart-hint {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  line-height: 1.5;
}

.path-manager-desc {
  white-space: pre-line;
}

.restart-hint {
  color: var(--warning);
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
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--primary);
}

@media (width <= 760px) {
  .path-manager {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
