// 页面路由（内存模式：桌面应用没有地址栏，托盘与应用内跳转都走这里）
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import HomeView from '@/views/home/HomeView.vue';
import GalleryView from '@/views/gallery/GalleryView.vue';
import HealthView from '@/views/health/HealthView.vue';
import SettingsView from '@/components/views/SettingsView.vue';

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/home' },
  { path: '/home', component: HomeView, meta: { pageKey: 'home' } },
  { path: '/gallery', component: GalleryView, meta: { pageKey: 'gallery' } },
  { path: '/health', component: HealthView, meta: { pageKey: 'health' } },
  { path: '/hosts', component: SettingsView, props: { fixedTab: 'hosting' }, meta: { pageKey: 'hosts', legacyTitle: '图床' } },
  { path: '/settings', component: SettingsView, meta: { pageKey: 'settings', legacyTitle: '设置' } },
  { path: '/:pathMatch(.*)*', redirect: '/home' },
];

export function createAppRouter() {
  return createRouter({ history: createMemoryHistory(), routes });
}
