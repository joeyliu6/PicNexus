import { describe, it, expect } from 'vitest';
import { getStatusChipMeta } from '../../../../../components/views/linkcheck/migrate/composables/useStatusChip';
import type { MigrateItemStatus } from '../../../../../types/batchMigrate';

type Status = MigrateItemStatus['status'];

describe('getStatusChipMeta', () => {
  it('pending → 等待', () => {
    const meta = getStatusChipMeta({ status: 'pending' });
    expect(meta.variant).toBe('pending');
    expect(meta.label).toBe('等待');
    expect(meta.tone).toBe('pending');
    expect(meta.spinning).toBe(false);
  });

  it.each<[Status, string]>([
    ['downloading', '下载中'],
    ['converting', '转换中'],
    ['uploading', '上传中'],
  ])('%s → active tone + spinning', (status, label) => {
    const meta = getStatusChipMeta({ status });
    expect(meta.label).toBe(label);
    expect(meta.tone).toBe('active');
    expect(meta.spinning).toBe(true);
    expect(meta.icon).toContain('pi-spin');
  });

  it('success 无 convertedFormat → 已完成', () => {
    const meta = getStatusChipMeta({ status: 'success' });
    expect(meta.variant).toBe('success');
    expect(meta.label).toBe('已完成');
    expect(meta.tone).toBe('success');
  });

  it('success 带 convertedFormat → 已转 WEBP', () => {
    const meta = getStatusChipMeta({ status: 'success', convertedFormat: 'webp' });
    expect(meta.variant).toBe('success-converted');
    expect(meta.label).toBe('已转 WEBP');
    expect(meta.tone).toBe('success');
  });

  it('skipped → 已存在 warning tone', () => {
    const meta = getStatusChipMeta({ status: 'skipped' });
    expect(meta.variant).toBe('skipped');
    expect(meta.label).toBe('已存在');
    expect(meta.tone).toBe('warning');
  });

  it('failed + download → warning tone 下载失败', () => {
    const meta = getStatusChipMeta({ status: 'failed', errorType: 'download' });
    expect(meta.variant).toBe('fail-download');
    expect(meta.label).toBe('下载失败');
    expect(meta.tone).toBe('warning');
  });

  it('failed + upload → error tone 上传失败', () => {
    const meta = getStatusChipMeta({ status: 'failed', errorType: 'upload' });
    expect(meta.variant).toBe('fail-upload');
    expect(meta.label).toBe('上传失败');
    expect(meta.tone).toBe('error');
  });

  it('failed 无 errorType → 失败（error tone 兜底）', () => {
    const meta = getStatusChipMeta({ status: 'failed' });
    expect(meta.variant).toBe('failed');
    expect(meta.label).toBe('失败');
    expect(meta.tone).toBe('error');
  });

  it('variant 字符串稳定（相同输入多次调用返回同 variant，用于 Vue transition key）', () => {
    const a = getStatusChipMeta({ status: 'uploading' });
    const b = getStatusChipMeta({ status: 'uploading' });
    expect(a.variant).toBe(b.variant);
  });
});
