<script setup lang="ts">
// 分组链接列表 + 筛选芯片 + 行操作
// 从 MdRescueInline.vue 提取的最复杂 UI 区块

import { ref, computed } from 'vue';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { dirname } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../../../../composables/useToast';
import { getServiceDisplayName } from '../../../../constants/serviceNames';
import type { MdImageLinkWithFile } from '../../../../composables/useMdRescue';
import {
  getStatusDisplay, statusBadgeLabel, statusDotColor, statusTooltip,
  extractHost, isDefunctHost, extractFilenameFromUrl,
} from '../../../../composables/useLinkStatusDisplay';

const props = defineProps<{
  imageLinks: MdImageLinkWithFile[];
  isRepaired: boolean;
  phase: string;
  scanStage: string;
}>();

const toast = useToast();

// ---- 筛选 ----

const activeFilter = ref<'all' | 'rescuable' | 'manual'>('all');
const ROW_DISPLAY_LIMIT = 200;
const ROW_DISPLAY_STEP = 200;
const displayRowLimit = ref(ROW_DISPLAY_LIMIT);

interface FlatRow {
  link: MdImageLinkWithFile;
  firstOfFile: boolean;
  status: 'rescuable' | 'manual' | 'replaced';
}

const flatBrokenData = computed(() => {
  const rows: FlatRow[] = [];
  let manual = 0, rescuable = 0;
  for (const l of props.imageLinks) {
    if (!l.checkResult || l.checkResult.is_valid) continue;
    const hasValidBackup = l.backupLinks?.some((b) => b.checkResult?.is_valid) ?? false;
    let status: FlatRow['status'];
    if (props.isRepaired && l.selectedBackup) status = 'replaced';
    else if (hasValidBackup) status = 'rescuable';
    else status = 'manual';
    if (status === 'manual') manual++;
    else rescuable++;
    rows.push({ link: l, firstOfFile: false, status });
  }
  return { rows, counts: { all: rows.length, rescuable, manual } };
});

const flatBrokenLinks = computed(() => flatBrokenData.value.rows);
const filterCounts = computed(() => flatBrokenData.value.counts);

const filteredRows = computed<FlatRow[]>(() => {
  const all = flatBrokenLinks.value;
  const filter = activeFilter.value;
  const result: FlatRow[] = [];
  let prevFile = '';
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    if (filter === 'rescuable' && r.status === 'manual') continue;
    if (filter === 'manual' && r.status !== 'manual') continue;
    result.push({
      link: r.link,
      status: r.status,
      firstOfFile: r.link.sourceFile !== prevFile,
    });
    prevFile = r.link.sourceFile;
  }
  return result;
});

const rescuableChipLabel = computed(() => (props.isRepaired ? '已修复' : '可修复'));

// ---- 分组 ----

interface GroupedFile {
  filePath: string;
  fileName: string;
  directory: string;
  rows: FlatRow[];
}

function getFileDirectory(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length < 2 ? '' : parts[parts.length - 2];
}

const groupedRows = computed<GroupedFile[]>(() => {
  const map = new Map<string, GroupedFile>();
  for (const r of filteredRows.value) {
    const key = r.link.sourceFile;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        filePath: key,
        fileName: r.link.sourceFileName,
        directory: getFileDirectory(key),
        rows: [],
      };
      map.set(key, entry);
    }
    entry.rows.push(r);
  }
  return Array.from(map.values());
});

const totalFilteredRowCount = computed(() => filteredRows.value.length);

const visibleGroupedRows = computed<GroupedFile[]>(() => {
  const limit = displayRowLimit.value;
  const all = groupedRows.value;
  if (totalFilteredRowCount.value <= limit) return all;
  const result: GroupedFile[] = [];
  let count = 0;
  for (const group of all) {
    if (count >= limit) break;
    const remaining = limit - count;
    if (group.rows.length <= remaining) {
      result.push(group);
      count += group.rows.length;
    } else {
      result.push({ ...group, rows: group.rows.slice(0, remaining) });
      count += remaining;
    }
  }
  return result;
});

