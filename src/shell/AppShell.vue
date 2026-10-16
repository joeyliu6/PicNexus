<script setup lang="ts">
// 应用外壳（交接说明 3.1）：侧栏 208 / 窄窗口 56px 图标栏 + 主栏。
// 主栏铺满窗口；每个新页面自己画顶部标题行（含窗口按钮），尚未重写的旧页面由外壳代画。
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEventListener } from '@vueuse/core';
import { TooltipProvider } from 'reka-ui';
import AppSidebar from './AppSidebar.vue';
import NavRail from './NavRail.vue';
import TitleRow from './TitleRow.vue';
import { useSidebarCollapse } from './useSidebarCollapse';
import { useNavBadges } from './useNavBadges';
import { useAppNavigation } from './useAppNavigation';
import type { NavItem } from './navItems';

const route = useRoute();
const router = useRouter();
const { narrow, collapsed, toggle } = useSidebarCollapse();
const badges = useNavBadges();
useAppNavigation();

const currentPage = computed(() => route.meta.pageKey);
const legacyTitle = computed(() => route.meta.legacyTitle);

function navigate(item: NavItem): void {
  if (route.path !== item.path) void router.push(item.path);
}

// Ctrl+\（macOS ⌘\）手动收起 / 展开侧栏
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === '\\') {
    event.preventDefault();
    toggle();
  }
});
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="app-shell">
      <NavRail
        v-if="collapsed"
        :current="currentPage"
        :badges="badges"
        :can-expand="!narrow"
        @navigate="navigate"
        @expand="toggle"
      />
      <AppSidebar
        v-else
        :current="currentPage"
        :badges="badges"
        @navigate="navigate"
        @collapse="toggle"
      />
      <main class="app-shell__main">
        <TitleRow v-if="legacyTitle !== undefined" :title="legacyTitle || undefined" />
        <div class="app-shell__page" :class="{ 'app-shell__page--legacy': legacyTitle !== undefined }">
          <RouterView v-slot="{ Component, route: viewRoute }">
            <KeepAlive :max="5">
              <component :is="Component" :key="viewRoute.path" />
            </KeepAlive>
          </RouterView>
        </div>
      </main>
    </div>
  </TooltipProvider>
</template>

<style scoped>
.app-shell {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--pn-canvas);
  color: var(--pn-text1);
  font-family: var(--pn-font-ui);
  font-size: var(--pn-text-body);
  line-height: 1.45;
}

.app-shell__main {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.app-shell__page {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 旧页面：沿用它们原来所在容器的滚动与底色 */
.app-shell__page--legacy {
  overflow: auto;
  background: var(--bg-app);
}

.app-shell :focus-visible {
  outline: var(--pn-ring-width) solid var(--pn-ring);
  outline-offset: var(--pn-ring-offset);
}
</style>
