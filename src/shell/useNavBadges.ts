// 侧栏提示点（交接说明 3.1）：有新版本时「设置」旁一个品牌蓝小点；不弹窗。
// 链接健康的琥珀点在链接健康页按新设计重写时接上「失效图片」计数。
import { computed } from 'vue';
import { useAutoUpdate } from '@/composables/useAutoUpdate';
import type { NavBadge, PageKey } from './navItems';

export function useNavBadges() {
  const { hasAvailableUpdate } = useAutoUpdate();

  return computed<Partial<Record<PageKey, NavBadge>>>(() => ({
    ...(hasAvailableUpdate.value ? { settings: 'brand' as const } : {}),
  }));
}
