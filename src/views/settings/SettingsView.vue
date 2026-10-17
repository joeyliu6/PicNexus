<script setup lang="ts">
// 设置页（交接说明 8.5、SettingsScreen.dc.html）：二级栏 7 个分组 + 右侧限宽 680 的一列。
// 每组同一结构：页标题 + 一句说明 → 分组小标题 → 卡片 → 脚注。改动即保存，没有「保存」按钮。
// 图床的连接、凭证、启用只在图床页；这一页从不写图床配置（写入口见 useSettingsConfig）。
// 外部跳转（托盘、首页、命令面板）带 tab / section：切到那一组，那一行滚到眼前并浅蓝高亮一下。
import { computed, inject, nextTick, onActivated, onDeactivated, ref, watch, type Ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import TransferButton from '@/shell/TransferButton.vue';
import WindowControls from '@/shell/WindowControls.vue';
import { useSidebarCollapse } from '@/shell/useSidebarCollapse';
import { useAutoUpdate } from '@/composables/useAutoUpdate';
import { createLogger } from '@/utils/logger';
import AboutGroup from './AboutGroup.vue';
import BackupGroup from './BackupGroup.vue';
import EditorGroup from './EditorGroup.vue';
import GeneralGroup from './GeneralGroup.vue';
import PrivacyGroup from './PrivacyGroup.vue';
import SettingsNav from './SettingsNav.vue';
import ShortcutGroup from './ShortcutGroup.vue';
import UploadGroup from './UploadGroup.vue';
import { SETTING_ROWS, SETTINGS_GROUPS, groupForTab, rowForSection, type SettingsGroupId } from './settingsGroups';
import { useSettingsConfig } from './useSettingsConfig';
import { useSettingsEffects } from './settingsEffects';
import { useCloudSync } from './useCloudSync';

const log = createLogger('SettingsView');

/** 跳来的那一行高亮多久 */
const HIGHLIGHT_MS = 1500;

const settings = useSettingsConfig();
const effects = useSettingsEffects();
const { narrow } = useSidebarCollapse();
const { hasAvailableUpdate } = useAutoUpdate();
const { needsReload } = useCloudSync();

const groupId = ref<SettingsGroupId>('general');
const group = computed(() => SETTINGS_GROUPS.find((g) => g.id === groupId.value)!);
const scroller = ref<HTMLElement>();
const active = ref(false);

let highlighted: Element | null = null;
let highlightTimer: ReturnType<typeof setTimeout> | undefined;

const targetTab = inject<Ref<string | null> | null>('settingsTargetTab', null);
const targetSection = inject<Ref<string | null> | null>('settingsTargetSection', null);

function reloadApp(): void {
  location.reload();
}

function select(id: SettingsGroupId): void {
  if (groupId.value === id) return;
  groupId.value = id;
  scroller.value?.scrollTo({ top: 0 });
}

async function applyTarget(): Promise<void> {
  const tab = targetTab?.value ?? null;
  const row = rowForSection(targetSection?.value);
  if (!tab && !row) return;
  if (targetTab) targetTab.value = null;
  if (targetSection) targetSection.value = null;
  const target = row ? SETTING_ROWS[row] : groupForTab(tab);
  if (target) select(target);
  if (!row) return;
  await nextTick();
  const element = scroller.value?.querySelector(`[data-setting-row="${row}"]`);
  if (!element) return;
  element.scrollIntoView({ block: 'center' });
  clearTimeout(highlightTimer);
  highlighted?.classList.remove('settings-flash');
  highlighted = element;
  element.classList.add('settings-flash');
  highlightTimer = setTimeout(() => { element.classList.remove('settings-flash'); }, HIGHLIGHT_MS);
}

// 别的窗口（托盘）或图床页改了配置：这一页显示的值跟着换
let unlisten: UnlistenFn | null = null;
onActivated(async () => {
  active.value = true;
  unlisten ??= await listen('config-updated', () => { void settings.reload(); });
  await Promise.all([settings.reload(), effects.readAutoStart()]).catch((error) => log.warn('读取设置失败', error));
  await applyTarget();
});
onDeactivated(() => {
  active.value = false;
  unlisten?.();
  unlisten = null;
});
watch(() => [targetTab?.value, targetSection?.value], () => { if (active.value) void applyTarget(); });
</script>

<template>
  <div class="settings">
    <SettingsNav :current="groupId" :update-dot="hasAvailableUpdate" :narrow="narrow" @select="select" />
    <section class="settings__main" :aria-label="group.name">
      <header class="settings__bar" data-tauri-drag-region>
        <div class="settings__spacer" data-tauri-drag-region />
        <TransferButton />
        <WindowControls />
      </header>
      <div ref="scroller" class="settings__scroll" :class="{ 'settings__scroll--narrow': narrow }">
        <div class="settings__column">
          <div class="settings__head">
            <h1 class="settings__title">{{ group.name }}</h1>
            <span class="settings__sub">{{ group.sub }}</span>
          </div>
          <div v-if="needsReload" class="settings__banner" role="status">
            <PnIcon class="settings__banner-icon" name="cloudDownload" :size="16" :stroke="1.8" />
            <span class="settings__banner-text"><b>{{ needsReload === 'cloud' ? '云端配置已下载' : '配置已导入' }}</b>，刷新后生效。</span>
            <PnButton variant="primary" size="md" @click="reloadApp">刷新</PnButton>
          </div>
          <GeneralGroup v-if="groupId === 'general'" />
          <UploadGroup v-else-if="groupId === 'upload'" />
          <ShortcutGroup v-else-if="groupId === 'shortcut'" />
          <EditorGroup v-else-if="groupId === 'editor'" />
          <BackupGroup v-else-if="groupId === 'backup'" />
          <PrivacyGroup v-else-if="groupId === 'privacy'" />
          <AboutGroup v-else />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  height: 100%;
  min-height: 0;
}

