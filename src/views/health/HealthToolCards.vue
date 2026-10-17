<script setup lang="ts">
// 三张工具卡（HealthScreen.dc.html，交接说明 8.3）：文档修复、补充备份、第三张（有问题时「找不回的图片」，否则「自动检测」）。
// 3 列等宽；窄窗口去插画、按钮移到说明下方（ToolCard 负责）。
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import ToolCard from '@/components/biz/ToolCard.vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuRadioGroup from '@/components/pn/PnMenuRadioGroup.vue';
import { useUploadController } from '@/composables/upload/useUploadController';
import { joinCjk as cat } from '@/utils/cjkSpacing';
import { formatCalendarDate, formatCount } from '@/utils/formatters';
import { AUTO_CHECK_OPTIONS, nextCheckAt, useAutoCheckSetting } from './autoCheck';
import type { DocProblem } from './docIndex';
import { minutesText } from './healthModel';
import { useDocFolders } from './useDocFolders';
import { repairState, useLinkHealth } from './useLinkHealth';
import { useSupplementBackup } from './useSupplementBackup';

const props = defineProps<{
  narrow: boolean;
  docProblems: readonly DocProblem[];
  docCount: number;
}>();

const emit = defineEmits<{ openRepair: []; openBackup: []; showLost: [] }>();

const router = useRouter();
const health = useLinkHealth();
const docFolders = useDocFolders();
const backup = useSupplementBackup();
const autoCheck = useAutoCheckSetting();
const upload = useUploadController();

const summary = health.summary;
const state = health.state;

// ---- 文档修复 ----

const folderPaths = computed(() => health.config.value.linkHealth?.docFolders ?? []);

const docCard = computed(() => {
  const problems = props.docProblems;
  const dead = problems.reduce((n, p) => n + p.dead, 0);
  const fixable = problems.reduce((n, p) => n + p.fixable, 0);
  if (folderPaths.value.length === 0) return { num: '', desc: '添加文档文件夹，失效图片可在文档中一键替换', button: '添加文件夹…' };
  if (state.value === 'fixing') return { num: `${formatCount(repairState.docCount || problems.length)} 个文档`, desc: '正在更新，修改前已自动备份原文件', button: '' };
  if (repairState.lastDocs) {
    return { num: `${formatCount(repairState.lastDocs.docs)} 个文档已更新`, desc: `共替换 ${formatCount(repairState.lastDocs.places)} 处旧链接，可撤销`, button: '查看…' };
  }
  if (!docFolders.scanned.value) return { num: '', desc: '正在读取文档文件夹', button: '管理文件夹…' };
  if (problems.length) {
    return {
      num: `${formatCount(problems.length)} 个文档`,
      desc: fixable ? `${formatCount(fixable)} 处失效图片可替换为备份` : `${formatCount(dead)} 处失效图片，均无可用备份`,
      button: '修复文档…',
    };
  }
  const first = folderPaths.value[0];
  const where = folderPaths.value.length > 1 ? `${first} 等 ${folderPaths.value.length} 个文件夹` : first;
  return { num: `${formatCount(props.docCount)} 个文档`, desc: `均无失效图片 · ${where}`, button: '管理文件夹…' };
});

function onDocAction(): void {
  if (folderPaths.value.length === 0) void docFolders.add();
  else emit('openRepair');
}

// ---- 补充备份 ----

const usableHosts = computed(() => upload.hosts.value.filter((h) => !h.warning));
const targetName = computed(() => health.hostName(backup.state.target));

