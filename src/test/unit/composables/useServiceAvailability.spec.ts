import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('../../../store/instances', () => ({
  syncStatusStore: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  },
  configStore: { get: vi.fn(), set: vi.fn(), save: vi.fn() },
}));

vi.mock('../../../composables/useServiceHealth', () => ({
  useServiceHealth: () => ({
    markVerified: vi.fn(),
    markTestFailed: vi.fn(),
  }),
}));

import { syncStatusStore } from '../../../store/instances';
import { useServiceAvailability } from '../../../composables/useServiceAvailability';

const syncStatusStoreMock = syncStatusStore as any;
const mockInvoke = vi.mocked(invoke);

describe('useServiceAvailability', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    syncStatusStoreMock.get.mockReset();
    syncStatusStoreMock.set.mockReset();
    syncStatusStoreMock.save.mockReset();
  });

  describe('checkQiyuAvailability', () => {
    it('成功检测后 qiyuAvailable=true 并持久化', async () => {
      syncStatusStoreMock.get.mockResolvedValue(null);
      mockInvoke.mockResolvedValue(true);
      const api = useServiceAvailability();
      await api.checkQiyuAvailability(true);
      expect(api.qiyuAvailable.value).toBe(true);
      expect(syncStatusStoreMock.set).toHaveBeenCalled();
    });

    it('检测失败 → qiyuAvailable=false', async () => {
      syncStatusStoreMock.get.mockResolvedValue(null);
      mockInvoke.mockRejectedValue(new Error('service down'));
      const api = useServiceAvailability();
      await api.checkQiyuAvailability(true);
      expect(api.qiyuAvailable.value).toBe(false);
    });

    it('在冷却期内且非强制 → 使用缓存结果', async () => {
      const now = Date.now();
      syncStatusStoreMock.get.mockResolvedValue({
        qiyuCheckStatus: {
          nextCheckTime: now + 3600_000,
          lastCheckResult: true,
        },
      });
      mockInvoke.mockResolvedValue(false);
      const api = useServiceAvailability();
      await api.checkQiyuAvailability(false);
      expect(api.qiyuAvailable.value).toBe(true);
      // 没走 invoke
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('forceCheck=true 忽略冷却期', async () => {
      const now = Date.now();
      syncStatusStoreMock.get.mockResolvedValue({
        qiyuCheckStatus: { nextCheckTime: now + 3600_000, lastCheckResult: true },
      });
      mockInvoke.mockResolvedValue(false);
      const api = useServiceAvailability();
      await api.checkQiyuAvailability(true);
      expect(mockInvoke).toHaveBeenCalledWith('check_qiyu_available');
      expect(api.qiyuAvailable.value).toBe(false);
    });

    it('syncStatusStore.get 抛错不中断检测', async () => {
      syncStatusStoreMock.get.mockRejectedValue(new Error('store'));
      mockInvoke.mockResolvedValue(true);
      const api = useServiceAvailability();
      await api.checkQiyuAvailability(true);
      expect(api.qiyuAvailable.value).toBe(true);
    });

    it('持久化失败不影响结果', async () => {
      syncStatusStoreMock.get.mockResolvedValue(null);
      syncStatusStoreMock.set.mockRejectedValue(new Error('write'));
      mockInvoke.mockResolvedValue(true);
      const api = useServiceAvailability();
      await api.checkQiyuAvailability(true);
      expect(api.qiyuAvailable.value).toBe(true);
    });
  });

  describe('checkJdAvailable', () => {
    it('成功检测 → jdAvailable=true', async () => {
      syncStatusStoreMock.get.mockResolvedValue(null);
      mockInvoke.mockResolvedValue(true);
      const api = useServiceAvailability();
      await api.checkJdAvailable(true);
      expect(api.jdAvailable.value).toBe(true);
    });

    it('冷却期内使用缓存', async () => {
      const now = Date.now();
      syncStatusStoreMock.get.mockResolvedValue({
        jdCheckStatus: { nextCheckTime: now + 1000_000, lastCheckResult: false },
      });
      const api = useServiceAvailability();
      await api.checkJdAvailable(false);
      expect(api.jdAvailable.value).toBe(false);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('invoke 抛错 → jdAvailable=false', async () => {
      syncStatusStoreMock.get.mockResolvedValue(null);
      mockInvoke.mockRejectedValue('err');
      const api = useServiceAvailability();
      await api.checkJdAvailable(true);
      expect(api.jdAvailable.value).toBe(false);
    });
  });

  describe('checkAllAvailabilityWithCooldown', () => {
    it('初始 syncStatus 有缓存时直接应用', async () => {
      syncStatusStoreMock.get.mockResolvedValue({
        qiyuCheckStatus: { nextCheckTime: Date.now() + 100_000, lastCheckResult: true },
        jdCheckStatus: { nextCheckTime: Date.now() + 100_000, lastCheckResult: true },
      });
      const api = useServiceAvailability();
      await api.checkAllAvailabilityWithCooldown({
        syncByProfile: {},
        qiyuCheckStatus: { lastCheckResult: true } as any,
        jdCheckStatus: { lastCheckResult: true } as any,
      } as any);
      expect(api.qiyuAvailable.value).toBe(true);
      expect(api.jdAvailable.value).toBe(true);
    });

    it('无初始状态时走检测流程', async () => {
      syncStatusStoreMock.get.mockResolvedValue(null);
      mockInvoke.mockResolvedValue(true);
      const api = useServiceAvailability();
      await api.checkAllAvailabilityWithCooldown();
      // 应调用 2 次 invoke
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  describe('markServiceAvailable', () => {
    it('为 qiyu 设置冷却并标为已可用', async () => {
      syncStatusStoreMock.get.mockResolvedValue(null);
      const api = useServiceAvailability();
      await api.markServiceAvailable('qiyu');
      expect(api.qiyuAvailable.value).toBe(true);
      expect(syncStatusStoreMock.set).toHaveBeenCalled();
    });

    it('为 jd 设置冷却', async () => {
      syncStatusStoreMock.get.mockResolvedValue(null);
      const api = useServiceAvailability();
      await api.markServiceAvailable('jd');
      expect(api.jdAvailable.value).toBe(true);
    });

    it('持久化失败不抛错', async () => {
      syncStatusStoreMock.get.mockResolvedValue(null);
      syncStatusStoreMock.set.mockRejectedValue(new Error('x'));
      const api = useServiceAvailability();
      await expect(api.markServiceAvailable('qiyu')).resolves.toBeUndefined();
    });
  });
});
