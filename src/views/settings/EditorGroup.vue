<script setup lang="ts">
// 编辑器与命令行（S04）：Typora、Obsidian、命令行三张卡。
// Typora 不放「打开 Typora」（应用拿不到 Typora 的安装位置）；命令行在命令里用 --service 指定图床，没有「上传到」菜单。
import { computed, onActivated, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuItem from '@/components/pn/PnMenuItem.vue';
import PnMenuRadioGroup from '@/components/pn/PnMenuRadioGroup.vue';
import PnMenuSeparator from '@/components/pn/PnMenuSeparator.vue';
import EditorCard, { type EditorStatus } from './EditorCard.vue';
import PortDialog from './PortDialog.vue';
import { cliView } from './cliCard';
import SettingsSection from './SettingsSection.vue';
import { quotePath, useEditorCards } from './useEditorCards';

const cards = useEditorCards();
const router = useRouter();
const NONE = '';

onMounted(() => { void cards.load(); });
onActivated(() => { void cards.load(); });

const editor = cards.editor;
const exe = computed(() => quotePath(cards.executablePath.value || 'picnexus'));
const hostOptions = computed(() => [...cards.hosts.value.map((h) => ({ value: h.id, label: h.name })), { value: NONE, label: '不使用' }]);

// ---- Typora ----
const typoraStatus = computed<EditorStatus>(() => (editor.value.typoraService
  ? { text: '已配置', tone: 'normal' }
  : { text: '尚未配置', tone: 'muted' }));

// ---- Obsidian ----
const OBSIDIAN_STATUS: Record<string, EditorStatus> = {
  off: { text: '尚未配置', tone: 'muted' },
  checking: { text: '检测中…', tone: 'muted' },
  notPicnexus: { text: '该端口运行的不是 PicNexus 服务，请更换端口', tone: 'warning' },
  down: { text: '服务未启动，请检查端口后点「测试连接」', tone: 'warning' },
};
const portOpen = ref(false);

const obsidianStatus = computed<EditorStatus>(() => {
  const state = cards.obsidian.value;
  if (state === 'ok') return { text: `已连接 · 端口 ${editor.value.port}`, tone: 'normal' };
  if (state === 'portBusy') return { text: `端口 ${editor.value.port} 已被占用，请更换端口`, tone: 'warning' };
  return OBSIDIAN_STATUS[state];
});

// ---- 命令行 ----
const cli = computed(() => cliView(cards.cliPath.value, editor.value.cliEnabled === true));
const cliAction = computed(() => ({ label: cli.value.label, busy: cards.cliBusy.value }));
const cliExample = computed(() => {
  const service = cards.hosts.value[0]?.id ?? 'jd';
  const command = cards.cliPath.value?.inPath ? 'picnexus' : exe.value;
  return `${command} --service ${service} ./a.png`;
});
</script>

<template>
  <SettingsSection title="接入方式" note="从编辑器上传的图片同样记入图库，链接格式跟随「上传与链接」。">
    <div class="editors">
      <EditorCard
        row-id="typora"
        mark="Ty"
        name="Typora"
        :status="typoraStatus"
        label="在 Typora › 偏好设置 › 图像 › 上传服务 中选择「Custom Command」，填入："
        :code="`${exe} --profile typora`"
      >
        上传到
        <PnMenu align="start" :width="220">
          <template #trigger>
            <button type="button" class="editors__picker" aria-label="Typora 上传到">
              {{ cards.hostName(editor.typoraService) ?? '不使用' }}<PnIcon class="editors__chev" name="chevronDown" :size="12" :stroke="1.8" />
            </button>
          </template>
          <PnMenuRadioGroup :model-value="editor.typoraService ?? NONE" :options="hostOptions" @update:model-value="(v) => cards.setTypora(v || null)" />
          <template v-if="!cards.hosts.value.length">
            <PnMenuSeparator />
            <PnMenuItem @select="router.push('/hosts')">去图床页添加…</PnMenuItem>
          </template>
        </PnMenu>
      </EditorCard>

      <EditorCard
        row-id="obsidian"
        mark="Ob"
        name="Obsidian"
        :status="obsidianStatus"
        :action="editor.enabled ? { label: '测试连接', busy: cards.obsidian.value === 'checking', busyLabel: '检测中…' } : null"
        label="安装 PicNexus 插件，在插件设置的「端口」中填入："
        :code="String(editor.port)"
        @action="cards.testObsidian"
      >
        上传到
        <PnMenu align="start" :width="220">
          <template #trigger>
            <button type="button" class="editors__picker" aria-label="Obsidian 上传到">
              {{ editor.enabled ? cards.hostName(editor.obsidianService) ?? '未选择' : '不使用' }}<PnIcon class="editors__chev" name="chevronDown" :size="12" :stroke="1.8" />
            </button>
          </template>
          <PnMenuRadioGroup :model-value="editor.enabled ? editor.obsidianService ?? NONE : NONE" :options="hostOptions" @update:model-value="(v) => cards.setObsidian(v || null)" />
          <template v-if="!cards.hosts.value.length">
            <PnMenuSeparator />
            <PnMenuItem @select="router.push('/hosts')">去图床页添加…</PnMenuItem>
          </template>
        </PnMenu>
        <span class="editors__spacer" />
        <PnButton variant="ghost" size="sm" class="editors__port" @click="portOpen = true">更换端口…</PnButton>
      </EditorCard>

      <EditorCard
        row-id="cli"
        mark=">_"
        name="命令行 CLI"
        :status="cli.status"
        :action="cliAction"
        label="在终端中使用，例如："
        :code="cliExample"
        @action="cards.setCli(cli.turnOn)"
      >
        在命令中用 --service 指定图床
      </EditorCard>
    </div>
    <PortDialog v-model:open="portOpen" :port="editor.port" @change="cards.setPort" />
  </SettingsSection>
</template>

<style scoped>
.editors {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-12);
}

.editors__picker {
  display: flex;
  align-items: center;
  gap: var(--pn-space-4);
  height: var(--pn-size-settings-picker);
  padding: 0 var(--pn-space-6);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-footnote);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 透明底的菜单触发器：悬停 / 按下照文字按钮的两级 */
.editors__picker:hover { background: var(--pn-ghost-hover); }
.editors__picker:active { background: var(--pn-ghost-press); }
.editors__chev { color: var(--pn-text3); }

.editors__spacer { flex: 1; }

.editors__port {
  height: var(--pn-size-settings-picker);
  padding: 0 var(--pn-space-6);
  color: var(--pn-text2);
}
</style>
