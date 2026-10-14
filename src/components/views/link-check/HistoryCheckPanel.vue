<script setup lang="ts">
/**
 * 链接检测面板：顶部结论卡（现在怎么样 + 该点哪个）→ 工具条 → 一张图一行的列表
 *
 * 没检查过时只剩居中的结论卡和一个「开始检查」；有结果后卡片收到顶部，下面列出有问题的图。
 * 删记录、批量改用备份这类动作只往上发事件，由 LinkCheckView 落库。
 */
import { computed, ref } from 'vue';
import Menu from 'primevue/menu';
import type { MenuItem } from 'primevue/menuitem';
import { useConfigManager } from '@/composables/useConfig';
import { useCopyBadgeFeedback } from '@/composables/useCopyBadgeFeedback';
import { useToast } from '@/composables/useToast';
import SummaryCard from './common/SummaryCard.vue';
import CheckToolbar from './history-check/CheckToolbar.vue';
import CheckImageList, { type ListEmptyState } from './history-check/CheckImageList.vue';
import LinkCheckSkeleton from './history-check/LinkCheckSkeleton.vue';
import { buildCheckVerdict, type CheckVerdict, type VerdictAction } from '@/composables/link-check/checkVerdict';
import { isLostForGood, promoteTarget, type ImageEntry, type ImageKind } from '@/composables/link-check/imageHealth';
import { PROBLEM_KINDS, useImageList } from '@/composables/link-check/useImageList';
import { useProgressPace } from '@/composables/link-check/useProgressPace';
import { thumbnailCopyOrder } from '@/composables/link-check/rowCopies';
import { getCopiesThumbnailCandidates } from '@/composables/image/useThumbCache';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { getConfirmedHttpHosts } from '@/security/networkPolicy';
import { applyZhihuSourceFromConfig } from '@/utils/zhihuSource';
import type { BatchCheckProgress, LinkCheckRow } from '@/types/linkCheck';

export interface PrimaryChange {
  historyId: string;
  serviceId: string;
}

const props = defineProps<{
  checkRows: LinkCheckRow[];
  isChecking: boolean;
  isPaused: boolean;
  isLoading: boolean;
  loadError?: string | null;
  isPhase2Loading: boolean;
  progress: BatchCheckProgress | null;
  progressSource: 'monitor' | 'rescue' | null;
  isActionLocked: boolean;
}>();

const emit = defineEmits<{
  'check-all': [];
  'check-subset': [filter: { statusFilter?: 'unchecked'; historyIds?: string[] }];
  'cancel-check': [];
  'pause-check': [];
  'resume-check': [];
  'recheck-image': [rows: LinkCheckRow[]];
  promote: [changes: PrimaryChange[]];
  'remove-links': [rows: LinkCheckRow[], scope: { kind: 'image'; entry: ImageEntry } | { kind: 'lost'; images: number }];
  'export-csv': [rows: LinkCheckRow[]];
  navigate: [tab: 'rescue' | 'migrate'];
  retry: [];
}>();

const configManager = useConfigManager();
const toast = useToast();
const { copiedKey, markCopied } = useCopyBadgeFeedback();

/** 文档修复也借这套检测引擎跑：那时的进度不归这里显示 */
const isMonitorChecking = computed(() => props.isChecking && props.progressSource !== 'rescue');

const checkRows = computed(() => props.checkRows);
const {
  view, serviceId, searchInput, searchQuery, page,
  entries, summary, kindOf, scoped, problemCount, listed, totalPages, visible, serviceList,
} = useImageList({ checkRows, isChecking: isMonitorChecking });

const showServiceMenu = ref(false);

const monitorProgress = computed(() => (isMonitorChecking.value ? props.progress : null));
const { etaSeconds, stalled } = useProgressPace(monitorProgress);

type CardAction = VerdictAction | 'retry';

/** 一行都没读出来又报错时，卡片如实说读取失败，而不是「还没有图片」 */
const verdict = computed<Omit<CheckVerdict, 'primary'> & { primary: { action: CardAction; label: string } | null }>(() => {
  if (props.loadError && entries.value.length === 0) {
    return {
      tone: 'error', hero: true, title: '没读出检查记录', subtitle: props.loadError,
      primary: { action: 'retry', label: '重试' }, secondary: null, hint: null,
    };
  }
  return buildCheckVerdict({
    summary: summary.value,
    running: isMonitorChecking.value
      ? {
        done: props.progress?.checked ?? 0,
        total: props.progress?.total ?? 0,
        paused: props.isPaused,
        etaSeconds: etaSeconds.value,
        stalled: stalled.value,
      }
      : null,
    loadingRest: props.isPhase2Loading,
  });
});

