<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import { useToast } from '../../../composables/useToast';

interface Props {
  executablePath?: string;
}

const props = defineProps<Props>();
const toast = useToast();
const commandCopied = ref(false);

const cliCommand = computed(() => {
  const executable = props.executablePath || 'picnexus';
  const quoted = /\s/.test(executable) ? `"${executable}"` : executable;
  return `${quoted} --service r2 image.png`;
});

async function copyCliCommand() {
  try {
    await navigator.clipboard.writeText(cliCommand.value);
    commandCopied.value = true;
    setTimeout(() => { commandCopied.value = false; }, 2000);
  } catch (_e) {
    toast.error('复制失败', '请手动选中命令复制');
  }
}
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
          示例命令：
          <div class="guide-path-inline">
            <div class="exec-path-row">
              <code class="exec-path-text" v-tooltip.top="cliCommand">{{ cliCommand }}</code>
              <Button
                :icon="commandCopied ? 'pi pi-check' : 'pi pi-copy'"
                text
                size="small"
                v-tooltip.top="commandCopied ? '已复制！' : '复制命令'"
                @click="copyCliCommand"
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
</style>
