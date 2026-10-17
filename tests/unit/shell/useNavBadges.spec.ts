// 侧栏提示点：有新版本 → 设置旁品牌蓝；有失效图片 → 链接健康旁琥珀（交接说明 3.1 / 8.3）
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const state = vi.hoisted(() => ({ update: null as null | { value: boolean }, dead: null as null | { value: number } }));
vi.mock('@/composables/useAutoUpdate', () => ({ useAutoUpdate: () => ({ hasAvailableUpdate: state.update }) }));
vi.mock('@/views/health/healthBadge', () => ({ useHealthBadge: () => ({ deadCount: state.dead }) }));

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
});