const progressPercent = computed(() => {
  if (!isMonitorChecking.value || !props.progress?.total) return null;
  return (props.progress.checked / props.progress.total) * 100;
});

const nameOf = (id: string) => getServiceDisplayName(id, configManager.config.value);
const confirmedHttpHosts = computed(() => getConfirmedHttpHosts(configManager.config.value));

function thumbSrcsOf(entry: ImageEntry): string[] {
  const [first, ...rest] = entry.rows;
  if (!first) return [];
  return getCopiesThumbnailCandidates(
    thumbnailCopyOrder(first, rest).map((r) => ({ serviceId: r.serviceId, url: r.rawUrl, fileKey: r.fileKey })),
    configManager.config.value,
  );
}

const sectionCounts = computed(() => {
  const counts: Record<ImageKind, number> = { fixable: 0, broken: 0, limited: 0, 'backup-broken': 0, unchecked: 0, ok: 0 };
  for (const entry of scoped.value) counts[kindOf(entry)]++;
  return counts;
});

const hasFilter = computed(() => !!serviceId.value || searchQuery.value.length > 0);

const emptyState = computed<ListEmptyState | null>(() => {
  if (hasFilter.value) {
    return { icon: 'pi pi-search', title: '没有找到相关图片', description: '换个关键词，或者看看全部图床', actionLabel: '清除筛选' };
  }
  if (view.value === 'problems') {
    if (isMonitorChecking.value) return { icon: 'pi pi-search', title: '还没发现打不开的图片', description: '查出来的问题会陆续列在这里' };
    return { icon: 'pi pi-check-circle', title: '没有发现问题', actionLabel: `查看全部 ${scoped.value.length.toLocaleString()} 张图片` };
  }
  return null;
});

function handleEmptyAction(): void {
  if (hasFilter.value) {
    searchInput.value = '';
    searchQuery.value = '';
    serviceId.value = null;
    return;
  }
  view.value = 'all';
}

// ---- 结论卡的按钮 ----

function promoteChanges(list: readonly ImageEntry[]): PrimaryChange[] {
  const changes: PrimaryChange[] = [];
  for (const entry of list) {
    const target = promoteTarget(entry);
    if (target) changes.push({ historyId: entry.historyId, serviceId: target.serviceId });
  }
  return changes;
}

function runAction(action: CardAction): void {
  switch (action) {
    case 'retry': emit('retry'); break;
    case 'check-all': emit('check-all'); break;
    case 'check-unchecked': emit('check-subset', { statusFilter: 'unchecked' }); break;
    case 'promote-all': emit('promote', promoteChanges(entries.value.filter((e) => kindOf(e) === 'fixable'))); break;
    case 'pause': emit('pause-check'); break;
    case 'resume': emit('resume-check'); break;
    case 'cancel': emit('cancel-check'); break;
  }
}

const cardMenuRef = ref<InstanceType<typeof Menu> | null>(null);

const problemEntries = computed(() => entries.value.filter((e) => PROBLEM_KINDS.has(kindOf(e))));
const lostEntries = computed(() => entries.value.filter((e) => isLostForGood(e)));

const cardMenuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = [];
  if (problemEntries.value.length > 0) {
    items.push({
      label: `只重查有问题的 ${problemEntries.value.length.toLocaleString()} 张`,
      icon: 'pi pi-refresh',
      disabled: props.isActionLocked,
      command: () => emit('check-subset', { historyIds: problemEntries.value.map((e) => e.historyId) }),
    });
  }
  if (listed.value.length > 0) {
    items.push({
      label: '导出当前列表（CSV）',
      icon: 'pi pi-download',
      command: () => emit('export-csv', listed.value.flatMap((e) => e.rows)),
    });
  }
  if (lostEntries.value.length > 0) {
    items.push({ separator: true });
    items.push({
      label: `清理 ${lostEntries.value.length.toLocaleString()} 张找不回的图片`,
      icon: 'pi pi-trash',
      class: 'menu-item-danger',
      disabled: props.isActionLocked,
      command: () => emit('remove-links', lostEntries.value.flatMap((e) => e.rows), { kind: 'lost', images: lostEntries.value.length }),
    });
  }
  return items;
});

// ---- 行上的动作 ----

function handlePromoteOne(entry: ImageEntry, targetServiceId: string): void {
  emit('promote', [{ historyId: entry.historyId, serviceId: targetServiceId }]);
}

