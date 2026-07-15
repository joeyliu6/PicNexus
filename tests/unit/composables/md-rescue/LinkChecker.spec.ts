import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryItem, UserConfig } from '@/config/types';
import type { BatchCheckRequestItem, BatchCheckResult, CheckLinkResult } from '@/types/linkCheck';

const historyMocks = vi.hoisted(() => ({
  open: vi.fn(),
  getAllStream: vi.fn(),
  getById: vi.fn(),
}));

const copyLinkMocks = vi.hoisted(() => ({
  applyConfiguredUrlWithConfig: vi.fn((url: string) => url),
}));

vi.mock('@/services/HistoryDatabase', () => ({
  historyDB: historyMocks,
}));

vi.mock('@/composables/useCopyLink', () => ({
  applyConfiguredUrlWithConfig: copyLinkMocks.applyConfiguredUrlWithConfig,
}));

import {
  buildScanMappings,
  buildUrlIndex,
  findBackupLinksRaw,
  runLinkCheck,
  type CheckUrlsFn,
} from '@/composables/md-rescue/LinkChecker';
import {
  excludedUrls,
  imageLinks,
  isCancelled,
  readyFiles,
  scanProgress,
  scanStage,
  setCheckStartTime,
  setUrlIndex,
  type MdImageLinkWithFile,
} from '@/composables/md-rescue/shared';

const config = {} as UserConfig;

function makeResult(link: string, valid: boolean, responseTime = 100): CheckLinkResult {
  return {
    link,
    is_valid: valid,
    status_code: valid ? 200 : 404,
    error_type: valid ? 'success' : 'http_4xx',
    browser_might_work: false,
    response_time: responseTime,
  };
}

function makeBatch(results: CheckLinkResult[], cancelled = false): BatchCheckResult {
  return {
    results,
    total: results.length,
    valid: results.filter((r) => r.is_valid).length,
    invalid: results.filter((r) => !r.is_valid).length,
    timeout: 0,
    suspicious: 0,
    elapsed_ms: 10,
    cancelled,
  };
}

function makeLink(url: string, file = 'C:/docs/a.md'): MdImageLinkWithFile {
  const sourceFileName = file.split('/').pop() ?? file;
  return {
    originalText: `![](${url})`,
    url,
    altText: '',
    lineNumber: 1,
    syntax: 'markdown',
    context: 'normal',
    sourceFile: file,
    sourceFileName,
  };
}

function makeHistoryItem(id: string, urls: Array<{ serviceId: string; url: string; status?: 'success' | 'failed' }>): HistoryItem {
  return {
    id,
    timestamp: 1,
    localFileName: `${id}.png`,
    primaryService: urls[0]?.serviceId ?? 'primary',
    generatedLink: urls[0]?.url ?? '',
    results: urls.map((u) => ({
      serviceId: u.serviceId,
      status: u.status ?? 'success',
      result: u.status === 'failed' ? undefined : { url: u.url } as never,
      error: u.status === 'failed' ? 'failed' : undefined,
    })),
  };
}

function streamBatches(...batches: HistoryItem[][]) {
  return (async function* stream() {
    for (const batch of batches) yield batch;
  })();
}

function resetSharedState(): void {
  imageLinks.value = [];
  excludedUrls.value = new Set();
  scanStage.value = 'checking';
  readyFiles.value = new Set();
  scanProgress.value = null;
  isCancelled.value = false;
  setUrlIndex(null);
  setCheckStartTime(0);
}

