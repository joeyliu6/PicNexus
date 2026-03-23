import { describe, expect, it } from 'vitest';
import {
  buildHistoryFailureLine,
  buildUploadFailureTooltip,
  normalizeUploadFailureReason,
} from '../../../utils/uploadFailureMessage';

describe('uploadFailureMessage', () => {
  it('normalizes nested upload failure prefixes', () => {
    expect(
      normalizeUploadFailureReason(
        '又拍云',
        '又拍云上传失败: 又拍云上传失败: 上传失败: service error'
      )
    ).toBe('service error');
  });

  it('normalizes serviceId-based failure prefixes when aliases are provided', () => {
    expect(
      normalizeUploadFailureReason(
        '又拍云',
        'upyun 上传失败: 又拍云上传失败: 上传失败: service error',
        ['upyun']
      )
    ).toBe('service error');
  });

  it('builds a retry tooltip with normalized reason', () => {
    expect(
      buildUploadFailureTooltip(
        '又拍云',
        'upyun 上传失败: 又拍云图床上传失败：上传失败：service error',
        ['upyun']
      )
    ).toBe('又拍云上传失败：service error。点击右侧重试。');
  });

  it('builds a history line with fallback text when reason is empty', () => {
    expect(buildHistoryFailureLine('又拍云')).toBe('又拍云：上传失败');
  });
});
