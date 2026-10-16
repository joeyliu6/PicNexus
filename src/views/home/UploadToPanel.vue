<script setup lang="ts">
// 「上传到」面板（HomeScreen.dc.html H11 / H19 / H21）：图床做成轻量标签，点选多选。
// 勾选的图床同时上传，复制最先完成的链接（可固定某一个）；不排序、不设主链接、不推荐图床。
// 已选的排最前（面板打开期间不跳动）；超过 6 个出现搜索，标签区固定高度内部滚动。
// oneOff = 全部失败时「换个图床」：只对这一张生效，选好后点「上传这一张」，不改平时的勾选。
import { computed, ref } from 'vue';
import HostIcon from '@/components/biz/HostIcon.vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuRadioGroup from '@/components/pn/PnMenuRadioGroup.vue';
import type { UploadHost } from '@/composables/upload/useUploadController';

const props = withDefaults(defineProps<{
  hosts: readonly UploadHost[];
  copyFrom?: string;
  oneOff?: boolean;
}>(), { copyFrom: undefined, oneOff: false });

const emit = defineEmits<{
  toggle: [hostId: string];
  setCopyFrom: [hostId: string | undefined];
  manage: [];
  relogin: [hostId: string];
  uploadOneOff: [hostIds: string[]];
}>();

const SEARCH_THRESHOLD = 6;
const FIRST_FINISHED = '';

// 打开那一刻定下顺序：已选的在前，之后点选不挪位置
const order = [...props.hosts].sort((a, b) => Number(b.selected) - Number(a.selected)).map((host) => host.id);
const query = ref('');
const localPicks = ref<string[]>([]);

const shown = computed(() => {
  const byId = new Map(props.hosts.map((host) => [host.id, host]));
  const ids = [...order.filter((id) => byId.has(id)), ...props.hosts.map((h) => h.id).filter((id) => !order.includes(id))];
  const keyword = query.value.trim().toLowerCase();
  return ids
    .map((id) => byId.get(id)!)
    .filter((host) => !keyword || host.name.toLowerCase().includes(keyword))
    .map((host) => ({ ...host, on: props.oneOff ? localPicks.value.includes(host.id) : host.selected }));
});

const many = computed(() => props.hosts.length > SEARCH_THRESHOLD);
const selectedCount = computed(() => (props.oneOff ? localPicks.value.length : props.hosts.filter((h) => h.selected).length));
const countLabel = computed(() => `已选 ${selectedCount.value}${many.value ? ` / ${props.hosts.length}` : ''}`);
const warned = computed(() => props.hosts.filter((h) => h.selected && h.warning));

const copyFromOptions = computed(() => [
  { value: FIRST_FINISHED, label: '最先完成的链接' },
  ...props.hosts.filter((h) => h.selected).map((h) => ({ value: h.id, label: `${h.name}的链接` })),
]);
const copyFromLabel = computed(() => copyFromOptions.value.find((o) => o.value === (props.copyFrom ?? FIRST_FINISHED))?.label ?? '最先完成的链接');
const copyFromModel = computed({
  get: () => props.copyFrom ?? FIRST_FINISHED,
  set: (value: string) => emit('setCopyFrom', value === FIRST_FINISHED ? undefined : value),
});

function onChip(hostId: string) {
  if (!props.oneOff) {
    emit('toggle', hostId);
    return;
  }
  localPicks.value = localPicks.value.includes(hostId) ? localPicks.value.filter((id) => id !== hostId) : [...localPicks.value, hostId];
}
</script>

