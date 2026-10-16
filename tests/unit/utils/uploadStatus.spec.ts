import { describe, it, expect } from 'vitest';
import {
  isStatusSuccess,
  isStatusError,
  isStatusUploading,
} from '@/utils/uploadStatus';

describe('isStatusSuccess', () => {
  it('包含 ✓ 返回 true', () => {
    expect(isStatusSuccess('✓ 上传成功')).toBe(true);
  });

  it('包含"完成"返回 true', () => {
    expect(isStatusSuccess('上传完成')).toBe(true);
  });

  it('undefined 返回 false', () => {
    expect(isStatusSuccess(undefined)).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(isStatusSuccess('')).toBe(false);
  });

  it('普通文字返回 false', () => {
    expect(isStatusSuccess('等待中')).toBe(false);
  });
});

describe('isStatusError', () => {
  it('包含 ✗ 返回 true', () => {
    expect(isStatusError('✗ 上传失败')).toBe(true);
  });

  it('包含"失败"返回 true', () => {
    expect(isStatusError('网络失败')).toBe(true);
  });

  it('undefined 返回 false', () => {
    expect(isStatusError(undefined)).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(isStatusError('')).toBe(false);
  });

  it('成功状态返回 false', () => {
    expect(isStatusError('✓ 完成')).toBe(false);
  });
});

describe('isStatusUploading', () => {
  it('包含 % 返回 true', () => {
    expect(isStatusUploading('上传中 50%')).toBe(true);
  });

  it('包含"上传"返回 true', () => {
    expect(isStatusUploading('正在上传...')).toBe(true);
  });

  it('包含"准备"返回 true', () => {
    expect(isStatusUploading('准备中...')).toBe(true);
  });

  it('包含步骤格式 (1/3) 返回 true', () => {
    expect(isStatusUploading('步骤 (2/5)')).toBe(true);
  });

  it('包含"等待中"返回 false（即使含有其他关键词也是 false）', () => {
    expect(isStatusUploading('等待中')).toBe(false);
  });

  it('undefined 返回 false', () => {
    expect(isStatusUploading(undefined)).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(isStatusUploading('')).toBe(false);
  });

  it('成功状态返回 false', () => {
    expect(isStatusUploading('✓ 完成')).toBe(false);
  });
});