describe('LinkChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSharedState();
    historyMocks.open.mockResolvedValue(undefined);
    historyMocks.getAllStream.mockReturnValue(streamBatches());
    historyMocks.getById.mockResolvedValue(null);
    copyLinkMocks.applyConfiguredUrlWithConfig.mockImplementation((url: string) => url);
  });

  it('buildScanMappings 去重、排除并按文件建立反向索引', () => {
    const links = [
      makeLink('https://img.example/a.png', 'C:/docs/a.md'),
      makeLink('https://img.example/a.png', 'C:/docs/a.md'),
      makeLink('https://img.example/b.png', 'C:/docs/b.md'),
      makeLink('https://img.example/skip.png', 'C:/docs/c.md'),
    ];

    const result = buildScanMappings(links, new Set(['https://img.example/skip.png']));

    expect(result.items.map((i) => i.url)).toEqual([
      'https://img.example/a.png',
      'https://img.example/b.png',
    ]);
    expect(result.urlFileMap.get('https://img.example/a.png')).toEqual(new Set(['C:/docs/a.md']));
    expect(result.fileUrlSets.get('C:/docs/a.md')).toEqual(new Set(['https://img.example/a.png']));
    expect(result.urlLinkCount.get('https://img.example/a.png')).toBe(2);
    expect(result.totalImageCount).toBe(3);
    expect(result.fileToIndices.get('C:/docs/c.md')).toEqual([3]);
  });

  it('buildUrlIndex 建立 raw/final URL 索引，findBackupLinksRaw 返回去重后的备用链接', async () => {
    const item = makeHistoryItem('h1', [
      { serviceId: 'primary', url: 'https://dead.example/a.png' },
      { serviceId: 'mirror', url: 'https://cdn.example/a.png' },
      { serviceId: 'failed', url: 'https://failed.example/a.png', status: 'failed' },
    ]);
    historyMocks.getAllStream.mockReturnValue(streamBatches([item]));
    historyMocks.getById.mockResolvedValue(item);
    copyLinkMocks.applyConfiguredUrlWithConfig.mockImplementation((url: string, serviceId?: string) =>
      serviceId === 'mirror' ? `https://proxy.example/?src=${encodeURIComponent(url)}` : url,
    );

    await buildUrlIndex(config);
    const backups = await findBackupLinksRaw('https://dead.example/a.png', config);

    expect(historyMocks.open).toHaveBeenCalled();
    expect(historyMocks.getAllStream).toHaveBeenCalledWith(1000);
    expect(backups).toEqual([
      {
        url: 'https://proxy.example/?src=https%3A%2F%2Fcdn.example%2Fa.png',
        serviceId: 'mirror',
      },
    ]);
  });

  it('runLinkCheck 完成主链接检测、备用链接验证并按文件标记 ready', async () => {
    const deadUrl = 'https://dead.example/a.png';
    const okUrl = 'https://ok.example/b.png';
    const backupUrl = 'https://cdn.example/a.png';
    const item = makeHistoryItem('h1', [
      { serviceId: 'primary', url: deadUrl },
      { serviceId: 'mirror', url: backupUrl },
    ]);
    historyMocks.getAllStream.mockReturnValue(streamBatches([item]));
    historyMocks.getById.mockResolvedValue(item);
    imageLinks.value = [
      makeLink(deadUrl, 'C:/docs/broken.md'),
      makeLink(okUrl, 'C:/docs/ok.md'),
    ];

    const checkUrls: CheckUrlsFn = vi.fn(async (
      items: BatchCheckRequestItem[],
      onProgress?: (prog: { current_url: string; current_result?: CheckLinkResult }) => void,
    ) => {
      if (vi.mocked(checkUrls).mock.calls.length === 1) {
        const results = items.map((item) => makeResult(item.url, item.url === okUrl));
        for (const result of results) {
          onProgress?.({ current_url: result.link, current_result: result });
        }
        return makeBatch(results);
      }

      const results = items.map((item) => makeResult(item.url, true, item.url === backupUrl ? 20 : 50));
      return makeBatch(results);
    }) as CheckUrlsFn;

    await runLinkCheck({ config, checkUrls });

    expect(checkUrls).toHaveBeenCalledTimes(2);
    expect(vi.mocked(checkUrls).mock.calls[1][0]).toEqual([{ url: backupUrl }]);
    expect(scanStage.value).toBe('complete');
    expect(scanProgress.value).toEqual({ checked: 2, total: 2 });
    expect(readyFiles.value).toEqual(new Set(['C:/docs/broken.md', 'C:/docs/ok.md']));
    expect(imageLinks.value[0].checkResult?.is_valid).toBe(false);
    expect(imageLinks.value[0].backupLinks).toEqual([
      {
        url: backupUrl,
        serviceId: 'mirror',
        checkResult: makeResult(backupUrl, true, 20),
      },
    ]);
  });

  it('runLinkCheck 取消时保留已检测结果并停在 cancelled', async () => {
    const okUrl = 'https://ok.example/a.png';
    imageLinks.value = [makeLink(okUrl, 'C:/docs/a.md')];

    const checkUrls: CheckUrlsFn = vi.fn(async (
      items: BatchCheckRequestItem[],
      onProgress?: (prog: { current_url: string; current_result?: CheckLinkResult }) => void,
    ) => {
      const result = makeResult(items[0].url, true);
      onProgress?.({ current_url: result.link, current_result: result });
      return makeBatch([result], true);
    }) as CheckUrlsFn;

    await runLinkCheck({ config, checkUrls });

    expect(scanStage.value).toBe('cancelled');
    expect(isCancelled.value).toBe(true);
    expect(readyFiles.value).toEqual(new Set(['C:/docs/a.md']));
    expect(imageLinks.value[0].checkResult).toEqual(makeResult(okUrl, true));
    expect(checkUrls).toHaveBeenCalledTimes(1);
  });

  it('runLinkCheck 取消后仍为已完整检测的坏链查找并验证备用链接', async () => {
    const deadUrl = 'https://dead.example/a.png';
    const pendingUrl = 'https://pending.example/b.png';
    const backupUrl = 'https://cdn.example/a.png';
    const item = makeHistoryItem('h1', [
      { serviceId: 'primary', url: deadUrl },
      { serviceId: 'mirror', url: backupUrl },
    ]);
    historyMocks.getAllStream.mockReturnValue(streamBatches([item]));
    historyMocks.getById.mockResolvedValue(item);
    imageLinks.value = [
      makeLink(deadUrl, 'C:/docs/done.md'),
      makeLink(pendingUrl, 'C:/docs/pending.md'),
    ];

    const checkUrls: CheckUrlsFn = vi.fn(async (
      items: BatchCheckRequestItem[],
      onProgress?: (prog: { current_url: string; current_result?: CheckLinkResult }) => void,
    ) => {
      if (vi.mocked(checkUrls).mock.calls.length === 1) {
        const result = makeResult(deadUrl, false);
        onProgress?.({ current_url: deadUrl, current_result: result });
        return makeBatch([result], true);
      }

      const results = items.map((item) => makeResult(item.url, true, item.url === backupUrl ? 20 : 50));
      return makeBatch(results);
    }) as CheckUrlsFn;

    await runLinkCheck({ config, checkUrls });

    expect(scanStage.value).toBe('cancelled');
    expect(readyFiles.value).toEqual(new Set(['C:/docs/done.md']));
    expect(checkUrls).toHaveBeenCalledTimes(2);
    expect(vi.mocked(checkUrls).mock.calls[1][0]).toEqual([{ url: backupUrl }]);
    expect(imageLinks.value[0].backupLinks).toEqual([
      {
        url: backupUrl,
        serviceId: 'mirror',
        checkResult: makeResult(backupUrl, true, 20),
      },
    ]);
    expect(imageLinks.value[1].checkResult).toBeUndefined();
  });
});
