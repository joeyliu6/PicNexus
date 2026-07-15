import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { HistoryItem } from '@/config/types';
import { createHistoryItem, createHistoryResult } from '../factories/historyFactory';

const {
  getMetasByIdsMock,
  copyLinksMock,
  toastSuccessMock,
  toastWarnMock,
  toastSilentMock,
  bulkDeleteRecordsMock,
  bulkExportJSONMock,
  deleteHistoryItemMock,
  detailCacheGetDetailMock,
  detailCacheRemoveDetailMock,
} = vi.hoisted(() => ({
  getMetasByIdsMock: vi.fn(),
  copyLinksMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastWarnMock: vi.fn(),
  toastSilentMock: vi.fn(),
  bulkDeleteRecordsMock: vi.fn(),
  bulkExportJSONMock: vi.fn(),
  deleteHistoryItemMock: vi.fn(),
  detailCacheGetDetailMock: vi.fn(),
  detailCacheRemoveDetailMock: vi.fn(),
}));

vi.mock('@/services/HistoryDatabase', () => ({
  historyDB: {
    getMetasByIds: getMetasByIdsMock,
  },
}));

vi.mock('@/composables/useCopyLink', () => ({
  useCopyLink: () => ({
    copyLinks: copyLinksMock,
  }),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    warn: toastWarnMock,
    silent: toastSilentMock,
  }),
}));

vi.mock('@/composables/useHistory', () => ({
  useHistoryManager: () => ({
    totalCount: ref(0),
    detailCache: {
      getDetail: detailCacheGetDetailMock,
      removeDetail: detailCacheRemoveDetailMock,
    },
    bulkExportJSON: bulkExportJSONMock,
    bulkDeleteRecords: bulkDeleteRecordsMock,
    deleteHistoryItem: deleteHistoryItemMock,
  }),
}));

const { useHistoryViewState } = await import('@/composables/useHistoryViewState');

function makeMeta(overrides: {
  id: string;
  localFileName?: string;
  primaryUrl?: string;
  primaryService?: string;
}) {
  return {
    id: overrides.id,
    timestamp: 1_700_000_000_000,
    localFileName: overrides.localFileName ?? `${overrides.id}.jpg`,
    aspectRatio: 1,
    primaryService: overrides.primaryService ?? 'jd',
    primaryUrl: overrides.primaryUrl ?? `https://cdn.example.com/${overrides.id}.jpg`,
  };
}

function makeDetail(id: string, results: HistoryItem['results']): HistoryItem {
  return createHistoryItem({
    id,
    localFileName: `${id}.jpg`,
    primaryService: results[0]?.serviceId ?? 'jd',
    results,
  });
}

