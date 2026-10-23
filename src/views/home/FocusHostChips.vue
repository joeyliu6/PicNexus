<script setup lang="ts">
// 焦点卡「按图床复制」那一排（CopyMulti.dc.html）：每个已完成的图床一枚，4 个以上只露前 3 个，其余收进「+N」。
// 点一枚原地变绿色「已复制」1.5 秒（不弹通知），即使那一份就是自动复制的那份；自动复制的那枚平时带 ✓。
import { computed } from 'vue';
import HostIcon from '@/components/biz/HostIcon.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnPopover from '@/components/pn/PnPopover.vue';
import { useCopyBadgeFeedback } from '@/composables/useCopyBadgeFeedback';
import { vOverflowTitle } from '@/utils/overflowTitle';

const props = defineProps<{
  /** 已完成的图床，按图床顺序 */
  hostIds: readonly string[];
  nameOf: (hostId: string) => string;
  /** 自动复制的是哪一份 */
  autoCopiedId?: string;
}>();

const emit = defineEmits<{
  copyHost: [hostId: string];
  /** 「+N」里的「复制全部」：每个图床一条 */
  copyAll: [];
}>();

const { markCopied, isCopied } = useCopyBadgeFeedback(1500);

const SHOWN_HOSTS = 3;
const hosts = computed(() => props.hostIds.map((id) => ({ id })));
const shownHosts = computed(() => (hosts.value.length > SHOWN_HOSTS ? hosts.value.slice(0, SHOWN_HOSTS) : hosts.value));
const moreHosts = computed(() => (hosts.value.length > SHOWN_HOSTS ? hosts.value.slice(SHOWN_HOSTS) : []));

function copyHost(hostId: string): void {
  emit('copyHost', hostId);
  markCopied(hostId);
}

function copyAll(): void {
  emit('copyAll');
  markCopied('all');
}
</script>

<template>
  <div class="focus-chips">
    <span class="focus-chips__muted focus-chips__label">按图床复制</span>
    <button
      v-for="host in shownHosts"
      :key="host.id"
      type="button"
      class="focus-chips__chip"
      :class="{ 'focus-chips__chip--done': isCopied(host.id) }"
      :title="`复制 ${nameOf(host.id)} 链接`"
      @click="copyHost(host.id)"
    >
      <HostIcon :host="host.id" :name="nameOf(host.id)" :size="14" class="focus-chips__chip-icon" />
      {{ isCopied(host.id) ? '已复制' : nameOf(host.id) }}
      <PnIcon v-if="isCopied(host.id) || host.id === autoCopiedId" name="check" :size="12" :stroke="2.6" class="focus-chips__success" />
      <PnIcon v-else name="copy" :size="12" :stroke="1.9" class="focus-chips__muted" />
    </button>
    <!-- 「+N」是这一行最后一个，右对齐才不会伸出卡片 -->
    <PnPopover v-if="moreHosts.length" align="end" label="其他图床">
      <template #trigger>
        <button type="button" class="focus-chips__chip focus-chips__chip--more">
          +{{ moreHosts.length }}
          <PnIcon name="chevronDown" :size="11" :stroke="2.2" />
        </button>
      </template>
      <div class="focus-chips__more">
        <span class="focus-chips__more-title">其他 {{ moreHosts.length }} 个图床</span>
        <div v-for="host in moreHosts" :key="host.id" class="focus-chips__more-row">
          <HostIcon :host="host.id" :name="nameOf(host.id)" :size="16" class="focus-chips__chip-icon" />
          <span v-overflow-title class="focus-chips__more-name">{{ nameOf(host.id) }}</span>
          <span class="focus-chips__muted">正常</span>
          <button type="button" class="focus-chips__more-copy" :aria-label="`复制${nameOf(host.id)}的链接`" @click="copyHost(host.id)">
            <PnIcon :name="isCopied(host.id) ? 'check' : 'copy'" :size="12" :stroke="isCopied(host.id) ? 2.4 : 1.9" />
            {{ isCopied(host.id) ? '已复制' : '复制' }}
          </button>
        </div>
        <span class="focus-chips__more-line" />
        <button type="button" class="focus-chips__more-all" @click="copyAll">
          <PnIcon :name="isCopied('all') ? 'check' : 'copy'" :size="12" :stroke="isCopied('all') ? 2.4 : 1.9" />
          <span class="focus-chips__more-name">{{ isCopied('all') ? '已复制' : `复制全部 ${hostIds.length} 条（每行一条）` }}</span>
          <span class="focus-chips__muted">按图床顺序</span>
        </button>
      </div>
    </PnPopover>
  </div>
</template>

<style scoped>
.focus-chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pn-space-6); }
.focus-chips__label { margin-right: var(--pn-space-4); font-size: var(--pn-text-footnote); }

.focus-chips__chip {
  display: flex;
  align-items: center;
  gap: var(--pn-space-6);
  height: var(--pn-size-chip);
  padding: 0 var(--pn-space-sidebar-x) 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-size-chip);
  background: var(--pn-subtle);
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-footnote);
  transition: background-color var(--pn-dur-fast) var(--pn-ease-in), color var(--pn-dur-fast) var(--pn-ease-in);
}

.focus-chips__chip:hover { background: var(--pn-ghost-press); }
.focus-chips__chip:active { background: var(--pn-subtle-press); }

.focus-chips__chip--done,
.focus-chips__chip--done:hover,
.focus-chips__chip--done:active { background: var(--pn-success-soft); color: var(--pn-success); }
.focus-chips__chip-icon { color: var(--pn-text2); }

/* 「+N」展开的完整列表（CopyMulti.dc.html ②：宽 330、行高 36） */
.focus-chips__chip--more {
  gap: var(--pn-space-4);
  padding: 0 var(--pn-space-sidebar-x);
  background: var(--pn-selected);
  font-weight: var(--pn-weight-medium);
}

.focus-chips__chip--more[data-state='open'] { background: var(--pn-ghost-press); }

.focus-chips__more {
  display: flex;
  flex-direction: column;
  width: var(--pn-size-copy-more);
}

.focus-chips__more-title {
  padding: var(--pn-space-6) var(--pn-space-8) var(--pn-space-4);
  color: var(--pn-text3);
  font-size: var(--pn-text-caption);
  font-weight: var(--pn-weight-medium);
}

.focus-chips__more-row {
  display: flex;
  align-items: center;
  gap: var(--pn-space-copy-more-gap);
  height: var(--pn-size-copy-more-row);
  padding: 0 var(--pn-space-8);
  border-radius: var(--pn-radius-button-sm);
}

.focus-chips__more-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.focus-chips__more-copy {
  display: flex;
  align-items: center;
  gap: var(--pn-space-4);
  height: var(--pn-size-copy-more-button);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: var(--pn-subtle);
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-footnote);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.focus-chips__more-copy:hover { background: var(--pn-ghost-press); }
.focus-chips__more-copy:active { background: var(--pn-subtle-press); }

.focus-chips__more-line { height: 1px; margin: var(--pn-space-6) var(--pn-space-8); background: var(--pn-border); }

.focus-chips__more-all {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  height: var(--pn-size-button-lg);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  text-align: left;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.focus-chips__more-all:hover { background: var(--pn-menu-sel); }
.focus-chips__more-all:active { background: var(--pn-ghost-press); }

.focus-chips__muted { color: var(--pn-text3); }
.focus-chips__success { color: var(--pn-success); }
</style>
