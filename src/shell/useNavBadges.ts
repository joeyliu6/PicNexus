// 侧栏提示点（交接说明 3.1）：有新版本时「设置」旁一个品牌蓝小点；有失效图片时「链接健康」旁一个琥珀点
//（交接说明 8.3「发现失效时在侧栏提示」）。不弹窗。
import { computed } from 'vue';
import { useAutoUpdate } from '@/composables/useAutoUpdate';
import { useHealthBadge } from '@/views/health/healthBadge';
import type { NavBadge, PageKey } from './navItems';

export function useNavBadges() {
  const { hasAvailableUpdate } = useAutoUpdate();
  const { deadCount } = useHealthBadge();

  return computed<Partial<Record<PageKey, NavBadge>>>(() => ({
    ...(hasAvailableUpdate.value ? { settings: 'brand' as const } : {}),
    ...(deadCount.value > 0 ? { health: 'warning' as const } : {}),
  }));
}