const backupCard = computed(() => {
  const s = backup.state;
  const progressNum = `${formatCount(s.processed)} / ${formatCount(s.total)}`;
  const progress = s.total ? s.processed / s.total : 0;
  if (s.phase === 'running') {
    return { num: progressNum, desc: cat('正在复制到', targetName.value, ` · 剩余约 ${minutesText(backup.remainingSeconds.value)}`), button: '暂停', progress };
  }
  if (s.phase === 'paused') return { num: progressNum, desc: cat('已暂停 · 复制到', targetName.value), button: '继续', progress };
  const single = summary.value.singleCopy;
  if (s.phase === 'done' && s.failed.length) return { num: '已完成', desc: `${formatCount(s.failed.length)} 张未能备份`, button: '重试' };
  // 刚备份完、没有「仅 1 份」的了才说「每张至少 2 个图床」；还剩（那 1 份就在目标图床上）照平常的样子
  if (s.phase === 'done' && single === 0) return { num: '已完成', desc: '每张图片至少保存在 2 个图床', button: '' };
  if (single === 0) return { num: '', desc: '每张图片至少保存在 2 个图床', button: '' };
  if (usableHosts.value.length < 2) return { num: `${formatCount(single)} 张`, desc: '需要另一个图床，当前只有 1 个可用图床', button: '添加图床' };
  return { num: `${formatCount(single)} 张`, desc: '仅保存在 1 个图床，图床失效后无法恢复', button: '补充备份…' };
});

function onBackupAction(): void {
  const s = backup.state;
  if (s.phase === 'running') backup.pause();
  else if (s.phase === 'paused') backup.resume();
  else if (s.phase === 'done' && s.failed.length) void backup.retryFailed();
  else if (backupCard.value.button === '添加图床') void router.push('/hosts');
  else emit('openBackup');
}

// ---- 第三张 ----

const showLost = computed(() => summary.value.dead > 0 && state.value !== 'never' && state.value !== 'loading');
const nextCheck = computed(() => nextCheckAt(autoCheck.settings.value, summary.value.lastCheckedAt));
const autoMenuModel = computed({ get: () => autoCheck.value.value, set: (v: string) => { void autoCheck.set(v); } });

function turnOnAuto(): void {
  if (!autoCheck.settings.value.enabled) void autoCheck.set(String(autoCheck.settings.value.intervalDays));
  // 从没检测过：「开启」= 立即开始第一次检测，之后按间隔自动检测
  if (!summary.value.everChecked) void health.check();
}
</script>

<template>
  <div class="health-cards">
    <ToolCard title="文档修复" art="doc" :num="docCard.num" :desc="docCard.desc" :narrow="narrow">
      <template v-if="docCard.button" #action>
        <PnButton size="sm" @click="onDocAction">{{ docCard.button }}</PnButton>
      </template>
    </ToolCard>

    <ToolCard title="补充备份" art="backup" :num="backupCard.num" :desc="backupCard.desc" :progress="backupCard.progress" :narrow="narrow">
      <template v-if="backupCard.button" #action>
        <PnButton size="sm" @click="onBackupAction">{{ backupCard.button }}</PnButton>
      </template>
    </ToolCard>

    <ToolCard
      v-if="showLost"
      title="找不回的图片"
      art="lost"
      :num="`${formatCount(summary.unfixable)} 张`"
      num-tone="warning"
      desc="所有副本均已失效，可重新上传原图"
      :narrow="narrow"
    >
      <template v-if="summary.unfixable > 0" #action>
        <PnButton size="sm" @click="emit('showLost')">查看</PnButton>
      </template>
    </ToolCard>
    <ToolCard
      v-else-if="autoCheck.settings.value.enabled && summary.everChecked"
      title="自动检测"
      art="auto"
      :num="autoCheck.label.value"
      :desc="nextCheck ? `下次检测：${formatCalendarDate(Math.max(nextCheck, Date.now()))}` : ''"
      :narrow="narrow"
    >
      <template #action>
        <PnMenu :width="160" align="end">
          <template #trigger>
            <PnButton size="sm" aria-haspopup="menu">更改</PnButton>
          </template>
          <PnMenuRadioGroup v-model="autoMenuModel" :options="AUTO_CHECK_OPTIONS" />
        </PnMenu>
      </template>
    </ToolCard>
    <ToolCard
      v-else
      title="自动检测"
      art="auto"
      :desc="`${autoCheck.settings.value.intervalDays === 1 ? '每天' : `每 ${autoCheck.settings.value.intervalDays} 天`}在后台检测，发现失效时在侧栏提示`"
      :narrow="narrow"
    >
      <template #action>
        <PnButton size="sm" :disabled="summary.total === 0" @click="turnOnAuto">开启</PnButton>
      </template>
    </ToolCard>
  </div>
</template>

<style scoped>
.health-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--pn-space-12);
}
</style>