async function handleCopy(entry: ImageEntry): Promise<void> {
  const primary = entry.rows[0];
  if (!primary) return;
  try {
    await navigator.clipboard.writeText(applyZhihuSourceFromConfig(primary.url, configManager.config.value));
    markCopied(entry.historyId);
    toast.silent('log', '已复制到剪贴板');
  } catch (error) {
    toast.error('复制失败', error instanceof Error ? error.message : String(error));
  }
}
</script>

<template>
  <LinkCheckSkeleton v-if="isLoading && checkRows.length === 0 && !loadError" />

  <div v-else class="monitor-panel" :class="{ 'monitor-panel--hero': verdict.hero }" @click="showServiceMenu = false">
    <SummaryCard
      :tone="verdict.tone"
      :title="verdict.title"
      :subtitle="verdict.subtitle"
      :hero="verdict.hero"
      icon="pi pi-link"
      :progress="progressPercent"
    >
      <template v-if="verdict.hint" #extra>
        <p class="summary-hint">
          {{ verdict.hint.text }}
          <button type="button" class="hint-link" @click="emit('navigate', verdict.hint.kind === 'doc-repair' ? 'rescue' : 'migrate')">
            {{ verdict.hint.action }}
            <i class="pi pi-arrow-right" aria-hidden="true"></i>
          </button>
        </p>
      </template>
      <template v-if="verdict.primary || verdict.secondary || cardMenuItems.length > 0" #actions>
        <button
          v-if="verdict.secondary"
          type="button"
          class="summary-btn summary-btn--ghost"
          :disabled="isActionLocked && !isMonitorChecking"
          @click="runAction(verdict.secondary.action)"
        >
          {{ verdict.secondary.label }}
        </button>
        <button
          v-if="verdict.primary"
          type="button"
          class="summary-btn summary-btn--primary"
          :disabled="isActionLocked && !isMonitorChecking"
          @click="runAction(verdict.primary.action)"
        >
          {{ verdict.primary.label }}
        </button>
        <template v-if="!isMonitorChecking && !verdict.hero && cardMenuItems.length > 0">
          <button
            type="button"
            class="summary-btn summary-btn--icon"
            aria-label="更多操作"
            @click="cardMenuRef?.toggle($event)"
          >
            <i class="pi pi-ellipsis-h" aria-hidden="true"></i>
          </button>
          <Menu ref="cardMenuRef" :model="cardMenuItems" popup append-to="body" />
        </template>
      </template>
    </SummaryCard>

    <template v-if="!verdict.hero">
      <CheckToolbar
        v-model:view="view"
        v-model:service-id="serviceId"
        v-model:search-input="searchInput"
        v-model:show-service-menu="showServiceMenu"
        :problem-count="problemCount"
        :all-count="scoped.length"
        :service-list="serviceList"
      />

      <div class="monitor-list">
        <CheckImageList
          v-model:page="page"
          :entries="visible"
          :kind-of="kindOf"
          :sectioned="!isMonitorChecking"
          :section-counts="sectionCounts"
          :name-of="nameOf"
          :thumb-srcs-of="thumbSrcsOf"
          :is-checking="isMonitorChecking"
          :action-locked="isActionLocked"
          :copied-id="copiedKey"
          :empty-state="emptyState"
          :total-pages="totalPages"
          :confirmed-http-hosts="confirmedHttpHosts"
          @promote="handlePromoteOne"
          @recheck="(entry: ImageEntry) => emit('recheck-image', entry.rows)"
          @copy="handleCopy"
          @remove="(entry: ImageEntry, rows: LinkCheckRow[]) => emit('remove-links', rows, { kind: 'image', entry })"
          @empty-action="handleEmptyAction"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.monitor-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  height: 100%;
  padding: var(--space-lg-xl) var(--space-xl) 0;
  overflow: hidden;
}

.monitor-panel--hero {
  padding-bottom: var(--space-3xl);
}

.monitor-list {
  flex: 1;
  min-height: 0;
  margin: 0 calc(var(--space-xl) * -1);
  padding: 0 var(--space-xl) var(--space-lg-xl);
  overflow-y: auto;
}

.summary-hint {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-xs-sm);
  margin: var(--space-xs) 0 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.hint-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0;
  border: none;
  background: none;
  color: var(--primary);
  font-family: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}

.hint-link i {
  font-size: var(--text-2xs);
}

.hint-link:hover {
  text-decoration: underline;
}
</style>
