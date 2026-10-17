// 公共图床风险确认（P11）：琥珀色警示图标块、「我已了解并继续」；确认过一次就记下、不再问
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';

const m = vi.hoisted(() => ({ disk: null as null | UserConfig, saveConfig: vi.fn() }));
vi.mock('@/store/instances', () => ({ readFreshConfig: async () => m.disk }));
vi.mock('@/composables/useConfig', () => ({ useConfigManager: () => ({ saveConfig: m.saveConfig }) }));

import { __resetConfirmsForTests, currentConfirm, settleConfirm } from '@/components/pn/confirmStore';
import { usePublicRiskConfirm } from '@/composables/usePublicRiskConfirm';

describe('usePublicRiskConfirm', () => {
  beforeEach(() => {
    __resetConfirmsForTests();
    m.disk = structuredClone(DEFAULT_CONFIG);
    m.saveConfig.mockReset();
  });

  it('第一次问：琥珀色、不是危险按钮；确认后记下', async () => {
    const pending = usePublicRiskConfirm().ensureAccepted();
    await vi.waitFor(() => expect(currentConfirm.value).not.toBeNull());
    expect(currentConfirm.value).toMatchObject({ title: '启用公共图床？', acceptLabel: '我已了解并继续', tone: 'warning', danger: false });
    settleConfirm(currentConfirm.value!.id, 'accept');
    expect(await pending).toBe(true);
    expect(m.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ publicServiceRiskAccepted: true }), true);
  });

  it('确认过就不再问', async () => {
    m.disk!.publicServiceRiskAccepted = true;
    expect(await usePublicRiskConfirm().ensureAccepted()).toBe(true);
    expect(currentConfirm.value).toBeNull();
  });
});
