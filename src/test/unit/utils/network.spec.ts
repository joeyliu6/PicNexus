import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkNetworkConnectivity } from '../../../utils/network';

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

  it('使用 HEAD 方法和 no-cors 模式', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());

    await checkNetworkConnectivity();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'HEAD', mode: 'no-cors' }),
    );
  });
});