describe('useHistoryViewState history page bulk actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMetasByIdsMock.mockResolvedValue([]);
    copyLinksMock.mockResolvedValue({ ok: true, copiedCount: 0, format: 'url' });
    bulkDeleteRecordsMock.mockResolvedValue(true);
    bulkExportJSONMock.mockResolvedValue(undefined);
    deleteHistoryItemMock.mockResolvedValue(true);
    detailCacheGetDetailMock.mockResolvedValue(null);
  });

  it('copies only selected primary links that are available and reports skipped rows once', async () => {
    getMetasByIdsMock.mockResolvedValue([
      makeMeta({ id: 'a', primaryUrl: 'https://cdn.example.com/a.jpg', primaryService: 'jd' }),
      makeMeta({ id: 'b', primaryUrl: '', primaryService: 'r2' }),
    ]);
    copyLinksMock.mockResolvedValue({ ok: true, copiedCount: 1, format: 'markdown' });

    const state = useHistoryViewState();
    state.select('a');
    state.select('b');

    await state.bulkCopyFormatted('markdown');

    expect(getMetasByIdsMock).toHaveBeenCalledWith(['a', 'b']);
    expect(copyLinksMock).toHaveBeenCalledWith(
      [{ url: 'https://cdn.example.com/a.jpg', fileName: 'a.jpg', serviceId: 'jd' }],
      { format: 'markdown', showSuccessToast: false },
    );
    expect(toastWarnMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('does not show a success or skipped toast when bulk primary copy fails', async () => {
    getMetasByIdsMock.mockResolvedValue([
      makeMeta({ id: 'a', primaryUrl: 'https://cdn.example.com/a.jpg' }),
    ]);
    copyLinksMock.mockResolvedValue({ ok: false, copiedCount: 0, format: 'url', error: 'denied' });

    const state = useHistoryViewState();
    state.select('a');

    await state.bulkCopyFormatted('url');

    expect(copyLinksMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastWarnMock).not.toHaveBeenCalled();
  });

  it('keeps pure bulk primary copy success silent because the FAB button owns feedback', async () => {
    getMetasByIdsMock.mockResolvedValue([
      makeMeta({ id: 'a', primaryUrl: 'https://cdn.example.com/a.jpg', primaryService: 'jd' }),
      makeMeta({ id: 'b', primaryUrl: 'https://cdn.example.com/b.jpg', primaryService: 'r2' }),
    ]);
    copyLinksMock.mockResolvedValue({ ok: true, copiedCount: 2, format: 'url' });

    const state = useHistoryViewState();
    state.select('a');
    state.select('b');

    await state.bulkCopyFormatted('url');

    expect(copyLinksMock).toHaveBeenCalledWith(
      [
        { url: 'https://cdn.example.com/a.jpg', fileName: 'a.jpg', serviceId: 'jd' },
        { url: 'https://cdn.example.com/b.jpg', fileName: 'b.jpg', serviceId: 'r2' },
      ],
      { format: 'url', showSuccessToast: false },
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastWarnMock).not.toHaveBeenCalled();
    expect(toastSilentMock).toHaveBeenCalledWith('log', '已复制 2 张', '链接已复制到剪贴板');
  });

  it('copies a requested service by loading selected details and skips rows without that service', async () => {
    getMetasByIdsMock.mockResolvedValue([
      makeMeta({ id: 'a' }),
      makeMeta({ id: 'b' }),
      makeMeta({ id: 'c' }),
    ]);
    detailCacheGetDetailMock
      .mockResolvedValueOnce(makeDetail('a', [
        createHistoryResult({
          serviceId: 'r2',
          result: { serviceId: 'r2', fileKey: 'r2-a', url: 'https://r2.example.com/a.jpg' },
        }),
      ]))
      .mockResolvedValueOnce(makeDetail('b', [
        createHistoryResult({
          serviceId: 'jd',
          result: { serviceId: 'jd', fileKey: 'jd-b', url: 'https://jd.example.com/b.jpg' },
        }),
      ]))
      .mockRejectedValueOnce(new Error('missing detail'));
    copyLinksMock.mockResolvedValue({ ok: true, copiedCount: 1, format: 'url' });

    const state = useHistoryViewState();
    state.select('a');
    state.select('b');
    state.select('c');

    await state.bulkCopyFormatted('url', 'r2');

    expect(detailCacheGetDetailMock).toHaveBeenCalledTimes(3);
    expect(copyLinksMock).toHaveBeenCalledWith(
      [{ url: 'https://r2.example.com/a.jpg', fileName: 'a.jpg', serviceId: 'r2' }],
      { format: 'url', showSuccessToast: false },
    );
    expect(toastWarnMock).toHaveBeenCalledTimes(1);
  });

  it('keeps pure service-specific bulk copy success silent because the service row owns feedback', async () => {
    getMetasByIdsMock.mockResolvedValue([
      makeMeta({ id: 'a' }),
      makeMeta({ id: 'b' }),
    ]);
    detailCacheGetDetailMock
      .mockResolvedValueOnce(makeDetail('a', [
        createHistoryResult({
          serviceId: 'r2',
          result: { serviceId: 'r2', fileKey: 'r2-a', url: 'https://r2.example.com/a.jpg' },
        }),
      ]))
      .mockResolvedValueOnce(makeDetail('b', [
        createHistoryResult({
          serviceId: 'r2',
          result: { serviceId: 'r2', fileKey: 'r2-b', url: 'https://r2.example.com/b.jpg' },
        }),
      ]));
    copyLinksMock.mockResolvedValue({ ok: true, copiedCount: 2, format: 'url' });

    const state = useHistoryViewState();
    state.select('a');
    state.select('b');

    await state.bulkCopyFormatted('url', 'r2');

    expect(copyLinksMock).toHaveBeenCalledWith(
      [
        { url: 'https://r2.example.com/a.jpg', fileName: 'a.jpg', serviceId: 'r2' },
        { url: 'https://r2.example.com/b.jpg', fileName: 'b.jpg', serviceId: 'r2' },
      ],
      { format: 'url', showSuccessToast: false },
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastWarnMock).not.toHaveBeenCalled();
    expect(toastSilentMock).toHaveBeenCalledWith('log', '已复制 2 张', '链接已复制到剪贴板');
  });

  it('keeps selection after a failed bulk delete and clears it only after success', async () => {
    bulkDeleteRecordsMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const state = useHistoryViewState();
    state.select('a');
    state.select('b');

    await state.bulkDelete();

    expect(bulkDeleteRecordsMock).toHaveBeenCalledWith(['a', 'b']);
    expect(state.selectedIdList.value).toEqual(['a', 'b']);

    await state.bulkDelete();

    expect(state.selectedIdList.value).toEqual([]);
  });

  it('clears selection when the filter or search term changes', () => {
    const state = useHistoryViewState();
    state.select('a');
    state.setFilter('r2');

    expect(state.currentFilter.value).toBe('r2');
    expect(state.selectedIdList.value).toEqual([]);

    state.select('b');
    state.setSearchTerm('cat');

    expect(state.searchTerm.value).toBe('cat');
    expect(state.selectedIdList.value).toEqual([]);
  });
});
