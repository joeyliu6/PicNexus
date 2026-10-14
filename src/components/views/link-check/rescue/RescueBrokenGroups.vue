<script setup lang="ts">
// 按文档分组的打不开的图 + 行操作（换替换来源 / 复制 / 打开 / 定位文档）
// 结论与数量由页面顶部的结论卡交代，这里只列清单，不再做筛选

import { computed, ref, toRef } from 'vue';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { dirname } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '@/composables/useToast';
import { useConfigManager } from '@/composables/useConfig';
import { applyConfiguredUrlWithConfig } from '@/composables/useCopyLink';
import type { MdBackupLink } from '@/types/linkCheck';
import type { MdImageLinkWithFile } from '@/composables/md-rescue/shared';
import { useFlatBrokenRows, type GroupedFile } from '@/composables/md-rescue/useFlatBrokenRows';
import { getCopiesThumbnailCandidates } from '@/composables/image/useThumbCache';
import { getConfirmedHttpHosts } from '@/security/networkPolicy';
import RescueLinkRow from './RescueLinkRow.vue';
import RescueBackupChooser from './RescueBackupChooser.vue';
import { openUserExternalUrl } from '@/security/shellOpen';
import { getErrorMessage } from '@/types/errors';

const emit = defineEmits<{
  (e: 'prefer-service', serviceId: string): void;
}>();

const props = defineProps<{
  imageLinks: MdImageLinkWithFile[];
  isRepaired: boolean;
  healedFiles: Set<string>;
}>();

const toast = useToast();
const configManager = useConfigManager();

// ---- 列表数据（展平/筛选/分组） ----
const {
  displayRowLimit,
  filterCounts,
  visibleGroupedRows,
  totalRowCount,
  collapsedGroups,
  toggleGroupCollapse,
  loadMoreRows,
} = useFlatBrokenRows(toRef(props, 'imageLinks'), toRef(props, 'isRepaired'), toRef(props, 'healedFiles'));

// ---- 行操作 ----

// open_path 失败时 reject 的是 AppError，String() 会渲染成 [object Object]
async function withErrorToast(fn: () => Promise<void>, errorMsg: string): Promise<void> {
  try { await fn(); } catch (err) { toast.error(errorMsg, getErrorMessage(err)); }
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
  await withErrorToast(() => openUserExternalUrl(resolveConfiguredUrl(url)), '无法打开链接');
}

async function copyRowUrl(url: string): Promise<void> {
  try {
    await writeText(resolveConfiguredUrl(url));
    toast.silent('log', '已复制', 'URL 已复制到剪贴板');
  } catch (err) {
    toast.error('复制失败', getErrorMessage(err));
  }
}

function resolveConfiguredUrl(url: string): string {
  return applyConfiguredUrlWithConfig(url, undefined, configManager.config.value);
}

function validBackups(link: MdImageLinkWithFile): MdBackupLink[] {
  return link.backupLinks?.filter((b) => b.checkResult?.is_valid) ?? [];
}

/** 当前会被写进文件的备份（扫描结束时已按首选 / 最快预选，见 applyDefaultBackups） */
function selectedBackupOf(link: MdImageLinkWithFile): MdBackupLink | undefined {
  const valid = validBackups(link);
  return valid.find((b) => b.url === link.selectedBackup) ?? valid[0];
}

const confirmedHttpHosts = computed(() => getConfirmedHttpHosts(configManager.config.value));

/** 缩略图：先用要换上去的那张（能看到，也正好让用户确认没换错图），原链接垫底 */
function thumbSrcsOf(link: MdImageLinkWithFile): string[] {
  const selected = selectedBackupOf(link);
  const copies = [
    ...(selected ? [selected] : []),
    ...validBackups(link).filter((b) => b !== selected),
    { serviceId: '', url: link.url },
  ];
  return getCopiesThumbnailCandidates(copies, configManager.config.value);
}

/** 修完后：修好几张、剩下的是没备份（本来就换不了）还是没写进去，分开说；不说「已修复 0 / 2」这种像是失败的话 */
function groupCountLabel(group: GroupedFile): string {
  if (!props.isRepaired) return `${group.rows.length} 张打不开`;
  const fixed = group.rows.filter((r) => r.status === 'replaced').length;
  const left = group.rows.length - fixed;
  if (left === 0) return `已修复 ${fixed} 张`;
  const leftText = group.rows.every((r) => r.status !== 'rescuable') ? `${left} 张没有备份` : `${left} 张没修好`;
  return fixed === 0 ? leftText : `已修复 ${fixed} 张 · ${leftText}`;
}

// ---- 换替换来源 ----
const chooserRef = ref<InstanceType<typeof RescueBackupChooser> | null>(null);
const rescuableCount = computed(() => filterCounts.value.rescuable);

function openChooser(event: MouseEvent, link: MdImageLinkWithFile): void {
  if (validBackups(link).length <= 1) return;
  chooserRef.value?.open(event, link);
}

function chooseBackup(link: MdImageLinkWithFile, url: string): void {
  link.selectedBackup = url;
}
</script>

<template>
  <div class="mr-groups">
      <div v-for="group in visibleGroupedRows" :key="group.filePath" class="mr-group">
        <button type="button" class="mr-group-header" @click="toggleGroupCollapse(group.filePath)">
          <i class="pi mr-group-chev" :class="collapsedGroups.has(group.filePath) ? 'pi-chevron-right' : 'pi-chevron-down'" />
          <i class="pi pi-file mr-group-file-icon" />
          <div class="mr-group-info">
            <span class="mr-group-name" v-tooltip.top="group.filePath">{{ group.fileName }}</span>
            <span class="mr-group-dir">{{ group.directory }}</span>
          </div>
          <span class="mr-group-count" :class="{ 'mr-group-count--done': isRepaired && group.rows.every((r) => r.status === 'replaced') }">{{ groupCountLabel(group) }}</span>
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
          <RescueLinkRow
            v-for="(row, i) in group.rows"
            :key="row.link.url + '|' + i"
            :link="row.link"
            :status="row.status"
            :result="row.link.checkResult"
            :selected-backup="selectedBackupOf(row.link)"
            :backup-count="validBackups(row.link).length"
            :repair-failed="isRepaired && row.status === 'rescuable'"
            :thumb-srcs="thumbSrcsOf(row.link)"
            :confirmed-http-hosts="confirmedHttpHosts"
            @choose-backup="openChooser($event, row.link)"
            @copy="copyRowUrl(row.link.url)"
            @open="openInBrowser(row.link.url)"
            @edit="openMdFile(row.link.sourceFile)"
          />
        </div>
      </div>
      <button v-if="totalRowCount > displayRowLimit" class="mr-load-more" @click="loadMoreRows">
        显示更多（{{ Math.min(displayRowLimit, totalRowCount) }} / {{ totalRowCount }}）
      </button>
  </div>

  <RescueBackupChooser
    ref="chooserRef"
    :rescuable-count="rescuableCount"
    @select="chooseBackup"
    @prefer="(serviceId) => emit('prefer-service', serviceId)"
  />
</template>

<style scoped>
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

.mr-group-count--done { background: var(--success-alpha-10); color: var(--success); }

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

.mr-load-more {
  display: flex; align-items: center; justify-content: center;
  width: 100%; padding: var(--space-sm-md) 0; border: none;
  background: transparent; color: var(--text-muted); font-size: var(--text-xs); font-weight: var(--weight-medium);
  cursor: pointer; font-family: inherit; font-variant-numeric: tabular-nums;
  transition: color var(--duration-fast);
}
.mr-load-more:hover { color: var(--primary); }

</style>
