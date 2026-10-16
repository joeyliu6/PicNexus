import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkNetworkConnectivity } from '@/utils/network';

describe('checkNetworkConnectivity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('任一端点成功即返回 true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());

    const result = await checkNetworkConnectivity();
    expect(result).toBe(true);
  });

  it('所有端点失败返回 false', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));

    const result = await checkNetworkConnectivity();
    expect(result).toBe(false);
  });

  it('部分端点成功仍返回 true', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('timeout');
      return new Response();
    });

    const result = await checkNetworkConnectivity();
    expect(result).toBe(true);
  });

  // 批量补传时每一项各自查网络：同时问的共用一次探测，不往外发几十组请求
  it('shares one probe between callers that ask at the same time', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());

    const results = await Promise.all([checkNetworkConnectivity(), checkNetworkConnectivity(), checkNetworkConnectivity()]);

    expect(results).toEqual([true, true, true]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('probes again once the previous probe has settled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());

    await checkNetworkConnectivity();
    await checkNetworkConnectivity();

    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it('使用 HEAD 方法和 no-cors 模式', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());

    await checkNetworkConnectivity();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'HEAD', mode: 'no-cors' }),
    );
  });
});
