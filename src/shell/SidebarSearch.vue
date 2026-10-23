<script setup lang="ts">
// 侧栏搜索框（HomeScreen.dc.html）：点开命令面板（Ctrl K / ⌘ K）；收起成图标栏时是一个搜索图标
import PnIcon from '@/components/pn/PnIcon.vue';
import PnTooltip from '@/components/pn/PnTooltip.vue';
import { uiPlatform } from '@/utils/platform';
import { useCommandPalette } from './useCommandPalette';

defineProps<{ rail?: boolean }>();

const palette = useCommandPalette();
const keys = uiPlatform() === 'macos' ? '⌘K' : 'Ctrl+K';
</script>

<template>
  <PnTooltip v-if="rail" :text="`搜索  ${keys}`" side="right" :side-offset="10">
    <button type="button" class="sidebar-search-rail" aria-label="搜索" @click="palette.show()">
      <PnIcon name="search" :size="16" :stroke="1.8" />
    </button>
  </PnTooltip>
  <button v-else type="button" class="sidebar-search" @click="palette.show()">
    <PnIcon name="search" :size="14" :stroke="1.8" />
    <span class="sidebar-search__label">搜索</span>
    <span class="sidebar-search__keys">{{ keys }}</span>
  </button>
</template>

<style scoped>
.sidebar-search {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-8);
  height: var(--pn-size-search-box);
  margin-bottom: var(--pn-space-sidebar-search-after);
  padding: 0 var(--pn-space-8) 0 var(--pn-space-sidebar-x);
  border: 0;
  border-radius: var(--pn-radius-md);
  background: var(--pn-search-bg);
  box-shadow: inset 0 0 0 1px var(--pn-hairline);
  color: var(--pn-text3);
  font: inherit;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 设计稿里是链接（<a>），用小手 */
  cursor: pointer;
  transition: box-shadow var(--pn-dur-instant) var(--pn-ease-in), color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 悬停：细框加深、字变深一级（设计稿未画），提示这里点得开 */
.sidebar-search:hover { box-shadow: inset 0 0 0 1px var(--pn-border-strong); color: var(--pn-text2); }

.sidebar-search__label { flex: 1; text-align: left; }
.sidebar-search__keys { font-size: var(--pn-text-caption); }

.sidebar-search-rail {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-rail-item);
  height: var(--pn-size-rail-item);
  margin-bottom: var(--pn-space-8);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-rail-item);
  background: transparent;
  color: var(--pn-nav-text);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 设计稿里是链接（<a>），用小手 */
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 同图标栏导航项的悬停色 */
.sidebar-search-rail:hover { background: var(--pn-nav-hover); }
</style>
