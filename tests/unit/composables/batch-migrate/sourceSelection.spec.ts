// 补充备份从哪几份下载：检测过且失效的不试（真机走查：「复制时使用」的 R2 失效、京东正常的图，备份时只试 R2，下载 404）
import { describe, expect, it } from 'vitest';
import type { HistoryItem } from '@/config/types';
import { getBackupSourceIds, getSourceCandidatesForStatus } from '@/composables/batch-migrate/sourceSelection';

type Saved = NonNullable<HistoryItem['linkCheckStatus']>[string];
const saved = (patch: Partial<Saved>): Saved => ({ isValid: false, lastCheckTime: 1, errorType: 'http_4xx', statusCode: 404, ...patch });

function item(linkCheckStatus: HistoryItem['linkCheckStatus'], hosts = ['r2', 'jd']): HistoryItem {
  return {
    id: 'a', timestamp: 1, localFileName: 'a.png', filePath: null, primaryService: hosts[0], generatedLink: '',
    results: hosts.map((serviceId) => ({ serviceId, status: 'success', result: { serviceId, fileKey: serviceId, url: `https://${serviceId}.example/a.png` } })),
    linkCheckStatus,
  } as unknown as HistoryItem;
}

describe('getBackupSourceIds', () => {
  it('复制时使用的那份失效：只从正常的备份下载', () => {
    const it1 = item({ r2: saved({}), jd: saved({ isValid: true, errorType: 'success', statusCode: 200 }) });
    expect(getBackupSourceIds(it1)).toEqual(['jd']);
    const candidates = getSourceCandidatesForStatus(it1, undefined, undefined, getBackupSourceIds(it1));
    expect(candidates.map((c) => c.serviceId)).toEqual(['jd']);
  });

  it('尚未检测、排队中、可能受限的都当作可用；超时与拒绝访问算失效', () => {
    expect(getBackupSourceIds(item(undefined))).toEqual(['r2', 'jd']);
    expect(getBackupSourceIds(item({ r2: saved({ errorType: 'pending' }), jd: saved({ errorType: 'redirect', statusCode: 302 }) }))).toEqual(['r2', 'jd']);
    expect(getBackupSourceIds(item({ r2: saved({ errorType: 'http_4xx', statusCode: 403, browserMightWork: true }) }))).toEqual(['r2', 'jd']);
    expect(getBackupSourceIds(item({ r2: saved({ errorType: 'timeout', statusCode: undefined }), jd: saved({ statusCode: 403 }) }))).toEqual([]);
  });
});
