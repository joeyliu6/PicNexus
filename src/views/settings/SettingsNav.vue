<script setup lang="ts">
// 设置的二级栏（SettingsScreen.dc.html）：顶部「设置」标题（与图床页一致，不放搜索框——命令面板能搜到每一项），
// 下面 7 个分组；有新版本时「关于」旁一个品牌蓝小点（交接说明 8.5）。窄窗口宽 176。
import PnIcon from '@/components/pn/PnIcon.vue';
import { SETTINGS_GROUPS, type SettingsGroupId } from './settingsGroups';

defineProps<{
  current: SettingsGroupId;
  /** 「关于」旁的小点 */
  updateDot: boolean;
  narrow: boolean;
}>();

defineEmits<{ select: [id: SettingsGroupId] }>();
</script>

<template>
  <nav class="settings-nav" :class="{ 'settings-nav--narrow': narrow }" aria-label="设置分组">
    <div class="settings-nav__head" data-tauri-drag-region>
      <span class="settings-nav__title" data-tauri-drag-region>设置</span>
    </div>
    <button
      v-for="group in SETTINGS_GROUPS"
      :key="group.id"
      type="button"
      class="settings-nav__item"
      :class="{ 'settings-nav__item--on': group.id === current }"
      :aria-current="group.id === current ? 'page' : undefined"
      @click="$emit('select', group.id)"
    >
      <PnIcon class="settings-nav__icon" :name="group.icon" :size="16" :stroke="1.7" />
      <span class="settings-nav__name">{{ group.name }}</span>
      <span v-if="group.id === 'about' && updateDot" class="settings-nav__dot" aria-label="有新版本" />
    </button>
  </nav>
</template>

<style scoped>
.settings-nav {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--pn-space-2);
  width: var(--pn-size-settings-nav);
  box-sizing: border-box;
  padding: var(--pn-space-settings-nav);
  border-right: 1px solid var(--pn-border);
  overflow-y: auto;
}

.settings-nav--narrow { width: var(--pn-size-settings-nav-narrow); }

.settings-nav__head {
  display: flex;
  flex: none;
  align-items: center;
  height: var(--pn-size-title-bar);
  margin: var(--pn-space-settings-nav-head);
  padding-left: var(--pn-space-8);
}

.settings-nav__title {
  font-size: var(--pn-text-headline);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-headline);
  letter-spacing: var(--pn-tracking-headline);
}

.settings-nav__item {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-nav-icon-gap);
  height: var(--pn-size-settings-nav-item);
  padding: 0 var(--pn-space-sidebar-x);
  border: 0;
  border-radius: var(--pn-radius-md);
  background: transparent;
  color: var(--pn-text2);
  font: inherit;
  text-align: left;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 设计稿里是链接（<a>），用小手 */
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 点了就选中，选中态立刻出现，不另加按下色。悬停只变底色；文字、图标颜色只在选中时变，不带过渡
   （带了的话切换深浅色时这一列字会比整页慢半拍，先暗后亮闪一下） */
.settings-nav__item:hover { background: var(--pn-host-row-hover); }

.settings-nav__item--on,
.settings-nav__item--on:hover {
  background: var(--pn-selected);
  color: var(--pn-text1);
  font-weight: var(--pn-weight-medium);
}

.settings-nav__icon { flex: none; color: var(--pn-text3); }
.settings-nav__item--on .settings-nav__icon { color: var(--pn-brand-text); }

.settings-nav__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-nav__dot {
  flex: none;
  width: var(--pn-size-status-dot);
  height: var(--pn-size-status-dot);
  margin-left: auto;
  border-radius: 50%;
  background: var(--pn-brand);
}
</style>
