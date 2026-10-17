// 单例脱离组件生命周期：第一个调用它的组件（外壳里的传输中心）卸载后，健康模型仍跟着检测结果走。
// 真机走查时热更新让传输中心重挂，健康模型的节流 watcher 随旧组件停掉，修复后页面一直显示「修复 4 张」。
import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref, shallowRef } from 'vue';
import type { CheckLinkResult, LinkCheckRow } from '@/types/linkCheck';

const engine = vi.hoisted(() => ({ state: null as null | Record<string, unknown> }));

vi.mock('@/composables/link-check/useLinkCheck', () => ({ useLinkCheckManager: () => engine.state }));
vi.mock('@/composables/useConfig', () => ({ useConfigManager: () => ({ config: { value: {} }, loadConfig: async () => ({}) }) }));
vi.mock('@/events/cacheEvents', () => ({ emitHistoryUpdated: vi.fn().mockResolvedValue(undefined) }));

import { __resetLinkHealthForTests, useLinkHealth } from '@/views/health/useLinkHealth';

const gone: CheckLinkResult = { link: '', is_valid: false, error_type: 'http_4xx', status_code: 404, browser_might_work: false };
const ok: CheckLinkResult = { link: '', is_valid: true, error_type: 'success', browser_might_work: false };
const row = (host: string, result: CheckLinkResult, isPrimary: boolean): LinkCheckRow => ({
  historyId: 'a', serviceId: host, url: `https://${host}.example/a`, rawUrl: '', fileName: 'a', uploadedAt: 1, isPrimary, checkResult: result, checkedAt: 10,
});

describe('useLinkHealth 单例的生命周期', () => {
  it('创建它的组件卸载后，改用备份照样反映到模型里', async () => {
    __resetLinkHealthForTests();
    const checkRows = shallowRef([row('r2', gone, true), row('jd', ok, false)]);
    engine.state = {
      checkRows, isChecking: ref(false), isPaused: ref(false), activeRun: shallowRef(null), progress: ref(null),
      loaded: ref(true), isLoading: ref(false), loadError: ref(null), recheckSingle: vi.fn(),
    };
    const owner = effectScope();
    const health = owner.run(() => useLinkHealth())!;
    expect(health.summary.value.dead).toBe(1);
    owner.stop();

    checkRows.value = [row('r2', gone, false), row('jd', ok, true)];
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(health.summary.value.dead).toBe(0);
  });
});
