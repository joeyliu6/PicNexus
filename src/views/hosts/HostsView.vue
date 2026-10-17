<script setup lang="ts">
// 图床页（交接说明 8.4、HostsScreen.dc.html）：宽窗口双栏——左栏已添加的图床，右侧详情 / 添加图床目录 / 连接表单，限宽居中；
// 窗口窄于 1000px 时两级（P14 / P15）：清单占满主栏 → 点进整页详情，左上「‹ 图床」返回，Esc / Alt+← 同样返回。
// 外部跳转（托盘、首页「去图床页」带 section = 图床 id）选中那个图床；链接健康「添加图床」带 ?add 打开目录。
import { computed, inject, onActivated, onDeactivated, ref, watch, type Ref } from 'vue';
import { useEventListener } from '@vueuse/core';
import { useRoute, useRouter } from 'vue-router';
import PnIcon from '@/components/pn/PnIcon.vue';
import TransferButton from '@/shell/TransferButton.vue';
import WindowControls from '@/shell/WindowControls.vue';
import { useSidebarCollapse } from '@/shell/useSidebarCollapse';
import HostCatalog from './HostCatalog.vue';
import HostDetail from './HostDetail.vue';
import HostsList from './HostsList.vue';
import { useHosts } from './useHosts';

const hosts = useHosts();
const { narrow } = useSidebarCollapse();
const route = useRoute();
const router = useRouter();
const settingsTargetSection = inject<Ref<string | null> | null>('settingsTargetSection', null);
const active = ref(false);

const showList = computed(() => !narrow.value || !hosts.narrowDetail.value);
const showMain = computed(() => !narrow.value || hosts.narrowDetail.value);
const detailId = computed(() => (hosts.pane.value === 'detail' ? hosts.selectedId.value : null));

function applyTarget(): void {
  const section = settingsTargetSection?.value;
  if (section) {
    settingsTargetSection!.value = null;
    if (hosts.addedIds.value.has(section)) hosts.select(section);
    else hosts.openConnect(section);
  }
  if (route.query.add !== undefined) {
    hosts.openCatalog();
    void router.replace({ path: route.path });
  }
}

onActivated(async () => {
  active.value = true;
  await hosts.enter();
  applyTarget();
});
onDeactivated(() => { active.value = false; });
if (settingsTargetSection) watch(settingsTargetSection, (value) => { if (value && active.value) applyTarget(); });

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!active.value || event.defaultPrevented) return;
  if (document.querySelector('.pn-layer[data-state="open"], .command-palette[data-state="open"]')) return;
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  const back = event.key === 'Escape' || (event.altKey && event.key === 'ArrowLeft');
  if (!back) return;
  if (narrow.value && hosts.narrowDetail.value) {
    event.preventDefault();
    hosts.back();
  } else if (!narrow.value && hosts.pane.value === 'connect' && event.key === 'Escape') {
    event.preventDefault();
    hosts.back();
  } else if (!narrow.value && hosts.pane.value === 'catalog' && event.key === 'Escape' && hosts.rows.value.length) {
    event.preventDefault();
    hosts.closeCatalog();
  }
});
</script>

<template>
  <div class="hosts" :class="{ 'hosts--narrow': narrow }">
    <HostsList
      v-if="showList"
      :rows="hosts.rows.value"
      :selected-id="hosts.pane.value === 'detail' ? hosts.selectedId.value : null"
      :adding="hosts.pane.value !== 'detail'"
      :list-only="narrow"
      @select="hosts.select"
      @add="hosts.openCatalog"
      @toggle="hosts.toggleEnabled"
    />
    <section v-if="showMain" class="hosts__main" aria-label="图床详情">
      <header class="hosts__bar" data-tauri-drag-region>
        <button v-if="narrow" type="button" class="hosts__back" @click="hosts.back()">
          <PnIcon name="chevronLeft" :size="16" :stroke="2" />图床
        </button>
        <div class="hosts__spacer" data-tauri-drag-region />
        <TransferButton />
        <WindowControls />
      </header>
      <div class="hosts__scroll">
        <div class="hosts__column">
          <HostCatalog
            v-if="hosts.pane.value === 'catalog'"
            :added-ids="hosts.addedIds.value"
            :narrow="narrow"
            :closable="hosts.rows.value.length > 0 && !narrow"
            @pick="hosts.openConnect"
            @close="hosts.closeCatalog"
          />
          <!-- 连接表单与详情各用各的 key：新连上的多份图床两边是同一个 id，分开 key 保证连上后换一个新实例 -->
          <HostDetail
            v-else-if="hosts.pane.value === 'connect' && hosts.draft.value"
            :key="`draft-${hosts.draft.value.hostId}`"
            :host-id="hosts.draft.value.hostId"
            :draft="true"
            :narrow="narrow"
          />
          <HostDetail
            v-else-if="detailId"
            :key="`host-${detailId}`"
            :host-id="detailId"
            :draft="false"
            :narrow="narrow"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hosts {
  display: flex;
  height: 100%;
  min-height: 0;
}

.hosts__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.hosts__bar {
  display: flex;
  flex: none;
  align-items: center;
  height: var(--pn-size-title-bar);
  user-select: none;
}

.hosts__spacer { flex: 1; align-self: stretch; }

.hosts__back {
  display: flex;
  align-items: center;
  gap: var(--pn-space-2);
  height: var(--pn-size-button-sm);
  margin-left: var(--pn-space-12);
  padding: var(--pn-space-host-back);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-brand-text);
  font: inherit;
  cursor: pointer;
}

.hosts__back:hover { background: var(--pn-host-row-hover); }

.hosts__scroll {
  display: flex;
  flex: 1;
  justify-content: center;
  min-height: 0;
  overflow-y: auto;
}

.hosts__column {
  width: 100%;
  max-width: var(--pn-size-host-detail);
  box-sizing: border-box;
  padding: var(--pn-space-host-detail);
}
</style>
