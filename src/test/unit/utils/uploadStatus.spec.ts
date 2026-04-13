import { describe, it, expect } from 'vitest';
import {
  isStatusSuccess,
  isStatusError,
  isStatusUploading,
  getStatusType,
  getStatusLabel,
} from '../../../utils/uploadStatus';

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

describe('getStatusType', () => {
  it('成功状态返回 success', () => {
    expect(getStatusType('✓ 完成')).toBe('success');
  });

  it('错误状态返回 error', () => {
    expect(getStatusType('✗ 失败')).toBe('error');
  });

  it('上传中状态返回 uploading', () => {
    expect(getStatusType('上传中 50%')).toBe('uploading');
  });

  it('未知状态返回 pending', () => {
    expect(getStatusType('等待中')).toBe('pending');
  });

  it('undefined 返回 pending', () => {
    expect(getStatusType(undefined)).toBe('pending');
  });
});

describe('getStatusLabel', () => {
  it('成功状态标签为"已发布"', () => {
    expect(getStatusLabel('✓ 完成')).toBe('已发布');
  });

  it('错误状态标签为"失败"', () => {
    expect(getStatusLabel('✗ 失败')).toBe('失败');
  });

  it('上传中状态标签为"上传中..."', () => {
    expect(getStatusLabel('上传中 80%')).toBe('上传中...');
  });

  it('待机状态标签为"等待中"', () => {
    expect(getStatusLabel(undefined)).toBe('等待中');
  });

  it('等待中状态标签为"等待中"', () => {
    expect(getStatusLabel('等待中')).toBe('等待中');
  });
});
