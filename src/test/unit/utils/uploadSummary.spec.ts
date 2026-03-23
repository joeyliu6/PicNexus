import { describe, expect, it } from 'vitest';
import { buildUploadSummaryToast } from '../../../utils/uploadSummary';

describe('buildUploadSummaryToast', () => {
  // --- 全部成功 ---

  it('单图成功 + 自动复制开：显示「上传成功」和「链接已复制到剪贴板」', () => {
    const payload = buildUploadSummaryToast(
      { total: 1, success: 1, failed: 0 },
      { autoCopyEnabled: true, copiedCount: 1, format: 'markdown' }
    );

    expect(payload).toEqual({
      severity: 'success',
      summary: '上传成功',
      detail: '链接已复制到剪贴板。',
    });
  });

  it('多图成功 + 自动复制开：显示「N 张图片上传完成」和「全部链接已复制」', () => {
    const payload = buildUploadSummaryToast(
      { total: 3, success: 3, failed: 0 },
      { autoCopyEnabled: true, copiedCount: 3, format: 'markdown' }
    );

    expect(payload).toEqual({
      severity: 'success',
      summary: '3 张图片上传完成',
      detail: '全部链接已复制。',
    });
  });

  it('成功 + 自动复制关：detail 为空字符串', () => {
    const payload = buildUploadSummaryToast(
      { total: 1, success: 1, failed: 0 },
      { autoCopyEnabled: false, copiedCount: 0, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'success',
      summary: '上传成功',
      detail: '',
    });
  });

  it('成功 + 复制操作失败：提示手动复制', () => {
    const payload = buildUploadSummaryToast(
      { total: 2, success: 2, failed: 0 },
      { autoCopyEnabled: true, copiedCount: 0, format: 'html', copyFailed: true }
    );

    expect(payload).toEqual({
      severity: 'success',
      summary: '2 张图片上传完成',
      detail: '链接复制失败，请手动复制。',
    });
  });

  // --- 全部失败 ---

  it('全部失败：显示 error toast', () => {
    const payload = buildUploadSummaryToast(
      { total: 2, success: 0, failed: 2 },
      { autoCopyEnabled: true, copiedCount: 0, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'error',
      summary: '上传失败',
      detail: '所有图片上传失败，请检查网络或图床配置',
    });
  });

  it('total 为 0 时返回 null', () => {
    const payload = buildUploadSummaryToast(
      { total: 0, success: 0, failed: 0 },
      { autoCopyEnabled: true, copiedCount: 0, format: 'url' }
    );

    expect(payload).toBeNull();
  });

  // --- 有整张图失败 ---

  it('部分图片整体失败 + 自动复制开：summary 显示成功和失败张数', () => {
    const payload = buildUploadSummaryToast(
      { total: 5, success: 3, failed: 2 },
      { autoCopyEnabled: true, copiedCount: 3, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'warn',
      summary: '3 张成功，2 张失败',
      detail: '成功的链接已复制。失败项可在队列中重试。',
    });
  });

  it('部分图片整体失败 + 自动复制关：detail 只有行动引导', () => {
    const payload = buildUploadSummaryToast(
      { total: 5, success: 3, failed: 2 },
      { autoCopyEnabled: false, copiedCount: 0, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'warn',
      summary: '3 张成功，2 张失败',
      detail: '失败项可在队列中重试。',
    });
  });

  // --- 部分图床失败（图片有主力链接，某图床挂了）---

  it('单图 + 单图床失败：summary 包含图床名称', () => {
    const payload = buildUploadSummaryToast(
      {
        total: 1,
        success: 1,
        failed: 0,
        partialServiceFailureCount: 1,
        partialFailedServices: [{ serviceName: '又拍云', count: 1 }],
      },
      { autoCopyEnabled: true, copiedCount: 1, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'warn',
      summary: '上传完成，又拍云上传失败',
      detail: '成功的链接已复制。可在队列中对失败项重试。',
    });
  });

  it('多图 + 单图床失败多张：summary 显示图床名和失败张数', () => {
    const payload = buildUploadSummaryToast(
      {
        total: 2,
        success: 2,
        failed: 0,
        partialServiceFailureCount: 2,
        partialFailedServices: [{ serviceName: '又拍云', count: 2 }],
      },
      { autoCopyEnabled: true, copiedCount: 2, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'warn',
      summary: '2 张图片上传完成，又拍云（2 张）上传失败',
      detail: '成功的链接已复制。可在队列中对失败项重试。',
    });
  });

  it('多图床同时失败：summary 包含多个图床名称', () => {
    const payload = buildUploadSummaryToast(
      {
        total: 1,
        success: 1,
        failed: 0,
        partialServiceFailureCount: 2,
        partialFailedServices: [
          { serviceName: '腾讯云', count: 1 },
          { serviceName: '又拍云', count: 1 },
        ],
      },
      { autoCopyEnabled: true, copiedCount: 1, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'warn',
      summary: '上传完成，腾讯云、又拍云上传失败',
      detail: '成功的链接已复制。可在队列中对失败项重试。',
    });
  });

  it('图床部分失败 + 自动复制关：detail 只有行动引导', () => {
    const payload = buildUploadSummaryToast(
      {
        total: 1,
        success: 1,
        failed: 0,
        partialServiceFailureCount: 1,
        partialFailedServices: [{ serviceName: '又拍云', count: 1 }],
      },
      { autoCopyEnabled: false, copiedCount: 0, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'warn',
      summary: '上传完成，又拍云上传失败',
      detail: '可在队列中对失败项重试。',
    });
  });
});
