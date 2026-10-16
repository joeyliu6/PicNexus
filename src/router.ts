// 页面路由（内存模式：桌面应用没有地址栏，托盘与应用内跳转都走这里）
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import UploadView from '@/components/views/UploadView.vue';
import HistoryView from '@/components/views/HistoryView.vue';
import LinkCheckView from '@/components/views/LinkCheckView.vue';
import SettingsView from '@/components/views/SettingsView.vue';

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/home' },
  { path: '/home', component: UploadView, meta: { pageKey: 'home', legacyTitle: '' } },
  { path: '/gallery', component: HistoryView, meta: { pageKey: 'gallery', legacyTitle: '图库' } },
  { path: '/health', component: LinkCheckView, meta: { pageKey: 'health', legacyTitle: '链接健康' } },
  { path: '/hosts', component: SettingsView, props: { fixedTab: 'hosting' }, meta: { pageKey: 'hosts', legacyTitle: '图床' } },
  { path: '/settings', component: SettingsView, meta: { pageKey: 'settings', legacyTitle: '设置' } },
  { path: '/:pathMatch(.*)*', redirect: '/home' },
];

export function createAppRouter() {
  return createRouter({ history: createMemoryHistory(), routes });
}