const collapsedGroups = ref<Set<string>>(new Set());

function toggleGroupCollapse(filePath: string): void {
  const next = new Set(collapsedGroups.value);
  if (next.has(filePath)) next.delete(filePath);
  else next.add(filePath);
  collapsedGroups.value = next;
}

function selectFilter(f: 'all' | 'rescuable' | 'manual') {
  if (activeFilter.value === f) return;
  activeFilter.value = f;
  displayRowLimit.value = ROW_DISPLAY_LIMIT;
}

// ---- 行操作 ----

async function withErrorToast(fn: () => Promise<void>, errorMsg: string): Promise<void> {
  try { await fn(); } catch (err) { toast.error(errorMsg, String(err)); }
}

async function revealInFolder(filePath: string): Promise<void> {
  await withErrorToast(async () => {
    const dir = await dirname(filePath);
    await invoke('open_path', { path: dir });
  }, '无法打开文件夹');
}

async function openMdFile(filePath: string): Promise<void> {
  await withErrorToast(() => invoke('open_path', { path: filePath }), '无法打开文件');
}

async function openInBrowser(url: string): Promise<void> {
  await withErrorToast(() => shellOpen(url), '无法打开链接');
}

async function copyRowUrl(url: string): Promise<void> {
  try {
    await writeText(url);
    toast.success('已复制', 'URL 已复制到剪贴板');
  } catch (err) {
    toast.error('复制失败', String(err));
  }
}

function getFirstValidBackup(link: MdImageLinkWithFile): string {
  return link.backupLinks?.find((b) => b.checkResult?.is_valid)?.url ?? '';
}

function setInlineBackup(link: MdImageLinkWithFile, backupUrl: string): void {
  link.selectedBackup = backupUrl;
}

// 暴露给父组件的数据（父组件底栏统计需要）
defineExpose({
  groupedRows,
  flatBrokenLinks,
  filterCounts,
});
</script>

