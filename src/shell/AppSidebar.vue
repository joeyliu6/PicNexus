<script setup lang="ts">
// 侧栏 208px（HomeScreen.dc.html）：Logo 行 52 → 搜索（命令面板）→ 导航 → 底部设置 + 收起
import BrandMark from '@/components/biz/BrandMark.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import { uiPlatform } from '@/utils/platform';
import { MAIN_NAV, SETTINGS_NAV, type NavBadge, type NavItem, type PageKey } from './navItems';
import SidebarSearch from './SidebarSearch.vue';

defineProps<{
  current: PageKey | undefined;
  badges: Partial<Record<PageKey, NavBadge>>;
  /** 拖着会上传的图片进窗口：Logo 花瓣张开（M07） */
  receiving: boolean;
}>();

defineEmits<{
  navigate: [item: NavItem];
  collapse: [];
}>();

const isMac = uiPlatform() === 'macos';
const collapseTitle = `收起侧栏  ${isMac ? '⌘' : 'Ctrl+'}\\`;
</script>

<template>
  <nav class="app-sidebar" aria-label="主导航">
    <!-- macOS：这一行由系统红绿灯占用 -->
    <div class="app-sidebar__logo" data-tauri-drag-region>
      <template v-if="!isMac">
        <BrandMark :size="18" :open="receiving" />
        <span class="app-sidebar__name" data-tauri-drag-region>PicNexus</span>
      </template>
    </div>

    <SidebarSearch />

    <div class="app-sidebar__list">
      <a
        v-for="item in MAIN_NAV"
        :key="item.key"
        href="#"
        class="app-sidebar__item"
        :class="{ 'app-sidebar__item--active': current === item.key }"
        :aria-current="current === item.key ? 'page' : undefined"
        @click.prevent="$emit('navigate', item)"
      >
        <PnIcon :name="item.icon" class="app-sidebar__icon" />
        {{ item.label }}
        <span v-if="badges[item.key]" class="app-sidebar__dot" :class="`app-sidebar__dot--${badges[item.key]}`" />
      </a>
    </div>

    <div class="app-sidebar__spacer" />

    <a
      href="#"
      class="app-sidebar__item"
      :class="{ 'app-sidebar__item--active': current === SETTINGS_NAV.key }"
      :aria-current="current === SETTINGS_NAV.key ? 'page' : undefined"
      @click.prevent="$emit('navigate', SETTINGS_NAV)"
    >
      <PnIcon :name="SETTINGS_NAV.icon" class="app-sidebar__icon" />
      {{ SETTINGS_NAV.label }}
      <span v-if="badges.settings" class="app-sidebar__dot" :class="`app-sidebar__dot--${badges.settings}`" />
    </a>
    <button type="button" class="app-sidebar__item app-sidebar__collapse" aria-label="收起侧栏" :title="collapseTitle" @click="$emit('collapse')">
      <PnIcon name="sidebar" />
      收起
    </button>
  </nav>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex: none;
  flex-direction: column;
  width: var(--pn-size-sidebar);
  padding: 0 var(--pn-space-sidebar-x) var(--pn-space-12);
  background: var(--pn-sidebar);
}

.app-sidebar__logo {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-8);
  height: var(--pn-size-logo-row);
  padding-left: var(--pn-space-8);
}

.app-sidebar__name {
  font-size: var(--pn-text-body);
  font-weight: var(--pn-weight-semibold);
  letter-spacing: var(--pn-tracking-headline);
}

.app-sidebar__list {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-2);
}

.app-sidebar__spacer { flex: 1; }

.app-sidebar__item {
  display: flex;
  align-items: center;
  gap: var(--pn-space-nav-icon-gap);
  height: var(--pn-size-nav-item);
  padding: 0 var(--pn-space-sidebar-x);
  border-radius: var(--pn-radius-md);
  color: var(--pn-nav-text);
  text-decoration: none;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in), color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 悬停比当前页浅一半，鼠标停在别的项上时分得清哪个是当前页 */
.app-sidebar__item:hover { background: var(--pn-nav-hover); }

.app-sidebar__item--active,
.app-sidebar__item--active:hover {
  background: var(--pn-selected);
  color: var(--pn-text1);
  font-weight: var(--pn-weight-medium);
}

.app-sidebar__item--active .app-sidebar__icon { color: var(--pn-brand-text); }

.app-sidebar__collapse {
  border: 0;
  background: transparent;
  color: var(--pn-text3);
  font: inherit;
  font-size: var(--pn-text-footnote);
  text-align: left;
  cursor: pointer;
}

.app-sidebar__collapse:hover { color: var(--pn-nav-text); }
.app-sidebar__collapse:active { background: var(--pn-selected); }

.app-sidebar__dot {
  width: var(--pn-size-status-dot);
  height: var(--pn-size-status-dot);
  margin-left: auto;
  border-radius: 50%;
}

.app-sidebar__dot--warning { background: var(--pn-warning-fill); }
.app-sidebar__dot--brand { background: var(--pn-brand); }
</style>
