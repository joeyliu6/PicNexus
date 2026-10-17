// 路由 meta 的类型（见 src/router.ts）
import 'vue-router';
import type { PageKey } from '@/shell/navItems';

declare module 'vue-router' {
  interface RouteMeta {
    pageKey?: PageKey;
  }
}
