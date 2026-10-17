// 侧栏提示点（交接说明 3.1）：有新版本时「设置」旁一个品牌蓝小点；有失效图片时「链接健康」旁一个琥珀点
//（交接说明 8.3「发现失效时在侧栏提示」）；已添加的图床有问题（登录失效等）时「图床」旁一个琥珀点（HostsScreen.dc.html）。不弹窗。
import { computed } from 'vue';
import { useAutoUpdate } from '@/composables/useAutoUpdate';
import { useUploadController } from '@/composables/upload/useUploadController';
import { useHealthBadge } from '@/views/health/healthBadge';
import type { NavBadge, PageKey } from './navItems';

export function useNavBadges() {
  const { hasAvailableUpdate } = useAutoUpdate();
  const { deadCount } = useHealthBadge();
  const { hosts } = useUploadController();

  return computed<Partial<Record<PageKey, NavBadge>>>(() => ({
    ...(hasAvailableUpdate.value ? { settings: 'brand' as const } : {}),
    ...(deadCount.value > 0 ? { health: 'warning' as const } : {}),
    ...(hosts.value.some((h) => h.warning) ? { hosts: 'warning' as const } : {}),
  }));
}
