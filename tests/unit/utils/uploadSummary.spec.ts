import { describe, expect, it } from 'vitest';
import { buildUploadSummaryToast } from '@/utils/uploadSummary';

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

  // 同首页卡片与重试通知：原因 + 处理办法（交接说明第 9 节），单张写文件名，多张写张数
  const TIMEOUT = { fileName: '会议截图.png', reason: '网络超时', advice: '请检查网络后重试' };

  it('单张全部失败：标题写文件名，说明写原因与处理办法', () => {
    const payload = buildUploadSummaryToast(
      { total: 1, success: 0, failed: 1, firstFailure: TIMEOUT },
      { autoCopyEnabled: true, copiedCount: 0, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'error',
      summary: '会议截图.png 上传失败',
      detail: '网络超时，请检查网络后重试',
    });
  });

  it('多张全部失败：标题写张数，说明照第一张的原因', () => {
    const payload = buildUploadSummaryToast(
      { total: 2, success: 0, failed: 2, firstFailure: TIMEOUT },
      { autoCopyEnabled: true, copiedCount: 0, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'error',
      summary: '2 张上传失败',
      detail: '网络超时，请检查网络后重试',
    });
  });

  it('全部失败但不知道原因：给出处理办法', () => {
    const payload = buildUploadSummaryToast(
      { total: 1, success: 0, failed: 1 },
      { autoCopyEnabled: true, copiedCount: 0, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'error',
      summary: '上传失败',
      detail: '请检查网络或图床配置后重试',
    });
  });

  it('total 为 0 且无重复：返回 null', () => {
    const payload = buildUploadSummaryToast(
      { total: 0, success: 0, failed: 0 },
      { autoCopyEnabled: true, copiedCount: 0, format: 'url' }
    );

    expect(payload).toBeNull();
  });

  // --- 重复路径被忽略 ---

  it('total 为 0 但有重复路径：返回 warn 提示已忽略', () => {
    const payload = buildUploadSummaryToast(
      { total: 0, success: 0, failed: 0, duplicatesSkipped: 3 },
      { autoCopyEnabled: true, copiedCount: 0, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'warn',
      summary: '已忽略重复文件',
      detail: '3 张文件正在上传，无需重复添加。',
    });
  });

  it('全部成功 + 部分重复被忽略：升级为 warn 并附加提示', () => {
    const payload = buildUploadSummaryToast(
      { total: 3, success: 3, failed: 0, duplicatesSkipped: 2 },
      { autoCopyEnabled: true, copiedCount: 3, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'warn',
      summary: '3 张图片上传完成',
      detail: '全部链接已复制。已忽略 2 张重复文件。',
    });
  });

  it('全部失败 + 部分重复被忽略：error toast 末尾追加提示', () => {
    const payload = buildUploadSummaryToast(
      { total: 2, success: 0, failed: 2, duplicatesSkipped: 1, firstFailure: { fileName: 'a.png', reason: '网络超时', advice: '请检查网络后重试' } },
      { autoCopyEnabled: false, copiedCount: 0, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'error',
      summary: '2 张上传失败',
      detail: '网络超时，请检查网络后重试。已忽略 1 张重复文件。',
    });
  });

  it('部分图床失败 + 部分重复被忽略：detail 末尾追加重复提示', () => {
    const payload = buildUploadSummaryToast(
      {
        total: 2,
        success: 2,
        failed: 0,
        partialServiceFailureCount: 1,
        partialFailedServices: [{ serviceName: '又拍云', count: 1 }],
        duplicatesSkipped: 4,
      },
      { autoCopyEnabled: true, copiedCount: 2, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'warn',
      summary: '2 张图片上传完成，又拍云上传失败',
      detail: '成功的链接已复制。可在首页重试失败的图床。已忽略 4 张重复文件。',
    });
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
      detail: '成功的链接已复制。可在首页重试失败的图片。',
    });
  });

  it('部分图片整体失败：先说第一张失败的原因', () => {
    const payload = buildUploadSummaryToast(
      { total: 5, success: 3, failed: 2, firstFailure: { fileName: 'b.png', reason: '网络超时', advice: '请检查网络后重试' } },
      { autoCopyEnabled: true, copiedCount: 3, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'warn',
      summary: '3 张成功，2 张失败',
      detail: '网络超时。成功的链接已复制。可在首页重试失败的图片。',
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
      detail: '可在首页重试失败的图片。',
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
      detail: '成功的链接已复制。可在首页重试失败的图床。',
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
      detail: '成功的链接已复制。可在首页重试失败的图床。',
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
      detail: '成功的链接已复制。可在首页重试失败的图床。',
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
      detail: '可在首页重试失败的图床。',
    });
  });

  it('单个图床失败：先说这个图床为什么失败', () => {
    const payload = buildUploadSummaryToast(
      {
        total: 1,
        success: 1,
        failed: 0,
        partialServiceFailureCount: 1,
        partialFailedServices: [{ serviceName: '七鱼', count: 1, reason: '网络超时' }],
      },
      { autoCopyEnabled: true, copiedCount: 1, format: 'url' }
    );

    expect(payload).toEqual({
      severity: 'warn',
      summary: '上传完成，七鱼上传失败',
      detail: '网络超时。成功的链接已复制。可在首页重试失败的图床。',
    });
  });
});
