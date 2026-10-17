<script setup lang="ts">
// 全部失效图片的一行（HealthScreen.dc.html）：最小高 56、不套框，行间细线从缩略图右侧开始。
// 40px 缩略图 · 文件名 +「原因（琥珀）· 备份情况（灰）」· 上传日期 ·「用于 N 个文档」· 操作 ·「⋯」。
// 操作：能改用就「改用 X」；超时 / 拒绝访问给「重试」；「图片已不存在」不给。修复中写「已改用 X / 正在修复… / 等待中」。
import { computed } from 'vue';
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuItem from '@/components/pn/PnMenuItem.vue';
import PnMenuSeparator from '@/components/pn/PnMenuSeparator.vue';
import { getCopiesThumbnailCandidates } from '@/composables/image/useThumbCache';
import type { UserConfig } from '@/config/types';
import { joinCjk as cat } from '@/utils/cjkSpacing';
import { formatCount } from '@/utils/formatters';
import { backupLine, fullDate, isDead, reasonLine, thumbCopies, type HealthImage } from './healthModel';

const props = defineProps<{
  image: HealthImage;
  hostName: (id: string) => string;
  shortHostName: (id: string) => string;
  config: UserConfig;
  confirmedHttpHosts: ReadonlySet<string>;
  /** 窄窗口：去掉日期与文档两列 */
  narrow: boolean;
  /** 用于几个文档；null = 没有文档文件夹，这一列不写 */
  docs: number | null;
  repair?: { phase: 'waiting' | 'fixing' | 'done' | 'failed'; to: string };
  retrying: boolean;
  stillDead: boolean;
  last: boolean;
}>();

const emit = defineEmits<{
  switch: [];
  retry: [];
  reupload: [];
  locate: [];
  openBrowser: [];
  removeDead: [];
}>();

/** 「可能受限」的行没有失效的那份：菜单里不放「移除失效链接…」 */
const hasDead = computed(() => props.image.copies.some((c) => isDead(c.status)));

const thumbs = computed(() => getCopiesThumbnailCandidates(thumbCopies(props.image), props.config));

const note = computed<{ text: string; tone: 'muted' | 'brand' | 'warning' | 'danger' } | null>(() => {
  const r = props.repair;
  if (r?.phase === 'done') return { text: cat('已改用', props.shortHostName(r.to)), tone: 'muted' };
  if (r?.phase === 'fixing') return { text: '正在修复…', tone: 'brand' };
  if (r?.phase === 'waiting') return { text: '等待中', tone: 'muted' };
  if (r?.phase === 'failed') return { text: '未能修复', tone: 'danger' };
  if (props.stillDead) return { text: '仍然失效', tone: 'warning' };
  return null;
});

const action = computed<'switch' | 'retry' | null>(() => {
  if (props.image.state === 'fixable') return 'switch';
  if (props.image.state === 'unfixable' && props.image.reason !== 'gone') return 'retry';
  return null;
});

const docsText = computed(() => {
  if (props.docs === null) return '';
  return props.docs > 0 ? `用于 ${formatCount(props.docs)} 个文档` : '未被文档引用';
});
</script>