<template>
  <!-- 顶部筛选芯片（占位显示，扫描一开始就稳定在顶部） -->
  <div class="mr-action-bar">
    <div class="mr-chips">
      <button class="mr-chip" :class="{ active: activeFilter === 'all' }" @click="selectFilter('all')">
        <span>全部</span>
        <span class="mr-chip-count">{{ filterCounts.all }}</span>
      </button>
      <button
        class="mr-chip"
        :class="{ active: activeFilter === 'rescuable', disabled: filterCounts.rescuable === 0 }"
        :disabled="filterCounts.rescuable === 0"
        @click="selectFilter('rescuable')"
      >
        <span>{{ rescuableChipLabel }}</span>
        <span class="mr-chip-count">{{ filterCounts.rescuable }}</span>
      </button>
      <button
        class="mr-chip"
        :class="{ active: activeFilter === 'manual', disabled: filterCounts.manual === 0 }"
        :disabled="filterCounts.manual === 0"
        @click="selectFilter('manual')"
      >
        <span class="mr-dot mr-dot--amber" />
        <span>需手动</span>
        <span class="mr-chip-count">{{ filterCounts.manual }}</span>
      </button>
    </div>
  </div>

  <!-- 分组列表 / 筛选为空 -->
  <Transition name="slide-up" mode="out-in">
    <div v-if="groupedRows.length > 0" key="groups" class="mr-groups">
      <div v-for="group in visibleGroupedRows" :key="group.filePath" class="mr-group">
        <button type="button" class="mr-group-header" @click="toggleGroupCollapse(group.filePath)">
          <i class="pi mr-group-chev" :class="collapsedGroups.has(group.filePath) ? 'pi-chevron-right' : 'pi-chevron-down'" />
          <i class="pi pi-file mr-group-file-icon" />
          <div class="mr-group-info">
            <span class="mr-group-name" v-tooltip.top="group.filePath">{{ group.fileName }}</span>
            <span class="mr-group-dir" v-tooltip.top="group.filePath">{{ group.directory }}</span>
          </div>
          <span class="mr-group-count">{{ group.rows.length }} 条异常链接</span>
          <span class="mr-group-actions" @click.stop>
            <button type="button" class="mr-group-icon-btn" v-tooltip.top="'在文件管理器中定位'" @click="revealInFolder(group.filePath)">
              <i class="pi pi-folder-open" />
            </button>
            <button type="button" class="mr-group-icon-btn" v-tooltip.top="'用默认编辑器打开'" @click="openMdFile(group.filePath)">
              <i class="pi pi-pencil" />
            </button>
          </span>
        </button>
        <div v-if="!collapsedGroups.has(group.filePath)" class="mr-group-body">
          <div v-for="(row, i) in group.rows" :key="row.link.url + '|' + i" class="mr-row">
            <div class="mr-row-status">
              <span class="mr-status-dot" :style="{ background: statusDotColor(row.link.checkResult) }" />
              <span
                class="mr-status-label"
                :class="`mr-status-label--${getStatusDisplay(row.link.checkResult).color}`"
                v-tooltip.top="statusTooltip(row.link.checkResult)"
              >{{ statusBadgeLabel(row.link.checkResult) }}</span>
            </div>
            <span class="mr-img-name" v-tooltip.top="row.link.url">{{ extractFilenameFromUrl(row.link.url) }}</span>
            <span class="mr-host-badge" :class="{ 'mr-host-badge--defunct': isDefunctHost(row.link.url) }" v-tooltip.top="row.link.url">{{ extractHost(row.link.url) }}</span>
            <select
              v-if="row.status === 'rescuable' && row.link.backupLinks?.some(b => b.checkResult?.is_valid)"
              class="mr-inline-select"
              :value="row.link.selectedBackup || getFirstValidBackup(row.link)"
              @change="setInlineBackup(row.link, ($event.target as HTMLSelectElement).value)"
            >
              <option
                v-for="b in row.link.backupLinks!.filter(b => b.checkResult?.is_valid)"
                :key="b.url" :value="b.url"
              >{{ getServiceDisplayName(b.serviceId) }}{{ b.checkResult?.response_time ? ` · ${b.checkResult.response_time}ms` : '' }}</option>
            </select>
            <span v-else-if="row.status === 'manual'" class="mr-no-backup" v-tooltip.top="'第 ' + row.link.lineNumber + ' 行 · 需手动处理'">L{{ row.link.lineNumber }}</span>
            <div class="mr-row-actions">
              <button type="button" class="mr-row-icon-btn" v-tooltip.top="'复制 URL'" @click="copyRowUrl(row.link.url)">
                <i class="pi pi-copy" />
              </button>
              <button type="button" class="mr-row-icon-btn" v-tooltip.top="'在浏览器打开'" @click="openInBrowser(row.link.url)">
                <i class="pi pi-external-link" />
              </button>
              <button v-if="row.status === 'manual'" type="button" class="mr-row-icon-btn" v-tooltip.top="'用编辑器打开源文件'" @click="openMdFile(row.link.sourceFile)">
                <i class="pi pi-file-edit" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <button v-if="totalFilteredRowCount > displayRowLimit" class="mr-load-more" @click="displayRowLimit += ROW_DISPLAY_STEP">
        显示更多（{{ Math.min(displayRowLimit, totalFilteredRowCount) }} / {{ totalFilteredRowCount }}）
      </button>
    </div>
    <div v-else-if="flatBrokenLinks.length > 0" key="empty-filter" class="mr-empty-filter">
      <i class="pi pi-filter-slash" />
      <span>此筛选条件下没有记录</span>
    </div>
  </Transition>
</template>

<style scoped>
/* 操作栏 */
.mr-action-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-lg); flex-shrink: 0; min-height: 32px;
}

