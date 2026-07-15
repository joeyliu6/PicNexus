import { describe, it, expect } from 'vitest';
import { middleTruncate } from '@/utils/pathUtils';

describe('middleTruncate', () => {
  it('短路径不截断', () => {
    expect(middleTruncate('C:\\a\\b.txt', 50)).toBe('C:\\a\\b.txt');
  });

  it('空路径返回省略号', () => {
    expect(middleTruncate('', 50)).toBe('...');
  });

  it('Windows 长路径中间截断', () => {
    const path = 'C:\\Users\\test\\Documents\\very\\deep\\nested\\file.txt';
    const result = middleTruncate(path, 30);

    expect(result).toContain('C:\\Users');
    expect(result).toContain('file.txt');
    expect(result).toContain('\u2026'); // 省略号
    expect(result.length).toBeLessThanOrEqual(30); // 合理长度
  });

  it('Unix 长路径中间截断', () => {
    const path = '/home/user/documents/very/deep/nested/file.txt';
    const result = middleTruncate(path, 30);

    expect(result).toContain('/home');
    expect(result).toContain('file.txt');
    expect(result).toContain('\u2026');
  });

  it('路径段 <= 3 时字符截断', () => {
    const path = 'ab/cd';
    const result = middleTruncate(path, 3);

    expect(result.length).toBeLessThanOrEqual(3);
    expect(result).toContain('\u2026');
  });

  it('maxChars 小于固定部分时只显示首尾和省略号', () => {
    const path = 'C:\\Users\\test\\deep\\file.txt';
    const result = middleTruncate(path, 15);

    expect(result.length).toBeLessThanOrEqual(15);
    expect(result).toContain('\u2026');
  });

  it('maxChars 极小时不会因为 slice(-0) 返回超长内容', () => {
    expect(middleTruncate('abcdef', 1)).toBe('\u2026');
    expect(middleTruncate('abcdef', 0)).toBe('');
    expect(middleTruncate('', 2)).toBe('..');
  });
});