.settings__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.settings__bar {
  display: flex;
  flex: none;
  align-items: center;
  height: var(--pn-size-title-bar);
  user-select: none;
}

.settings__spacer { flex: 1; align-self: stretch; }

.settings__scroll {
  flex: 1;
  min-height: 0;
  padding: var(--pn-space-settings-page);
  overflow-y: auto;
}

.settings__scroll--narrow { padding: var(--pn-space-settings-page-narrow); }

.settings__column {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-24);
  width: 100%;
  max-width: var(--pn-size-settings-column);
  margin: 0 auto;
}

.settings__head {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-2);
  padding-top: var(--pn-space-4);
}

.settings__title {
  margin: 0;
  font-size: var(--pn-text-title);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-title);
  letter-spacing: var(--pn-tracking-title);
}

.settings__sub { color: var(--pn-text3); }

/* 刷新横幅（S15）：放在页标题下方、与内容同宽，直到刷新为止 */
.settings__banner {
  display: flex;
  align-items: center;
  gap: var(--pn-space-12);
  padding: var(--pn-space-settings-banner);
  border-radius: var(--pn-radius-settings-card);
  background: var(--pn-brand-soft);
}

.settings__banner-icon { flex: none; color: var(--pn-brand-text); }
.settings__banner-text { flex: 1; }
.settings__banner-text b { font-weight: var(--pn-weight-semibold); }
</style>

<!-- 命令面板跳来的那一项（行、卡片、外观三卡都可能）：浅蓝底 + 外环闪 1.5 秒；类名加在各组件的根元素上，不能 scoped -->
<style>
.settings-flash {
  background-color: var(--pn-brand-soft);
  box-shadow: 0 0 0 var(--pn-ring-soft-width) var(--pn-ring-soft);
  transition: background-color var(--pn-dur-standard) var(--pn-ease-in), box-shadow var(--pn-dur-standard) var(--pn-ease-in);
}
</style>