.mr-chips { display: flex; align-items: center; gap: var(--space-xs-sm); flex-wrap: wrap; }

.mr-chip {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px/26px 无精确 spacing token */
  display: inline-flex; align-items: center; gap: 5px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 13px 为药片型圆角，无 radius token */
  height: 26px; padding: 0 var(--space-sm-md); border-radius: 13px;
  font-size: var(--text-xs); font-weight: var(--weight-medium); cursor: pointer;
  background: var(--bg-input); color: var(--text-muted);
  border: 1px solid transparent;
  font-family: inherit; white-space: nowrap;
  transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast);
}

.mr-chip:hover { background: var(--hover-overlay); border-color: var(--border-subtle); }

.mr-chip.active {
  background: var(--primary-alpha-10); color: var(--primary); border-color: var(--primary-alpha-10);
}

.mr-chip.active .mr-chip-count { color: var(--primary); opacity: 0.85; }

.mr-chip.disabled, .mr-chip:disabled {
  opacity: 0.4; cursor: not-allowed; pointer-events: none;
  background: var(--bg-input); color: var(--text-tertiary); border-color: transparent;
}

.mr-chip-count { font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }

.mr-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: var(--text-tertiary); }
.mr-dot--amber { background: var(--warning); }

/* 分组列表 */
.mr-groups { display: flex; flex-direction: column; gap: var(--space-xs-sm); flex-shrink: 0; }

.mr-group {
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--bg-card); overflow: hidden;
}

.mr-group-header {
  display: flex; align-items: center; gap: var(--space-sm-md); width: 100%;
  min-height: 52px; padding: var(--space-sm) var(--space-md-lg);
  background: var(--bg-input); border: none; cursor: pointer; font-family: inherit;
  text-align: left; position: sticky; top: 0; z-index: 2;
  transition: background var(--duration-fast);
}
.mr-group-header:hover { background: var(--hover-overlay-subtle); }

.mr-group-chev { font-size: var(--text-xs); color: var(--text-tertiary); flex-shrink: 0; transition: transform var(--duration-fast); }
.mr-group-file-icon { font-size: var(--text-base); color: var(--primary); flex-shrink: 0; }

/* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1px 为微间距，无 spacing token */
.mr-group-info { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }

