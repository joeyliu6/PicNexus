import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryItem } from '@/config/types';
import { createHistoryItem, createHistoryResult, createHistoryUploadResult } from '../../factories/historyFactory';

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), warn: vi.fn(), error: vi.fn(), withAction: vi.fn() },
  copyLinks: vi.fn(),
  getDetails: vi.fn(),
  checkSubset: vi.fn(),
  loadHistoryRows: vi.fn(),
  emitHistoryUpdated: vi.fn(),
}));

vi.mock('@/composables/useToast', () => ({ useToast: () => mocks.toast }));
vi.mock('@/composables/useCopyLink', () => ({ useCopyLink: () => ({ copyLinks: mocks.copyLinks }) }));
vi.mock('@/composables/history/useHistory', () => ({
  useHistoryManager: () => ({ detailCache: { getDetails: mocks.getDetails }, removeRecords: vi.fn(), restoreRecords: vi.fn(), batchSetFavorite: vi.fn() }),
}));
vi.mock('@/composables/useConfig', () => ({ useConfigManager: () => ({ loadConfig: async () => ({}) }) }));
vi.mock('@/composables/link-check/useLinkCheck', () => ({
  useLinkCheckManager: () => ({ loadHistoryRows: mocks.loadHistoryRows, checkSubset: mocks.checkSubset }),
}));
vi.mock('@/events/cacheEvents', () => ({ emitHistoryUpdated: mocks.emitHistoryUpdated }));
vi.mock('@/constants/serviceNames', () => ({ getServiceDisplayName: (id: string) => ({ jd: '京东', weibo: '微博', r2: 'R2' })[id] ?? id }));
vi.mock('@/core/MultiServiceUploader', () => ({ MultiServiceUploader: vi.fn() }));
vi.mock('@/composables/batch-migrate/migrateCore', () => ({ migrateOneItem: vi.fn() }));
vi.mock('@/composables/batch-migrate/historyRefresh', () => ({ notifyMigrationPersisted: vi.fn() }));
vi.mock('@/composables/batch-migrate/sourceSelection', () => ({ getDefaultMigrateSource: vi.fn() }));
vi.mock('@/services/database', () => ({ historyDB: {} }));
vi.mock('@/utils/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const { useGalleryActions } = await import('@/views/gallery/useGalleryActions');

/** 一张存在京东（复制时使用）和微博上的图；health 写每份的检测结论 */
function record(id: string, health: Partial<Record<'jd' | 'weibo', 'ok' | 'dead' | 'limited'>> = {}): HistoryItem {
  const status = Object.fromEntries(Object.entries(health).map(([host, h]) => [host, {
    isValid: h === 'ok', lastCheckTime: 1, errorType: h === 'ok' ? 'success' : 'http_4xx', ...(h === 'limited' ? { browserMightWork: true } : {}),
  }]));
  return createHistoryItem({
    id,
    localFileName: `${id}.png`,
    primaryService: 'jd',
    results: [
      createHistoryResult({ serviceId: 'jd', result: createHistoryUploadResult({ serviceId: 'jd', url: `https://jd.example/${id}.png` }) }),
      createHistoryResult({ serviceId: 'weibo', result: createHistoryUploadResult({ serviceId: 'weibo', url: `https://weibo.example/${id}.png` }) }),
    ],
    linkCheckStatus: Object.keys(status).length ? status as HistoryItem['linkCheckStatus'] : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.copyLinks.mockResolvedValue({ ok: true });
  mocks.emitHistoryUpdated.mockResolvedValue(undefined);
});

describe('useGalleryActions — copyMany', () => {
  // 交接说明 CopyMulti：失效的那份「置灰、不能点」——批量复制同样跳过，算进「没有可用链接」
  it('skips images whose copy-source link is dead and says how many were skipped', async () => {
    mocks.getDetails.mockResolvedValue([record('a', { jd: 'ok' }), record('b', { jd: 'dead' }), null]);
    await useGalleryActions().copyMany(['a', 'b', 'c'], 'markdown');

    expect(mocks.copyLinks).toHaveBeenCalledWith([{ url: 'https://jd.example/a.png', fileName: 'a.png', serviceId: 'jd' }], expect.anything());
    expect(mocks.toast.success).toHaveBeenCalledWith('已复制 1 张（2 张没有可用链接）', 'Markdown 格式，每行一个');
  });

  it('copies from a chosen host but skips the copies there that are dead', async () => {
    mocks.getDetails.mockResolvedValue([record('a', { weibo: 'dead' }), record('b', { weibo: 'limited' })]);
    await useGalleryActions().copyMany(['a', 'b'], 'url', 'weibo');

    expect(mocks.copyLinks).toHaveBeenCalledWith([{ url: 'https://weibo.example/b.png', fileName: 'b.png', serviceId: 'weibo' }], expect.anything());
  });

  // 交接说明 9：大数字千分位
  it('writes large counts with thousands separators', async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `n${i}`);
    mocks.getDetails.mockResolvedValue(ids.map((id) => record(id)));
    await useGalleryActions().copyMany(ids, 'url');

    expect(mocks.toast.success).toHaveBeenCalledWith('已复制 1,200 张', expect.any(String));
  });
});

describe('useGalleryActions — recheck', () => {
  // 回归：检测结果写回了记录，却没广播 history-updated，格子上的 ⚠ 与详情都停在旧结论
  it('announces the re-checked records so the grid and details refresh', async () => {
    mocks.checkSubset.mockResolvedValue({ invalid: 0 });
    await useGalleryActions().recheck(['a', 'b']);

    expect(mocks.emitHistoryUpdated).toHaveBeenCalledWith(['a', 'b']);
    expect(mocks.toast.success).toHaveBeenCalledWith('已重新检测 2 张', '均正常');
  });

  // 查出失效是「需要留意的状态」：琥珀，不是绿色的成功
  it('warns in amber when the check finds dead links', async () => {
    mocks.checkSubset.mockResolvedValue({ invalid: 3 });
    await useGalleryActions().recheck(['a', 'b']);

    expect(mocks.toast.warn).toHaveBeenCalledWith('已重新检测 2 张', '3 条链接失效');
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});
