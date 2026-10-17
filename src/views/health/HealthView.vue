<script setup lang="ts">
// 链接健康（HealthScreen.dc.html，交接说明 8.3）：标题行 → 状态栏 → 上传日历 → 三张工具卡 → 全部失效图片。
// 没有二级页面；文档修复、补充备份是弹窗。这里只接线：数据与动作在 useLinkHealth / useHealthRepair / useHealthRowActions。
import { computed, onActivated, onDeactivated, ref, watch } from 'vue';
import { useElementSize } from '@vueuse/core';
import UploadCalendar from '@/components/biz/UploadCalendar.vue';
import YearPills from '@/components/biz/YearPills.vue';
import { useConfirmedHttpHosts } from '@/composables/image/useConfirmedHttpHosts';
import { useUploadController } from '@/composables/upload/useUploadController';
import TitleRow from '@/shell/TitleRow.vue';
import { formatCount, getDayKey } from '@/utils/formatters';
import { useAutoCheckSetting } from './autoCheck';
import BackupDialog, { type BackupTarget } from './BackupDialog.vue';
import { docProblems } from './docIndex';
import HealthDeadList, { type YearFilter } from './HealthDeadList.vue';
import HealthStatusBar from './HealthStatusBar.vue';
import HealthToolCards from './HealthToolCards.vue';
import { buildCalendar, countByDay, countByYear, defaultYear, yearPills } from './healthCalendar';
import { backupScope, deadGroups, fullDate, isDead, NO_FILTERS, type DeadFilters } from './healthModel';
import { statusText } from './healthStatus';
import RepairDialog from './RepairDialog.vue';
import { useDocFolders } from './useDocFolders';
import { useHealthRepair } from './useHealthRepair';
import { useHealthRowActions } from './useHealthRowActions';
import { repairState, useLinkHealth } from './useLinkHealth';
import { useSupplementBackup } from './useSupplementBackup';

const health = useLinkHealth();
const repair = useHealthRepair();
const docFolders = useDocFolders();
const backup = useSupplementBackup();
const autoCheck = useAutoCheckSetting();
const upload = useUploadController();
const actions = useHealthRowActions(() => repair.index.value);
const confirmedHttpHosts = useConfirmedHttpHosts(health.config);

const { images, summary, dead, state } = health;

/** 主栏宽度放不下整年 13px 的日历（约 990px）时整页切到窄版式（设计稿 K04 只画了 800×600） */
const NARROW_BELOW = 990;
const page = ref<HTMLElement | null>(null);
const { width } = useElementSize(page);
const narrow = computed(() => width.value > 0 && width.value < NARROW_BELOW);

// ---- 今天 ----
const now = ref(Date.now());
let midnight: ReturnType<typeof setTimeout> | undefined;
function refreshNow(): void {
  now.value = Date.now();
  clearTimeout(midnight);
  const next = new Date(now.value);
  next.setHours(24, 0, 1, 0);
  midnight = setTimeout(refreshNow, next.getTime() - now.value);
}

// ---- 日历 ----
const currentYear = computed(() => new Date(now.value).getFullYear());
const deadByYear = computed(() => countByYear(dead.value, (i) => i.uploadedAt));
const uploadsByYear = computed(() => countByYear(images.value, (i) => i.uploadedAt));
const pills = computed(() => yearPills(uploadsByYear.value.keys(), currentYear.value));
const year = ref<number | null>(null);
const shownYear = computed(() => year.value ?? currentYear.value);
const yearModel = computed({ get: () => shownYear.value, set: (y: number) => { year.value = y; } });
// 默认年份只在第一次读完数据时按规则选，之后保留用户的选择
watch(() => health.linkCheck.loaded.value && state.value !== 'loading', (ready) => {
  if (ready && year.value === null) year.value = defaultYear(deadByYear.value, currentYear.value);
}, { immediate: true });

const calendar = computed(() => buildCalendar(
  shownYear.value,
  countByDay(images.value, (i) => i.uploadedAt),
  countByDay(dead.value, (i) => i.uploadedAt),
  now.value,
));
const yearSummary = computed(() => {
  const ups = uploadsByYear.value.get(shownYear.value) ?? 0;
  const bad = deadByYear.value.get(shownYear.value) ?? 0;
  return `${shownYear.value} 年上传 ${formatCount(ups)} 张${bad ? ` · ${formatCount(bad)} 张失效` : ''}`;
});

// ---- 清单筛选 ----
const reason = ref('all');
const host = ref('all');
const listYear = ref<YearFilter>('all');
const day = ref<string | null>(null);
/** 「找不回的图片 → 查看」：只看无可用备份 */
const onlyUnfixable = ref(false);

