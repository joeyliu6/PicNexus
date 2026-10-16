// 路由 meta 的类型（见 src/router.ts）
import 'vue-router';
import type { PageKey } from '@/shell/navItems';

declare module 'vue-router' {
  interface RouteMeta {
    pageKey?: PageKey;
    /** 尚未按新设计重写的旧页面：外壳替它画顶部标题行与窗口按钮 */
    legacyTitle?: string;
  }
}
