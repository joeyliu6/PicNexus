import { describe, it, expect } from 'vitest';
import { buildCsvReport, buildTxtReport } from '@/components/views/linkcheck/migrate/reportExport';
import type { MigrateResult } from '@/types/batchMigrate';

function makeResult(): MigrateResult {
  return {
    successCount: 1,
    failedCount: 0,
    skippedCount: 0,
    failures: [],
    partialFailures: [{ historyId: 'h1', fileName: 'a.png', failedTargets: ['github'] }],
    durationMs: 1000,
    avgBytesPerSec: 1024,
    targetServiceIds: ['r2', 'github'],
    itemsSnapshot: [{
      historyId: 'h1',
      fileName: 'a.png',
      status: 'success',
      serviceResults: { r2: 'success', github: 'failed' },
      existingServiceIds: ['source'],
    }],
  };
}

describe('migrate report export', () => {
  it('CSV 把多目标部分失败标成部分成功，而不是完全成功', () => {
    const csv = buildCsvReport(makeResult());

    expect(csv).toContain('部分成功');
    expect(csv).toContain('部分图床失败');
    expect(csv).toContain('部分成功: 1');
  });

  it('TXT 单独列出部分成功项目', () => {
    const txt = buildTxtReport(makeResult());

    expect(txt).toContain('[部分成功 1]');
    expect(txt).toContain('a.png');
    expect(txt).toContain('失败目标');
  });

  it('CSV 对完全失败项保留上传失败和原始错误信息', () => {
    const result = makeResult();
    result.successCount = 0;
    result.failedCount = 1;
    result.partialFailures = [];
    result.itemsSnapshot = [{
      historyId: 'h1',
      fileName: 'a.png',
      status: 'failed',
      errorType: 'upload',
      error: 'GitHub · bad token',
      serviceResults: { r2: 'failed', github: 'failed' },
      existingServiceIds: ['source'],
    }];

    const csv = buildCsvReport(result);

    expect(csv).toContain('"a.png",失败,上传失败,"GitHub · bad token"');
    expect(csv).not.toContain('部分图床失败');
  });
});
