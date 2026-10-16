<script setup lang="ts">
// 窄窗口图标栏 56px（HomeScreen.dc.html collapsed）：悬停出名字气泡，当前页图标用蓝色
import BrandMark from '@/components/biz/BrandMark.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnTooltip from '@/components/pn/PnTooltip.vue';
import { uiPlatform } from '@/utils/platform';
import { MAIN_NAV, SETTINGS_NAV, type NavBadge, type NavItem, type PageKey } from './navItems';

defineProps<{
  current: PageKey | undefined;
  badges: Partial<Record<PageKey, NavBadge>>;
  /** 窗口窄于 1000px 时强制收起，不给「展开」 */
  canExpand: boolean;
}>();

defineEmits<{
  navigate: [item: NavItem];
  expand: [];
}>();

const isMac = uiPlatform() === 'macos';
</script>

<template>
  <nav class="nav-rail" aria-label="主导航（已收起）">
    <!-- macOS：这一行由系统红绿灯占用 -->
    <div class="nav-rail__logo" data-tauri-drag-region>
      <BrandMark v-if="!isMac" :size="20" />
    </div>

    <slot name="search" />

    <PnTooltip v-for="item in MAIN_NAV" :key="item.key" :text="item.label" side="right" :side-offset="10">
      <a
        href="#"
        class="nav-rail__item"
        :class="{ 'nav-rail__item--active': current === item.key }"
        :aria-label="item.label"
        :aria-current="current === item.key ? 'page' : undefined"
        @click.prevent="$emit('navigate', item)"
      >
        <PnIcon :name="item.icon" />
        <span v-if="badges[item.key]" class="nav-rail__dot" :class="`nav-rail__dot--${badges[item.key]}`" />
      </a>
    </PnTooltip>

    <div class="nav-rail__spacer" />

    <PnTooltip :text="SETTINGS_NAV.label" side="right" :side-offset="10">
      <a
        href="#"
        class="nav-rail__item"
        :class="{ 'nav-rail__item--active': current === SETTINGS_NAV.key }"
        :aria-label="SETTINGS_NAV.label"
        :aria-current="current === SETTINGS_NAV.key ? 'page' : undefined"
        @click.prevent="$emit('navigate', SETTINGS_NAV)"
      >
        <PnIcon :name="SETTINGS_NAV.icon" />
        <span v-if="badges.settings" class="nav-rail__dot" :class="`nav-rail__dot--${badges.settings}`" />
      </a>
    </PnTooltip>
    <PnTooltip v-if="canExpand" text="展开侧栏" side="right" :side-offset="10">
      <button type="button" class="nav-rail__item nav-rail__expand" aria-label="展开侧栏" @click="$emit('expand')">
        <PnIcon name="sidebar" />
      </button>
    </PnTooltip>
  </nav>
</template>

<style scoped>
.nav-rail {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  gap: var(--pn-space-4);
  width: var(--pn-size-nav-rail);
  padding: 0 0 var(--pn-space-12);
  background: var(--pn-sidebar);
  user-select: none;
}

.nav-rail__logo {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  height: var(--pn-size-logo-row);
}

.nav-rail__spacer { flex: 1; }

.nav-rail__item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-rail-item);
  height: var(--pn-size-rail-item);
  border-radius: var(--pn-radius-rail-item);
  color: var(--pn-nav-text);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.nav-rail__item:hover { background: var(--pn-row-hover); }

.nav-rail__item--active,
.nav-rail__item--active:hover {
  background: var(--pn-selected);
  color: var(--pn-brand-text);
}

.nav-rail__expand {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pn-text3);
}

.nav-rail__dot {
  position: absolute;
  top: var(--pn-space-6);
  right: var(--pn-space-6);
  width: var(--pn-size-status-dot);
  height: var(--pn-size-status-dot);
  border-radius: 50%;
}

.nav-rail__dot--warning { background: var(--pn-warning-fill); }
.nav-rail__dot--brand { background: var(--pn-brand); }
</style>