function pickDay(key: string): void {
  day.value = day.value === key ? null : key;
}

const busy = computed(() => state.value === 'checking' || state.value === 'paused');
/** 筛选按钮藏起来（检测中、窄窗口）时，原因 / 图床 / 年份三个筛选也不生效：看不见的条件不该卡住清单 */
const showFilters = computed(() => !busy.value && !narrow.value);
const filters = computed<DeadFilters>(() => ({
  ...NO_FILTERS,
  ...(showFilters.value ? {
    reason: reason.value === 'all' ? null : reason.value as DeadFilters['reason'],
    host: host.value === 'all' ? null : host.value,
    year: listYear.value === 'all' ? null : listYear.value === 'sync' ? shownYear.value : listYear.value,
  } : {}),
  day: day.value,
}));
const pool = computed(() => images.value.filter((i) => i.state === 'fixable' || i.state === 'unfixable' || i.state === 'limited'));
const groups = computed(() => deadGroups(pool.value, filters.value, getDayKey).filter((g) => !onlyUnfixable.value || g.key === 'unfixable'));
const showList = computed(() => ['problems', 'checking', 'paused', 'fixing'].includes(state.value)
  && (summary.value.dead > 0 || (reason.value === 'limited' && summary.value.limited > 0)));
const listCount = computed(() => `${formatCount(groups.value.reduce((n, g) => n + g.images.length, 0))} 张`);
/** 日期标签由日期键直接算（不看眼前是哪一年的日历）：换了年份，标签照样在、照样能移除 */
const dayLabel = computed(() => {
  if (onlyUnfixable.value) return '无可用备份';
  if (!day.value) return null;
  const [y, m, d] = day.value.split('-').map(Number);
  return fullDate(new Date(y, m, d).getTime());
});

function clearChip(): void {
  if (onlyUnfixable.value) onlyUnfixable.value = false;
  else day.value = null;
}

