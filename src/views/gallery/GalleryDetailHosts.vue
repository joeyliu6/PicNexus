<script setup lang="ts">
// 详情「存放在」的图床列表（GalleryScreen.dc.html G05–G07）：每个图床一行，正常时只写名字和「复制」；
// 「复制时使用」那一份有标注；失效的琥珀色「⚠ 图片已不存在」、不给复制。
// 行尾「⋯」的内容设计没画，按交接说明第 15 节沿用最接近的菜单（链接健康的行菜单）。
import HostIcon from '@/components/biz/HostIcon.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuItem from '@/components/pn/PnMenuItem.vue';
import PnMenuSeparator from '@/components/pn/PnMenuSeparator.vue';
import type { HostRow } from './detailHosts';

defineProps<{
  rows: readonly HostRow[];
  name: (hostId: string) => string;
  /** 刚复制过的那一行：按钮原地变「已复制」 */
  copiedId: string | null;
  checking: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  copy: [hostId: string];
  use: [hostId: string];
  check: [hostId: string];
  open: [hostId: string];
  remove: [hostId: string];
}>();
</script>

<template>
  <div class="hosts">
    <div v-for="row in rows" :key="row.id" class="hosts__row">
      <span class="hosts__plate"><HostIcon :host="row.id" :size="15" :name="name(row.id)" /></span>
      <div class="hosts__text">
        <span class="hosts__name">{{ name(row.id) }}</span>
        <span v-if="checking.has(row.id)" class="hosts__status">正在检测…</span>
        <span v-else-if="row.status" class="hosts__status" :class="{ 'hosts__status--warn': row.warn }">
          <PnIcon v-if="row.warn" name="warning" :size="12" :stroke="2.2" />
          {{ row.status }}
        </span>
      </div>
      <button
        v-if="row.canCopy"
        type="button"
        class="hosts__copy"
        :class="{ 'hosts__copy--done': copiedId === row.id }"
        :aria-label="`复制${name(row.id)}的链接`"
        :title="`复制${name(row.id)}的链接`"
        @click="emit('copy', row.id)"
      >
        <PnIcon :name="copiedId === row.id ? 'check' : 'copy'" :size="12" :stroke="copiedId === row.id ? 2.4 : 1.9" />
        {{ copiedId === row.id ? '已复制' : '复制' }}
      </button>
      <PnMenu align="end" :width="200">
        <template #trigger>
          <button type="button" class="hosts__more" aria-label="这条链接的更多操作">
            <PnIcon name="more" :size="15" :stroke="2" />
          </button>
        </template>
        <PnMenuItem v-if="!row.isCopySource && row.health !== 'dead'" @select="emit('use', row.id)">改用这一份</PnMenuItem>
        <PnMenuItem :disabled="checking.has(row.id)" @select="emit('check', row.id)">重新检测</PnMenuItem>
        <PnMenuItem @select="emit('open', row.id)">在浏览器打开</PnMenuItem>
        <PnMenuSeparator />
        <PnMenuItem danger description="只删这条链接，记录和其他备份保留" @select="emit('remove', row.id)">移除这条链接…</PnMenuItem>
      </PnMenu>
    </div>
  </div>
</template>

<style scoped>
.hosts {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--pn-radius-lg);
  box-shadow: 0 0 0 1px var(--pn-border);
}

.hosts__row {
  display: flex;
  align-items: center;
  gap: var(--pn-space-button-sm-x);
  min-height: var(--pn-size-detail-host-row);
  padding: var(--pn-space-6) var(--pn-space-6) var(--pn-space-6) var(--pn-space-12);
}

.hosts__row + .hosts__row { box-shadow: inset 0 1px 0 var(--pn-border); }

.hosts__plate {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-detail-host-plate);
  height: var(--pn-size-detail-host-plate);
  border-radius: var(--pn-radius-sm);
  background: var(--pn-subtle);
  box-shadow: 0 0 0 1px var(--pn-hairline);
  color: var(--pn-text2);
}

.hosts__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.hosts__name { font-weight: var(--pn-weight-medium); }

.hosts__status {
  display: flex;
  align-items: center;
  gap: var(--pn-space-4);
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.hosts__status--warn { color: var(--pn-warning); }

.hosts__copy {
  display: flex;
  align-items: center;
  gap: var(--pn-space-copy-gap);
  height: var(--pn-size-button-sm);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-subtle);
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-footnote);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in), color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 浅灰底按钮：悬停再深一级、按下再深一级 */
.hosts__copy:hover { background: var(--pn-ghost-press); }
.hosts__copy:active { background: var(--pn-subtle-press); }

.hosts__copy--done,
.hosts__copy--done:hover,
.hosts__copy--done:active {
  background: var(--pn-success-soft);
  color: var(--pn-success);
  font-weight: var(--pn-weight-medium);
  transition-duration: var(--pn-dur-fast);
}

.hosts__more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-button-sm);
  height: var(--pn-size-button-sm);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text2);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.hosts__more:hover { background: var(--pn-ghost-hover); }

.hosts__more:active,
.hosts__more[data-state='open'] { background: var(--pn-ghost-press); }
</style>
