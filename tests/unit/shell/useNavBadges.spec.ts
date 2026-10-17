// 侧栏提示点：有新版本 → 设置旁品牌蓝；有失效图片 → 链接健康旁琥珀（交接说明 3.1 / 8.3）
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const state = vi.hoisted(() => ({
  update: null as null | { value: boolean },
  dead: null as null | { value: number },
  hosts: { value: [] as Array<{ id: string; warning: string | null }> },
}));
vi.mock('@/composables/useAutoUpdate', () => ({ useAutoUpdate: () => ({ hasAvailableUpdate: state.update }) }));
vi.mock('@/views/health/healthBadge', () => ({ useHealthBadge: () => ({ deadCount: state.dead }) }));
vi.mock('@/composables/upload/useUploadController', () => ({ useUploadController: () => ({ hosts: state.hosts }) }));

import { useNavBadges } from '@/shell/useNavBadges';

describe('useNavBadges', () => {
  it('链接健康：失效图片数 > 0 时一个琥珀点，修好后消失', () => {
    state.update = ref(false);
    state.dead = ref(3);
    const badges = useNavBadges();
    expect(badges.value).toEqual({ health: 'warning' });
    state.dead.value = 0;
    expect(badges.value).toEqual({});
  });

  it('两种点可以同时出现', () => {
    state.update = ref(true);
    state.dead = ref(1);
    expect(useNavBadges().value).toEqual({ settings: 'brand', health: 'warning' });
  });

  it('图床：已添加的图床有问题时一个琥珀点', () => {
    state.update = ref(false);
    state.dead = ref(0);
    state.hosts = ref([{ id: 'jd', warning: null }, { id: 'weibo', warning: '登录已失效' }]);
    const badges = useNavBadges();
    expect(badges.value).toEqual({ hosts: 'warning' });
    state.hosts.value = [{ id: 'jd', warning: null }];
    expect(badges.value).toEqual({});
  });
});