const list = ref<InstanceType<typeof HealthDeadList> | null>(null);
function showLost(): void {
  reason.value = 'all';
  host.value = 'all';
  listYear.value = 'all';
  day.value = null;
  onlyUnfixable.value = true;
  (list.value?.$el as HTMLElement | undefined)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- 文档 ----
const problems = computed(() => docProblems(repair.index.value, images.value));
const hasFolders = computed(() => (health.config.value.linkHealth?.docFolders.length ?? 0) > 0);
function docsOf(id: string): number | null {
  if (!hasFolders.value || !docFolders.scanned.value) return null;
  return repair.index.value.docsByImage.get(id)?.size ?? 0;
}

function repairDocs(): void {
  void repair.repair([...new Set(repair.index.value.refs.map((r) => r.imageId))], 'docs');
}

// ---- 状态栏 ----
const status = computed(() => statusText({
  state: state.value,
  summary: summary.value,
  dead: dead.value,
  progress: health.progress.value,
  repair: repairState,
  hostName: health.hostName,
}));
const progress = computed(() => {
  if (state.value === 'fixing') return repairState.total ? repairState.done / repairState.total : 0;
  const p = health.progress.value;
  return p.total ? p.checked / p.total : 0;
});

// ---- 补充备份 ----
const repairOpen = ref(false);
const backupOpen = ref(false);
const backupTargets = computed<BackupTarget[]>(() => {
  const counts = new Map<string, number>();
  const holds = new Map<string, number>();
  for (const image of images.value) {
    for (const c of image.copies) {
      if (!isDead(c.status)) counts.set(c.host, (counts.get(c.host) ?? 0) + 1);
      // 「仅 1 份」的图在这个图床上已有一份（哪怕失效了）：补充备份不会再往这里传（记录里已有这个图床），算作「在它上面」
      if (image.singleCopy) holds.set(c.host, (holds.get(c.host) ?? 0) + 1);
    }
  }
  return upload.hosts.value.map((h) => ({
    id: h.id,
    name: h.name,
    count: counts.get(h.id) ?? 0,
    holds: holds.get(h.id) ?? 0,
    blocked: h.warning ? (h.cookieLogin ? '登录已过期，暂不可选' : '暂不可用，请在图床页检查配置') : null,
  }));
});

function startBackup(hostId: string): void {
  const ids = backupScope(images.value, hostId).map((i) => i.id);
  void backup.start(hostId, ids);
}

// 补充备份写了新的副本：检测行重读，「仅 1 份」跟着变
watch(() => backup.state.phase, (phase) => { if (phase === 'done' || phase === 'idle') void health.ensureLoaded({ force: true }); });

// ---- 进入 / 离开 ----
function enter(): void {
  refreshNow();
  void health.ensureLoaded();
  if (!repairState.running) void docFolders.scan();
}
// 页面在 KeepAlive 里：第一次挂载也会触发 onActivated，不另挂 onMounted（免得文档文件夹扫两遍）
onActivated(enter);
onDeactivated(() => {
  clearTimeout(midnight);
  health.linkCheck.onViewDeactivated();
});
</script>

<template>
  <div ref="page" class="health">
    <TitleRow title="链接健康" />
    <div class="health__scroll">
      <div class="health__top">
        <HealthStatusBar
          :state="state"
          :title="status.title"
          :sub="status.sub"
          :progress="progress"
          :total="summary.total"
          :dead="summary.dead"
          :fixable="summary.fixable"
          :lost="summary.lostForGood"
          :can-export="summary.everChecked"
          :auto-check-value="autoCheck.value.value"
          :auto-check-label="autoCheck.label.value"
          @start="health.check()"
          @reload="health.ensureLoaded({ force: true })"
          @recheck="health.check()"
          @recheck-dead="health.check('dead')"
          @repair="repair.repair(dead.filter((i) => i.state === 'fixable').map((i) => i.id))"
          @pause="health.pause()"
          @resume="health.resume()"
          @cancel="health.cancel()"
          @export="actions.exportResults()"
          @clean-lost="actions.cleanLost(images)"
          @auto-check="autoCheck.set"
        />
        <section class="health__calendar" :class="{ 'health__calendar--narrow': narrow }" aria-label="上传日历">
          <div class="health__calendar-head">
            <YearPills v-model="yearModel" :shown="pills.shown" :earlier="pills.earlier" :dead="deadByYear" :narrow="narrow" />
            <div class="health__spacer" />
            <span v-if="!narrow" class="health__year-summary">{{ yearSummary }}</span>
          </div>
          <UploadCalendar :calendar="calendar" :narrow="narrow" :picked="day" @pick="pickDay" />
        </section>
      </div>

      <HealthToolCards
        :narrow="narrow"
        :doc-problems="problems"
        :doc-count="repair.index.value.docCount"
        @open-repair="repairOpen = true"
        @open-backup="backupOpen = true"
        @show-lost="showLost"
      />

      <HealthDeadList
        v-if="showList"
        ref="list"
        v-model:reason="reason"
        v-model:host="host"
        v-model:year="listYear"
        :groups="groups"
        :pool="pool"
        :title="busy ? '已发现的失效图片' : '全部失效图片'"
        :count="listCount"
        :day-label="dayLabel"
        :show-filters="showFilters"
        :narrow="narrow"
        :fixing="state === 'fixing'"
        :host-name="health.hostName"
        :short-host-name="health.shortHostName"
        :config="health.config.value"
        :confirmed-http-hosts="confirmedHttpHosts"
        :docs-of="docsOf"
        :repair-rows="repairState.rows"
        :retrying="health.retrying"
        :still-dead="health.stillDead"
        @clear-day="clearChip"
        @switch="(id: string) => repair.repair([id], 'row')"
        @retry="health.retry"
        @reupload="actions.reupload"
        @locate="actions.locate"
        @open-browser="actions.openInBrowser"
        @remove-dead="(id: string) => actions.removeDead(id, docsOf(id))"
      />
    </div>

    <RepairDialog
      v-model:open="repairOpen"
      :folders="docFolders.folders.value"
      :problems="problems"
      @add="docFolders.add()"
      @remove="docFolders.remove"
      @repair="repairDocs"
      @open-doc="actions.openDoc"
    />
    <BackupDialog v-model:open="backupOpen" :total="summary.singleCopy" :targets="backupTargets" @start="startBackup" />
  </div>
</template>

<style scoped>
.health {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}

.health__scroll {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-24);
  min-height: 0;
  padding: 0 var(--pn-space-24) var(--pn-space-24);
  overflow: hidden auto;
}

.health__top { display: flex; flex-direction: column; gap: var(--pn-space-health-status-gap); }

.health__calendar {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-calendar-gap);
  padding: var(--pn-space-calendar-pad);
  border-radius: var(--pn-radius-panel);
  background: var(--pn-surface);
}

.health__calendar--narrow { padding: var(--pn-space-calendar-pad-narrow); }
.health__calendar-head { display: flex; gap: var(--pn-space-4); align-items: center; }
.health__spacer { flex: 1; }

.health__year-summary {
  font-size: var(--pn-text-footnote);
  font-variant-numeric: tabular-nums;
  color: var(--pn-text3);
  white-space: nowrap;
}
</style>
