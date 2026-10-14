<script setup lang="ts">
import { inject, onActivated, onDeactivated, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { useHistoryManager } from '@/composables/history/useHistory';
import type { BulkDeleteConfirmCopy } from '@/composables/history/useHistoryResultOps';
import { useLinkCheckManager } from '@/composables/link-check/useLinkCheck';
import type { ImageEntry } from '@/composables/link-check/imageHealth';
import { useConfigManager } from '@/composables/useConfig';
import { useToast } from '@/composables/useToast';
import type { LinkCheckRow } from '@/types/linkCheck';
import BatchMigratePanel from './link-check/BatchMigratePanel.vue';
import HistoryCheckPanel, { type PrimaryChange } from './link-check/HistoryCheckPanel.vue';
import MdRescueInline from './link-check/MdRescueInline.vue';
import { exportTextFile } from '@/utils/userFiles';
import { historyDB } from '@/services/database';
import { emitHistoryUpdated } from '@/events/cacheEvents';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { createLogger } from '@/utils/logger';
import { getErrorMessage } from '@/types/errors';

const log = createLogger('LinkCheckView');

const toast = useToast();
const configManager = useConfigManager();

type LinkCheckTab = 'monitor' | 'rescue' | 'migrate';

const activeTab = ref<LinkCheckTab>('monitor');
const linkCheckTargetTab = inject<Ref<string | null>>('linkCheckTargetTab');

function applyTargetTab(): void {
  if (!linkCheckTargetTab?.value) return;

  if (
    linkCheckTargetTab.value === 'rescue'
    || linkCheckTargetTab.value === 'monitor'
    || linkCheckTargetTab.value === 'migrate'
  ) {
    activeTab.value = linkCheckTargetTab.value;
  }

  linkCheckTargetTab.value = null;
}

if (linkCheckTargetTab) {
  watch(linkCheckTargetTab, (value) => {
    if (value) applyTargetTab();
  });
}

const {
  isChecking,
  isPaused,
  isLoading,
  isPhase2Loading,
  loadError,
  progress,
  progressSource,
  checkRows,
  loadHistoryRows,
  checkAllHistoryLinks,
  checkSubset,
  recheckSingle,
  cancelCheck,
  pauseCheck,
  resumeCheck,
  exportCsv,
  removeRowsByKeys,
  setFadingOutRows,
  setPrimaryServices,
  onViewActivated,
  onViewDeactivated,
} = useLinkCheckManager();

const { bulkDeleteHistoryResults } = useHistoryManager();

/** 改用备份 / 移除记录进行中：期间锁住会改数据的按钮，免得同一批记录被并发改写 */
const isActing = ref(false);

const nameOf = (serviceId: string) => getServiceDisplayName(serviceId, configManager.config.value);

async function handleExportCsv(rows: LinkCheckRow[]): Promise<void> {
  if (rows.length === 0) return;
  const path = await exportTextFile(`link-check-${Date.now()}.csv`, [{ name: 'CSV', extensions: ['csv'] }], exportCsv(rows));
  if (!path) return;
  toast.success('导出成功', `已保存至 ${path}`);
}

/** 重查一张图：它的每一份链接各查一次，行上的动画由检测引擎驱动 */
async function handleRecheckImage(rows: LinkCheckRow[]): Promise<void> {
  await Promise.all(rows.map((row) => recheckSingle(row)));
}

/**
 * 主链接打不开 → 改用能打开的备份（单张，或结论卡上的「把 N 张改用备份」）
 *
 * 不弹确认：随时能在浏览页改回来，而且什么都不删。逐张切换，一张失败不拖累其余，最后如实报数。
 */
async function handlePromote(changes: PrimaryChange[]): Promise<void> {
  if (changes.length === 0 || isActing.value) return;
  isActing.value = true;
  const done = new Map<string, string>();
  let firstError = '';
  try {
    for (const change of changes) {
      try {
        await historyDB.switchPrimaryService(change.historyId, change.serviceId);
        done.set(change.historyId, change.serviceId);
      } catch (error) {
        if (!firstError) firstError = getErrorMessage(error);
        log.error('切换主链接失败', { historyId: change.historyId, error });
      }
    }
    setPrimaryServices(done);
    if (done.size > 0) {
      await emitHistoryUpdated([...done.keys()]).catch((e) => log.warn('history-updated 事件发送失败', e));
    }
  } finally {
    isActing.value = false;
  }

  const failed = changes.length - done.size;
  if (done.size === 0) {
    toast.error('没改成', firstError);
    return;
  }
  const summary = changes.length === 1
    ? `已改用 ${nameOf(changes[0].serviceId)}`
    : `已把 ${done.size} 张图改用备份`;
  if (failed > 0) {
    toast.warn(`${summary}，${failed} 张没改成`, firstError);
  } else {
    toast.success(summary, '以后复制、插入的都是能打开的那份；文档里的旧链接可以到「文档修复」换掉');
  }
}

type RemoveScope = { kind: 'image'; entry: ImageEntry } | { kind: 'lost'; images: number };

/** 确认框按图片说话：「移除 N 条链接」对用户没有意义 */
function removeCopy(rows: LinkCheckRow[], scope: RemoveScope): BulkDeleteConfirmCopy {
  if (scope.kind === 'lost') {
    return {
      header: `清理 ${scope.images} 张找不回的图片？`,
      message: '这些图片在每个图床上都已经不存在了，留着记录也打不开。只会从 PicNexus 的记录里移除，移除后无法撤销。',
      acceptLabel: `清理 ${scope.images} 张`,
    };
  }
  const { entry } = scope;
  if (rows.length === entry.rows.length) {
    return {
      header: '从记录中移除这张图？',
      message: `「${entry.fileName}」的链接都打不开了。只会从 PicNexus 的记录里移除，图床上的文件不受影响；移除后无法撤销。`,
      acceptLabel: '移除',
    };
  }
  // 这张图还有能打开的一份：文档里写的多半是这条旧链接，「文档修复」靠它在记录里找到备份，所以要提醒
  const these = rows.length === 1 ? '这条' : '这些';
  return {
    header: `移除 ${rows.length} 个失效的链接？`,
    message: `「${entry.fileName}」在 ${rows.map((r) => nameOf(r.serviceId)).join('、')} 上的链接已经打不开，能打开的会保留。文档里如果还用着${these}旧链接，移除后「文档修复」就换不了它了，建议先修文档。图床上的文件不受影响，移除后无法撤销。`,
    acceptLabel: '移除',
  };
}

async function handleRemoveLinks(rows: LinkCheckRow[], scope: RemoveScope): Promise<void> {
  if (rows.length === 0 || isActing.value) return;
  isActing.value = true;
  try {
    const report = await bulkDeleteHistoryResults(
      rows.map((r) => ({ historyId: r.historyId, serviceId: r.serviceId })),
      removeCopy(rows, scope),
    );
    if (!report) return;

    // 只移除已处理完毕的行（真删除 + 目标本就不存在）；失败的记录保留供重试（toast 已提示）
    const resolved = new Set(report.resolvedHistoryIds);
    const removedRows = rows.filter((r) => resolved.has(r.historyId));
    if (removedRows.length > 0) {
      setFadingOutRows(removedRows, true);
      await new Promise((resolve) => setTimeout(resolve, 380));
      removeRowsByKeys(removedRows);
    }
  } finally {
    isActing.value = false;
  }
}

onMounted(() => {
  void loadHistoryRows();
});

onActivated(() => {
  onViewActivated();
  applyTargetTab();
});

onDeactivated(onViewDeactivated);
</script>

<template>
  <div class="link-check-view">
    <div class="lc-tab-bar">
      <button class="lc-tab" :class="{ active: activeTab === 'monitor' }" @click="activeTab = 'monitor'">
        <i class="pi pi-link"></i>
        链接检测
      </button>
      <button class="lc-tab" :class="{ active: activeTab === 'rescue' }" @click="activeTab = 'rescue'">
        <i class="pi pi-eraser"></i>
        文档修复
      </button>
      <button class="lc-tab" :class="{ active: activeTab === 'migrate' }" @click="activeTab = 'migrate'">
        <i class="pi pi-clone"></i>
        补充备份
      </button>
    </div>

    <KeepAlive>
      <HistoryCheckPanel
        v-if="activeTab === 'monitor'"
        key="monitor"
        :check-rows="checkRows"
        :is-checking="isChecking"
        :is-paused="isPaused"
        :is-loading="isLoading"
        :load-error="loadError"
        :is-phase2-loading="isPhase2Loading"
        :progress="progress"
        :progress-source="progressSource"
        :is-action-locked="isActing"
        @check-all="checkAllHistoryLinks"
        @check-subset="(filter) => checkSubset(filter)"
        @cancel-check="cancelCheck"
        @pause-check="pauseCheck"
        @resume-check="resumeCheck"
        @recheck-image="handleRecheckImage"
        @promote="handlePromote"
        @remove-links="handleRemoveLinks"
        @export-csv="handleExportCsv"
        @navigate="(tab) => { activeTab = tab; }"
        @retry="loadHistoryRows"
      />

      <MdRescueInline v-else-if="activeTab === 'rescue'" key="rescue" />
      <BatchMigratePanel v-else-if="activeTab === 'migrate'" key="migrate" />
    </KeepAlive>
  </div>
</template>

<style scoped>
.link-check-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-app);
}

.lc-tab-bar {
  display: flex;
  gap: var(--space-2xs);
  height: 48px;
  padding: 0 var(--space-md);
  align-items: stretch;
  background-color: var(--bg-card);
  border-bottom: 1px solid var(--border-subtle);
  z-index: 10;
  flex-shrink: 0;
}

.lc-tab {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  padding: 0 var(--space-md-lg);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
  position: relative;
  transition: color var(--duration-fast), background var(--duration-fast);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  font-family: inherit;
}

.lc-tab i {
  font-size: var(--text-base);
}

.lc-tab:hover {
  color: var(--text-primary);
  background: var(--hover-overlay);
}

.lc-tab.active {
  color: var(--primary);
}

.lc-tab.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 8px;
  right: 8px;
  height: 2px;
  background: var(--primary);
  border-radius: var(--radius-xs) var(--radius-xs) 0 0;
}
</style>