<template>
  <div class="upload-to" :class="{ 'upload-to--wide': many }">
    <div class="upload-to__head">
      <span class="upload-to__title">{{ oneOff ? '换个图床' : '上传到' }}</span>
      <span class="upload-to__count">{{ countLabel }}</span>
      <div class="upload-to__spacer" />
      <span class="upload-to__count">{{ oneOff ? '只对这一张生效' : '点选即可，可多选' }}</span>
    </div>

    <label v-if="many" class="upload-to__search">
      <PnIcon name="search" :size="13" :stroke="1.8" />
      <input v-model="query" class="upload-to__search-input" placeholder="搜索图床" aria-label="搜索图床">
    </label>

    <div class="upload-to__chips-wrap" :class="{ 'upload-to__chips-wrap--scroll': many }">
      <div class="upload-to__chips">
        <button
          v-for="host in shown"
          :key="host.id"
          type="button"
          role="checkbox"
          class="upload-to__chip"
          :class="{ 'upload-to__chip--on': host.on }"
          :aria-checked="host.on"
          :title="host.warning ?? undefined"
          @click="onChip(host.id)"
        >
          <HostIcon :host="host.id" :name="host.name" :size="15" class="upload-to__chip-icon" />
          {{ host.name }}
          <span v-if="host.warning" class="upload-to__dot" aria-hidden="true" />
          <PnIcon v-if="host.on" name="check" :size="11" :stroke="2.4" />
        </button>
      </div>
    </div>

    <div v-for="host in warned" :key="host.id" class="upload-to__warn">
      <span class="upload-to__dot" aria-hidden="true" />
      <span class="upload-to__warn-text">{{ host.name }}{{ host.cookieLogin ? host.warning : `：${host.warning}` }}，暂时传不上</span>
      <button v-if="host.cookieLogin" type="button" class="upload-to__link" @click="emit('relogin', host.id)">重新登录</button>
    </div>

    <div class="upload-to__rule" />

    <div v-if="oneOff" class="upload-to__foot">
      <div class="upload-to__spacer" />
      <PnButton variant="primary" size="sm" :disabled="localPicks.length === 0" @click="emit('uploadOneOff', [...localPicks])">上传这一张</PnButton>
    </div>
    <div v-else class="upload-to__foot">
      <span class="upload-to__muted">复制</span>
      <PnMenu align="start" :width="220">
        <template #trigger>
          <button type="button" class="upload-to__copy-from" title="也可以固定为某个图床的链接">
            {{ copyFromLabel }}
            <PnIcon name="chevronDown" :size="11" :stroke="1.8" class="upload-to__muted" />
          </button>
        </template>
        <PnMenuRadioGroup v-model="copyFromModel" :options="copyFromOptions" />
      </PnMenu>
      <div class="upload-to__spacer" />
      <button type="button" class="upload-to__link upload-to__manage" @click="emit('manage')">
        管理图床
        <PnIcon name="chevronRight" :size="11" :stroke="1.8" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.upload-to {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-12);
  width: var(--pn-size-upload-to-panel);
  max-width: 100%;
  box-sizing: border-box;
  padding: var(--pn-space-6) var(--pn-space-6) var(--pn-space-2);
}

.upload-to--wide { width: var(--pn-size-upload-to-panel-wide); }

.upload-to__head { display: flex; align-items: baseline; gap: var(--pn-space-6); }
.upload-to__title { font-weight: var(--pn-weight-semibold); }
.upload-to__count { font-size: var(--pn-text-footnote); color: var(--pn-text3); }
.upload-to__spacer { flex: 1; }

.upload-to__search {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  height: var(--pn-size-button-md);
  box-sizing: border-box;
  padding: 0 var(--pn-space-sidebar-x);
  border-radius: var(--pn-radius-md);
  background: var(--pn-subtle);
  color: var(--pn-text3);
}

.upload-to__search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-footnote);
}

.upload-to__chips-wrap { position: relative; }

.upload-to__chips-wrap--scroll {
  max-height: var(--pn-size-upload-to-scroll);
  overflow-y: auto;
  mask-image: linear-gradient(180deg, var(--pn-mask-solid) calc(100% - var(--pn-size-chip)), transparent);
}

.upload-to__chips { display: flex; flex-wrap: wrap; gap: var(--pn-space-6); }

.upload-to__chip {
  display: flex;
  align-items: center;
  gap: var(--pn-space-6);
  height: var(--pn-size-host-chip);
  padding: 0 var(--pn-space-12) 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-size-host-chip);
  background: var(--pn-subtle);
  color: var(--pn-text2);
  font: inherit;
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.upload-to__chip-icon { color: var(--pn-text3); }

.upload-to__chip--on {
  padding-right: var(--pn-space-sidebar-x);
  background: var(--pn-chip-on);
  color: var(--pn-brand-text);
  font-weight: var(--pn-weight-medium);
}

.upload-to__chip--on .upload-to__chip-icon { color: var(--pn-brand-text); }

.upload-to__dot {
  flex: none;
  width: var(--pn-size-status-dot);
  height: var(--pn-size-status-dot);
  border-radius: 50%;
  background: var(--pn-warning-fill);
}

.upload-to__warn {
  display: flex;
  align-items: center;
  gap: var(--pn-space-6);
  font-size: var(--pn-text-footnote);
  color: var(--pn-text2);
}

.upload-to__warn-text { flex: 1; }

.upload-to__rule {
  height: 1px;
  margin: 0 calc(-1 * var(--pn-space-12));
  background: var(--pn-border);
}

.upload-to__foot {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  font-size: var(--pn-text-footnote);
}

.upload-to__muted { color: var(--pn-text3); }

.upload-to__copy-from {
  display: flex;
  align-items: center;
  gap: var(--pn-space-4);
  height: var(--pn-size-icon-button);
  margin-left: calc(-1 * var(--pn-space-4));
  padding: 0 var(--pn-space-6);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-footnote);
  cursor: pointer;
}

.upload-to__copy-from:hover { background: var(--pn-selected); }

.upload-to__link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pn-brand-text);
  font: inherit;
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
  cursor: pointer;
}

.upload-to__manage { display: flex; align-items: center; gap: var(--pn-space-2); font-weight: var(--pn-weight-regular); }
</style>
