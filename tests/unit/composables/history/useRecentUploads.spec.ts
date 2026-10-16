import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPageMock } = vi.hoisted(() => ({ getPageMock: vi.fn() }));

vi.mock('@/services/database', () => ({ historyDB: { getPage: getPageMock } }));
vi.mock('@/events/cacheEvents', () => ({ onCacheEventType: vi.fn(async () => () => {}) }));
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { useRecentUploads } from '@/composables/history/useRecentUploads';

describe('useRecentUploads', () => {
  beforeEach(() => {
    getPageMock.mockReset().mockResolvedValue({ items: [], total: 0, hasMore: false });
  });

  // 首页「更早」去掉这次打开应用后传的那些：一批传了 10 张，最新 8 条全是它们，「更早」就空了
  it('reads further back when this session already shows the newest records', async () => {
    const recent = useRecentUploads();
    await recent.refresh();
    expect(getPageMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 8 });

    await recent.reserve(10);
    expect(getPageMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 18 });

    await recent.reserve(10);
    expect(getPageMock).toHaveBeenCalledTimes(2);
  });
});
