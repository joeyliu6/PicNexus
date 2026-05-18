import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryItem } from '../../../config/types';
import type { SingleServiceResult } from '../../../core/MultiServiceUploader';

const {
  insertOrIgnoreMock,
  getByIdMock,
  updateMock,
  getImageMetadataMock,
  clearImageMetadataCacheMock,
  invalidateCacheMock,
  emitHistoryUpdatedMock,
} = vi.hoisted(() => ({
  insertOrIgnoreMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateMock: vi.fn(),
  getImageMetadataMock: vi.fn(),
  clearImageMetadataCacheMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
  emitHistoryUpdatedMock: vi.fn(),
}));


vi.mock('../../../services/HistoryDatabase', () => ({
  historyDB: {
    insertOrIgnore: insertOrIgnoreMock,
    getById: getByIdMock,
    update: updateMock,
  },
}));

vi.mock('../../../composables/useImageMetadata', () => ({
  getImageMetadata: getImageMetadataMock,
  clearImageMetadataCache: clearImageMetadataCacheMock,
}));

vi.mock('../../../composables/useHistory', () => ({
  invalidateCache: invalidateCacheMock,
}));

vi.mock('../../../events/cacheEvents', () => ({
  emitHistoryUpdated: emitHistoryUpdatedMock,
}));

function makeSuccess(serviceId: SingleServiceResult['serviceId']): SingleServiceResult {
  return {
    serviceId,
    status: 'success',
    result: {
      serviceId,
      fileKey: `${serviceId}-key`,
      url: `https://example.com/${serviceId}.jpg`,
    },
  };
}

function makeFailed(serviceId: SingleServiceResult['serviceId'], error = '上传失败: service error'): SingleServiceResult {
  return {
    serviceId,
    status: 'failed',
    error,
  };
}

describe('useHistorySaver', () => {
  beforeEach(() => {
    insertOrIgnoreMock.mockReset().mockResolvedValue(true);
    getByIdMock.mockReset();
    updateMock.mockReset().mockResolvedValue(undefined);
    getImageMetadataMock.mockReset().mockResolvedValue({
      width: 1200,
      height: 800,
      aspect_ratio: 1.5,
      file_size: 4096,
      format: 'jpg',
    });
    clearImageMetadataCacheMock.mockReset();
    invalidateCacheMock.mockReset();
    emitHistoryUpdatedMock.mockReset().mockResolvedValue(undefined);
  });

  it('saveHistoryItem keeps both success and failed results', async () => {
    const { useHistorySaver } = await import('../../../composables/useHistorySaver');
    const { saveHistoryItem } = useHistorySaver();
    const success = makeSuccess('jd');
    const failed = makeFailed('upyun');

    await saveHistoryItem('/tmp/test.jpg', {
      primaryService: 'jd',
      primaryUrl: 'https://example.com/jd.jpg',
      results: [success, failed],
    });

    const insertedItem = insertOrIgnoreMock.mock.calls[0][0] as HistoryItem;
    expect(insertedItem.results).toEqual([success, failed]);
  });

  it('saveHistoryItem updates existing record when customId points to one in DB (retry reuse path)', async () => {
    const { useHistorySaver } = await import('../../../composables/useHistorySaver');
    const { saveHistoryItem } = useHistorySaver();

    const existing: HistoryItem = {
      id: 'reuse-id',
      timestamp: 1710000000000,
      localFileName: 'test.jpg',
      filePath: '/tmp/test.jpg',
      primaryService: 'jd',
      generatedLink: 'https://example.com/old-jd.jpg',
      results: [makeSuccess('jd')],
      width: 1200,
      height: 800,
      aspectRatio: 1.5,
      fileSize: 4096,
      format: 'jpg',
      isFavorited: true,
    };
    getByIdMock.mockResolvedValueOnce(existing);

    const newResults = [makeSuccess('jd'), makeSuccess('upyun')];
    const returnedId = await saveHistoryItem(
      '/tmp/test.jpg',
      {
        primaryService: 'jd',
        primaryUrl: 'https://example.com/new-jd.jpg',
        results: newResults,
      },
      'reuse-id',
    );

    // 关键断言：走 update 路径而非 insertOrIgnore，避免重复历史并保留 isFavorited 等字段
    expect(returnedId).toBe('reuse-id');
    expect(insertOrIgnoreMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith('reuse-id', {
      results: newResults,
      primaryService: 'jd',
      generatedLink: 'https://example.com/new-jd.jpg',
    });
  });

  it('saveHistoryItem still inserts when customId has no matching DB record', async () => {
    const { useHistorySaver } = await import('../../../composables/useHistorySaver');
    const { saveHistoryItem } = useHistorySaver();

    getByIdMock.mockResolvedValueOnce(null);

    await saveHistoryItem(
      '/tmp/test.jpg',
      {
        primaryService: 'jd',
        primaryUrl: 'https://example.com/jd.jpg',
        results: [makeSuccess('jd')],
      },
      'orphan-id',
    );

    expect(insertOrIgnoreMock).toHaveBeenCalledTimes(1);
    const inserted = insertOrIgnoreMock.mock.calls[0][0] as HistoryItem;
    expect(inserted.id).toBe('orphan-id');
  });

  it('addResultToHistoryItem appends failed results and upserts retries by serviceId', async () => {
    const { useHistorySaver } = await import('../../../composables/useHistorySaver');
    const { addResultToHistoryItem } = useHistorySaver();

    const item: HistoryItem = {
      id: 'history-1',
      timestamp: 1710000000000,
      localFileName: 'test.jpg',
      filePath: '/tmp/test.jpg',
      primaryService: 'jd',
      generatedLink: 'https://example.com/jd.jpg',
      results: [makeSuccess('jd')],
      width: 1200,
      height: 800,
      aspectRatio: 1.5,
      fileSize: 4096,
      format: 'jpg',
    };

    getByIdMock.mockImplementation(async () => item);
    updateMock.mockImplementation(async (_historyId: string, updates: Partial<HistoryItem>) => {
      item.results = updates.results ?? item.results;
    });

    const failed = makeFailed('upyun');
    const repaired = makeSuccess('upyun');

    await addResultToHistoryItem('history-1', failed);
    await addResultToHistoryItem('history-1', repaired);

    expect(item.results).toEqual([makeSuccess('jd'), repaired]);
    expect(updateMock).toHaveBeenCalledTimes(2);
  });
});
