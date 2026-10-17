<script setup lang="ts">
// 多选操作条（GalleryScreen.dc.html G04）：底部居中浮起，「已选 N 张」+ 复制链接 / 收藏 / 重新检测 / 补充备份到… / 导出 / 移除记录 + 取消（Esc）。
// 「复制链接」的下拉照 CopyMulti.dc.html ③：上面切格式，下面选图床；「补充备份到…」列出已添加的图床。
import { computed, ref, watch } from 'vue';
import { DropdownMenuLabel } from 'reka-ui';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuItem from '@/components/pn/PnMenuItem.vue';
import PnMenuRadioGroup from '@/components/pn/PnMenuRadioGroup.vue';
import PnMenuSeparator from '@/components/pn/PnMenuSeparator.vue';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { useUploadController } from '@/composables/upload/useUploadController';
import { formatCount } from '@/utils/formatters';
import { FORMAT_NAMES, type LinkFormat } from '@/utils/linkFormatter';
import { useGalleryActions } from './useGalleryActions';
import type { GalleryGridApi } from './useGalleryGrid';

const props = defineProps<{
  grid: GalleryGridApi;
  /** 默认链接格式（设置里的「复制为」） */
  format: LinkFormat;
}>();

const emit = defineEmits<{ removed: [ids: string[]] }>();

const actions = useGalleryActions();
const upload = useUploadController();
const { viewState, historyManager } = props.grid;

const ids = computed(() => viewState.selectedIdList.value);
const label = computed(() => `已选 ${formatCount(ids.value.length)} 张`);
const allFavorited = computed(() => ids.value.length > 0 && ids.value.every((id) => historyManager.favoriteSet.value.has(id)));

/** 这次复制用的格式：默认跟设置一致，在下拉里切换只影响这一次 */
const copyFormat = ref<LinkFormat>(props.format);
watch(() => props.format, (value) => { copyFormat.value = value; });
const formatOptions = (['url', 'markdown', 'html', 'bbcode', 'custom'] as const).map((value) => ({ value, label: FORMAT_NAMES[value] }));

/** 选中的图存在哪些图床上（已加载的那部分），给「复制哪个图床的链接」用 */
const hostsOfSelection = computed(() => {
  const selected = new Set(ids.value);
  const found = new Set<string>();
  for (const meta of props.grid.allLoadedMetas.value) {
    if (!selected.has(meta.id)) continue;
    for (const mirror of meta.mirrorServices ?? []) found.add(mirror.serviceId);
    if (!meta.mirrorServices?.length) found.add(meta.primaryService);
  }
  return [...found].map((id) => ({ id, name: getServiceDisplayName(id, props.grid.config.value) }));
});

const busy = ref(false);
async function run(task: () => Promise<unknown>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await task();
  } finally {
    busy.value = false;
  }
}

async function remove(): Promise<void> {
  const removing = [...ids.value];
  if (await actions.removeRecords(removing)) {
    viewState.clearSelection();
    emit('removed', removing);
  }
}
</script>

<template>
  <div class="selection-bar" role="toolbar" :aria-label="label">
    <span class="selection-bar__count">{{ label }}</span>
    <span class="selection-bar__rule" aria-hidden="true" />

    <PnMenu align="start" side="top" :width="240">
      <template #trigger>
        <button type="button" class="selection-bar__button" aria-haspopup="menu">
          复制链接
          <PnIcon name="chevronDown" :size="12" :stroke="1.8" class="selection-bar__caret" />
        </button>
      </template>
      <PnMenuRadioGroup v-model="copyFormat" :options="formatOptions" />
      <PnMenuSeparator />
      <PnMenuItem @select="actions.copyMany(ids, copyFormat)">复制时使用的链接</PnMenuItem>
      <template v-if="hostsOfSelection.length > 1">
        <DropdownMenuLabel class="pn-menu__group-label">复制哪个图床的链接</DropdownMenuLabel>
        <PnMenuItem v-for="host in hostsOfSelection" :key="host.id" @select="actions.copyMany(ids, copyFormat, host.id)">{{ host.name }}</PnMenuItem>
      </template>
    </PnMenu>

    <button type="button" class="selection-bar__button" @click="actions.setFavorite(ids, !allFavorited)">{{ allFavorited ? '取消收藏' : '收藏' }}</button>
    <button type="button" class="selection-bar__button" :disabled="busy" @click="run(() => actions.recheck(ids))">重新检测</button>

    <PnMenu align="start" side="top" :width="200">
      <template #trigger>
        <button type="button" class="selection-bar__button" aria-haspopup="menu" :disabled="busy">
          补充备份到…
          <PnIcon name="chevronDown" :size="12" :stroke="1.8" class="selection-bar__caret" />
        </button>
      </template>
      <PnMenuItem v-for="host in upload.hosts.value" :key="host.id" @select="run(() => actions.backupTo(ids, host.id))">{{ host.name }}</PnMenuItem>
    </PnMenu>

    <button type="button" class="selection-bar__button" @click="historyManager.bulkExportJSON(ids)">导出</button>
    <button type="button" class="selection-bar__button selection-bar__button--danger" @click="remove">移除记录</button>
    <span class="selection-bar__rule selection-bar__rule--end" aria-hidden="true" />
    <button type="button" class="selection-bar__close" aria-label="取消选择" title="取消选择  Esc" @click="viewState.clearSelection()">
      <PnIcon name="close" :size="13" :stroke="2" />
    </button>
  </div>
</template>

<style scoped>
.selection-bar {
  position: absolute;
  bottom: var(--pn-space-20);
  left: 50%;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: var(--pn-space-2);
  height: var(--pn-size-toolbar-row);
  box-sizing: border-box;
  padding: 0 var(--pn-space-6) 0 var(--pn-space-16);
  border-radius: var(--pn-radius-xl);
  background: var(--pn-elevated);
  box-shadow: var(--pn-e4);
  white-space: nowrap;
  transform: translateX(-50%);
}

.selection-bar__count {
  margin-right: var(--pn-space-4);
  font-weight: var(--pn-weight-semibold);
}

.selection-bar__rule {
  width: 1px;
  height: var(--pn-space-20);
  margin: 0 var(--pn-space-6);
  background: var(--pn-border);
}

.selection-bar__rule--end { margin: 0 var(--pn-space-4); }

.selection-bar__button {
  display: flex;
  align-items: center;
  gap: var(--pn-space-copy-gap);
  height: var(--pn-size-button-dialog);
  padding: 0 var(--pn-space-button-sm-x);
  border: 0;
  border-radius: var(--pn-radius-md);
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
}

.selection-bar__button:hover:not(:disabled),
.selection-bar__button[data-state='open'] { background: var(--pn-row-hover); }

.selection-bar__button:disabled { color: var(--pn-text3); }
.selection-bar__button--danger { color: var(--pn-danger); }
.selection-bar__caret { color: var(--pn-text3); }

.selection-bar__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-button-dialog);
  height: var(--pn-size-button-dialog);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-md);
  background: transparent;
  color: var(--pn-text2);
}

.selection-bar__close:hover { background: var(--pn-row-hover); }
</style>