.mr-group-name {
  font-size: var(--text-sm); font-weight: var(--weight-semibold); color: var(--text-main);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mr-group-dir {
  font-size: var(--text-xs); color: var(--text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mr-group-count {
  font-size: var(--text-xs); font-weight: var(--weight-medium);
  padding: var(--space-2xs) var(--space-sm); border-radius: var(--radius-sm-md);
  background: var(--hover-overlay); color: var(--text-muted);
  flex-shrink: 0; font-variant-numeric: tabular-nums;
}

.mr-group-actions { display: inline-flex; align-items: center; gap: var(--space-2xs); flex-shrink: 0; }

.mr-group-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: var(--radius-sm-md); border: none;
  background: transparent; color: var(--text-tertiary); cursor: pointer;
  opacity: 0.4;
  transition: background var(--duration-fast), color var(--duration-fast), opacity var(--duration-fast);
  font-family: inherit;
}
.mr-group-header:hover .mr-group-icon-btn { opacity: 1; }
.mr-group-icon-btn:hover { background: var(--hover-overlay-subtle); color: var(--primary); }
.mr-group-icon-btn > .pi { font-size: var(--text-sm); }

.mr-group-body { display: flex; flex-direction: column; background: var(--bg-card); }

/* 单行 */
.mr-row {
  display: flex; align-items: center; gap: var(--space-md);
  height: 40px; padding: 0 var(--space-md-lg);
  transition: background var(--duration-micro);
}
.mr-row:hover { background: var(--hover-overlay-subtle); }

.mr-row-status { display: inline-flex; align-items: center; gap: var(--space-xs-sm); flex-shrink: 0; width: 80px; }

.mr-status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

.mr-status-label {
  font-size: var(--text-2xs); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1px 为微间距，无 spacing token */
  padding: 1px var(--space-xs-sm); border-radius: var(--radius-xs); min-width: var(--space-2xl); text-align: center;
  white-space: nowrap; cursor: default;
}

.mr-status-label--red { background: var(--error-alpha-10); color: var(--error); }
.mr-status-label--amber { background: var(--warning-alpha-8); color: var(--warning); }
.mr-status-label--purple { background: var(--pending-alpha-8); color: var(--pending); }
.mr-status-label--green { background: var(--success-alpha-10); color: var(--success); }

.mr-img-name {
  flex: 1 1 auto; min-width: 0;
  font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-main);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mr-host-badge {
  flex-shrink: 0; display: inline-flex; align-items: center;
  height: 20px; padding: 0 var(--space-sm); border-radius: var(--radius-xs);
  background: var(--bg-input); color: var(--text-muted);
  border: 1px solid var(--border-subtle);
  font-size: var(--text-xs); font-family: var(--font-mono, 'JetBrains Mono', monospace);
  max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mr-row:hover .mr-host-badge { background: var(--hover-overlay); }

.mr-host-badge--defunct { background: var(--error-alpha-10); color: var(--error); border-color: var(--error-alpha-15); }
.mr-row:hover .mr-host-badge--defunct { background: var(--error-alpha-15); }

/* 内联备用链接选择器 */
.mr-inline-select {
  flex-shrink: 0; max-width: 140px;
  height: 22px; padding: 0 var(--space-xs); border-radius: var(--radius-sm-md);
  font-size: var(--text-xs); font-family: inherit; color: var(--text-main);
  background: var(--primary-alpha-8); border: 1px solid var(--primary-alpha-15);
  cursor: pointer; outline: none;
  transition: border-color var(--duration-fast);
}
.mr-inline-select:focus { border-color: var(--primary); }

.mr-no-backup {
  flex-shrink: 0; font-size: var(--text-2xs); font-weight: var(--weight-semibold); color: var(--text-tertiary);
  font-family: var(--font-mono, 'JetBrains Mono', monospace); font-variant-numeric: tabular-nums;
  padding: 0 var(--space-xs-sm); cursor: default;
}

.mr-row-actions {
  display: inline-flex; align-items: center; gap: var(--space-2xs); flex-shrink: 0;
  opacity: 0; transition: opacity var(--duration-fast);
}
.mr-row:hover .mr-row-actions { opacity: 1; }

.mr-row-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: var(--radius-sm-md); border: none;
  background: transparent; color: var(--text-tertiary); cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast); font-family: inherit;
}
.mr-row-icon-btn:hover { background: var(--hover-overlay); color: var(--primary); }
.mr-row-icon-btn > .pi { font-size: var(--text-xs); }

.mr-load-more {
  display: flex; align-items: center; justify-content: center;
  width: 100%; padding: var(--space-sm-md) 0; border: none;
  background: transparent; color: var(--text-muted); font-size: var(--text-xs); font-weight: var(--weight-medium);
  cursor: pointer; font-family: inherit; font-variant-numeric: tabular-nums;
  transition: color var(--duration-fast);
}
.mr-load-more:hover { color: var(--primary); }

.mr-empty-filter {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--space-sm); padding: var(--space-2xl); color: var(--text-tertiary); font-size: var(--text-xs);
}
.mr-empty-filter > .pi { font-size: var(--text-2xl); }

/* 动画 */
.slide-up-enter-active { transition: opacity var(--duration-medium) ease, transform var(--duration-medium) ease; }
.slide-up-enter-from { opacity: 0; transform: translateY(12px); }
.slide-up-leave-active { transition: opacity var(--duration-normal) ease, transform var(--duration-normal) ease; }
.slide-up-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
