<script setup lang="ts">
// 文档修复弹窗（HealthScreen.dc.html L14，交接说明 8.3）：上半管理「文档文件夹」，下半列出需要修复的文档和处数；
// 「修复 N 处」不弹二次确认，修改前自动备份、可撤销。没有需要修复的文档时只留「完成」。
import { computed } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnDialog from '@/components/pn/PnDialog.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnIconButton from '@/components/pn/PnIconButton.vue';
import { formatCount } from '@/utils/formatters';
import { parentDir, problemDetail, type DocProblem } from './docIndex';
import type { DocFolder } from './useDocFolders';

const open = defineModel<boolean>('open', { required: true });

const props = defineProps<{
  folders: readonly DocFolder[];
  problems: readonly DocProblem[];
}>();

const emit = defineEmits<{ add: []; remove: [path: string]; repair: []; openDoc: [path: string] }>();

const dead = computed(() => props.problems.reduce((n, p) => n + p.dead, 0));
const fixable = computed(() => props.problems.reduce((n, p) => n + p.fixable, 0));
/** 还有文件夹在读：不急着说「没有失效图片」 */
const reading = computed(() => props.folders.some((f) => f.status === 'scanning'));

function folderMeta(folder: DocFolder): string {
  if (folder.status === 'scanning') return '正在读取…';
  if (folder.status === 'missing') return '文件夹不存在';
  if (folder.status === 'denied') return '没有读取权限';
  return `${formatCount(folder.docs.length)} 个文档`;
}

function repair(): void {
  open.value = false;
  emit('repair');
}
</script>

<template>
  <PnDialog v-model:open="open" title="文档修复" eyebrow="将 Markdown 文档中失效的图片替换为备份" icon="docRepair">
    <div class="repair-dialog__section">
      <span class="repair-dialog__label">文档文件夹</span>
      <div class="repair-dialog__box">
        <div class="repair-dialog__scroll">
          <div v-for="folder in folders" :key="folder.path" class="repair-dialog__folder">
            <PnIcon name="folder" :size="15" :stroke="1.6" class="repair-dialog__muted-icon" />
            <span class="repair-dialog__path pn-selectable" :title="folder.path">{{ folder.path }}</span>
            <span class="repair-dialog__meta" :class="{ 'repair-dialog__meta--warning': folder.status === 'missing' || folder.status === 'denied' }">{{ folderMeta(folder) }}</span>
            <PnIconButton icon="close" label="移除这个文件夹" :icon-size="12" :stroke="2.2" no-tooltip @click="emit('remove', folder.path)" />
          </div>
        </div>
        <button type="button" class="repair-dialog__add" :class="{ 'repair-dialog__add--alone': folders.length === 0 }" @click="emit('add')">
          <PnIcon name="plus" :size="14" :stroke="2" />添加文件夹…
        </button>
      </div>
    </div>

    <div v-if="folders.length" class="repair-dialog__section">
      <div class="repair-dialog__label-row">
        <span class="repair-dialog__label">需要修复的文档</span>
        <span v-if="problems.length" class="repair-dialog__meta">{{ formatCount(problems.length) }} 个文档 · {{ formatCount(dead) }} 处失效</span>
      </div>
      <div v-if="problems.length" class="repair-dialog__box">
        <div class="repair-dialog__scroll">
          <div v-for="doc in problems" :key="doc.path" class="repair-dialog__doc">
            <PnIcon name="file" :size="15" :stroke="1.6" class="repair-dialog__muted-icon" />
            <span class="repair-dialog__doc-text">
              <span class="repair-dialog__doc-name">{{ doc.name }}</span>
              <span class="repair-dialog__doc-detail">{{ parentDir(doc.path) }} · {{ problemDetail(doc) }}</span>
            </span>
            <PnIconButton icon="openExternal" label="用编辑器打开" :icon-size="14" :stroke="1.6" @click="emit('openDoc', doc.path)" />
          </div>
        </div>
      </div>
      <span v-else class="repair-dialog__note">{{ reading ? '正在读取文档…' : '文档中没有失效图片' }}</span>
    </div>

    <span v-if="problems.length" class="repair-dialog__note">
      修改前自动备份原文件，可撤销。<template v-if="dead > fixable">无可用备份的 {{ formatCount(dead - fixable) }} 处保持原样。</template>
    </span>

    <template #footer>
      <template v-if="problems.length">
        <PnButton variant="secondary" size="dialog" @click="open = false">取消</PnButton>
        <PnButton variant="primary" size="dialog" :disabled="fixable === 0" @click="repair">修复 {{ formatCount(fixable) }} 处</PnButton>
      </template>
      <PnButton v-else variant="secondary" size="dialog" @click="open = false">完成</PnButton>
    </template>
  </PnDialog>
</template>

<style scoped>
.repair-dialog__section { display: flex; flex-direction: column; gap: var(--pn-space-6); }
.repair-dialog__label-row { display: flex; gap: var(--pn-space-8); align-items: baseline; }
.repair-dialog__label { font-size: var(--pn-text-footnote); font-weight: var(--pn-weight-medium); color: var(--pn-text2); }

.repair-dialog__box {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--pn-radius-lg);
  box-shadow: 0 0 0 1px var(--pn-border);
  color: var(--pn-text1);
}

.repair-dialog__scroll { max-height: var(--pn-size-dialog-list-max); overflow-y: auto; }

.repair-dialog__folder {
  display: flex;
  gap: var(--pn-space-sidebar-x);
  align-items: center;
  height: var(--pn-size-doc-folder-row);
  padding: var(--pn-space-doc-folder-row);
}

.repair-dialog__folder + .repair-dialog__folder,
.repair-dialog__doc + .repair-dialog__doc { box-shadow: inset 0 1px 0 var(--pn-border); }

.repair-dialog__muted-icon { flex: none; color: var(--pn-text3); }

.repair-dialog__path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repair-dialog__meta { font-size: var(--pn-text-footnote); color: var(--pn-text3); white-space: nowrap; }
.repair-dialog__meta--warning { color: var(--pn-warning); }

.repair-dialog__add {
  display: flex;
  gap: var(--pn-space-8);
  align-items: center;
  height: var(--pn-size-doc-folder-add);
  padding: 0 var(--pn-space-doc-add-x);
  border: 0;
  border-top: 1px solid var(--pn-border);
  background: transparent;
  color: var(--pn-brand-text);
  font: inherit;
  font-weight: var(--pn-weight-medium);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 弹窗是浮层底（深色 #2A2A2D），透明底按钮的 ghost-hover 在上面看不出来：用白底按钮的悬停 / 按下色 */
.repair-dialog__add:hover { background: var(--pn-secondary-hover); }
.repair-dialog__add:active { background: var(--pn-secondary-press); }

.repair-dialog__add--alone { border-top: 0; }

.repair-dialog__doc {
  display: flex;
  gap: var(--pn-space-sidebar-x);
  align-items: center;
  min-height: var(--pn-size-dialog-list-row);
  box-sizing: border-box;
  padding: var(--pn-space-doc-row);
}

.repair-dialog__doc-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }

.repair-dialog__doc-name,
.repair-dialog__doc-detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repair-dialog__doc-name { font-weight: var(--pn-weight-medium); }
.repair-dialog__doc-detail { font-size: var(--pn-text-footnote); color: var(--pn-text3); }

.repair-dialog__note {
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-tool-desc);
  color: var(--pn-text3);
}
</style>