<template>
  <div class="dead-row" :class="{ 'dead-row--busy': !!repair }">
    <span class="dead-row__thumb">
      <ThumbnailImage :srcs="thumbs" alt="" :confirmed-http-hosts="confirmedHttpHosts" />
    </span>
    <div class="dead-row__main">
      <span class="dead-row__name" :title="image.name">{{ image.name }}</span>
      <span class="dead-row__line">
        <span class="dead-row__reason">{{ reasonLine(image, hostName) }}</span>· {{ backupLine(image, hostName) }}
      </span>
    </div>
    <template v-if="!narrow">
      <span class="dead-row__col">{{ fullDate(image.uploadedAt) }}</span>
      <span class="dead-row__col">{{ docsText }}</span>
    </template>
    <div class="dead-row__action">
      <span v-if="note" class="dead-row__note" :class="`dead-row__note--${note.tone}`">{{ note.text }}</span>
      <PnButton v-else-if="action === 'switch'" size="sm" @click="emit('switch')">{{ cat('改用', shortHostName(image.fixTo!)) }}</PnButton>
      <PnButton v-else-if="action === 'retry'" size="sm" :loading="retrying" @click="emit('retry')">{{ retrying ? '检测中' : '重试' }}</PnButton>
    </div>
    <PnMenu :width="250">
      <template #trigger>
        <button type="button" class="dead-row__more" aria-label="更多" aria-haspopup="menu" :disabled="!!repair">
          <PnIcon name="more" :size="15" :stroke="2" />
        </button>
      </template>
      <PnMenuItem @select="emit('retry')">重新检测这张</PnMenuItem>
      <PnMenuItem @select="emit('reupload')">重新上传原图…</PnMenuItem>
      <PnMenuItem @select="emit('locate')">在图库中查看</PnMenuItem>
      <PnMenuItem @select="emit('openBrowser')">在浏览器打开</PnMenuItem>
      <template v-if="hasDead">
        <PnMenuSeparator />
        <PnMenuItem danger description="执行前将提示文档中可能仍有引用" @select="emit('removeDead')">移除失效链接…</PnMenuItem>
      </template>
    </PnMenu>
    <span v-if="!last" class="dead-row__divider" aria-hidden="true" />
  </div>
</template>

<style scoped>
.dead-row {
  position: relative;
  display: flex;
  gap: var(--pn-space-dead-row-gap);
  align-items: center;
  min-height: var(--pn-size-dead-row);
  box-sizing: border-box;
  padding: var(--pn-space-dead-row);
  border-radius: var(--pn-radius-dead-row);
}

.dead-row:hover,
.dead-row:has([data-state="open"]) { background: var(--pn-row-hover); }

.dead-row__thumb {
  position: relative;
  flex: none;
  width: var(--pn-size-dead-thumb);
  height: var(--pn-size-dead-thumb);
  overflow: hidden;
  border-radius: var(--pn-radius-md);
  background: var(--pn-subtle);
  box-shadow: inset 0 0 0 1px var(--pn-hairline);
}

.dead-row__main { display: flex; flex: 1; flex-direction: column; min-width: 0; }

.dead-row__name {
  overflow: hidden;
  font-weight: var(--pn-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dead-row__line {
  display: flex;
  gap: var(--pn-space-6);
  align-items: center;
  overflow: hidden;
  font-size: var(--pn-text-footnote);
  color: var(--pn-text3);
  white-space: nowrap;
}

.dead-row__reason { color: var(--pn-warning); }

.dead-row__col {
  flex: none;
  width: var(--pn-size-dead-col);
  font-size: var(--pn-text-footnote);
  font-variant-numeric: tabular-nums;
  color: var(--pn-text3);
  white-space: nowrap;
}

.dead-row__action { display: flex; flex: none; justify-content: flex-end; width: var(--pn-size-dead-col); }

.dead-row__note {
  display: flex;
  align-items: center;
  height: var(--pn-size-button-sm);
  font-size: var(--pn-text-footnote);
  white-space: nowrap;
}

.dead-row__note--muted { color: var(--pn-text3); }
.dead-row__note--brand { color: var(--pn-brand-text); }
.dead-row__note--warning { color: var(--pn-warning); }
.dead-row__note--danger { color: var(--pn-danger); }

.dead-row__more {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-icon-button);
  height: var(--pn-size-icon-button);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text2);
  cursor: pointer;
}

.dead-row__more:hover,
.dead-row__more[data-state="open"] { background: var(--pn-selected); }
.dead-row--busy .dead-row__more { visibility: hidden; }

.dead-row__divider {
  position: absolute;
  right: var(--pn-space-12);
  bottom: 0;
  left: var(--pn-space-dead-divider);
  height: 1px;
  background: var(--pn-border);
}

/* 行内按钮左右 12（设计稿；PnButton 小号默认 10） */
.dead-row__action .pn-button { padding: 0 var(--pn-space-12); }
</style>
