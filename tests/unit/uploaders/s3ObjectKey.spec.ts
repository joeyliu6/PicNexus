// S3 对象名生成测试
// 覆盖：唯一化前缀（同名不同 key）、路径前缀归一化、原文件名与扩展名保留

import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildObjectKey } from '@/uploaders/s3/objectKey';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 冻结日期 + 固定随机数，让 key 变成可断言的确定值 */
function freeze(date: string, random: number): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(date));
  vi.spyOn(Math, 'random').mockReturnValue(random);
}

describe('buildObjectKey', () => {
  it('两次上传同名文件生成不同 key（消除同名覆盖）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T10:00:00'));
    const randoms = [0.1, 0.9];
    let call = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => randoms[call++]);

    const first = buildObjectKey('images', 'screenshot.png');
    const second = buildObjectKey('images', 'screenshot.png');

    expect(first).not.toBe(second);
    // 原文件名（含扩展名）保留在末尾，Rust 侧才能按扩展名推断 Content-Type
    expect(first.endsWith('_screenshot.png')).toBe(true);
    expect(second.endsWith('_screenshot.png')).toBe(true);
  });

  it('key 形如 {path}/{yyyyMMdd}_{4位随机}_{原文件名}', () => {
    freeze('2026-08-13T10:00:00', 0);

    expect(buildObjectKey('images', 'a.png')).toBe('images/20260813_0000_a.png');
  });

  it('随机段定长 4 位，取到最大值也不进位', () => {
    // 0.999999… → floor 到 36^4 - 1 = 1679615 → base36 "zzzz"
    freeze('2026-08-13T10:00:00', 0.9999999);

    expect(buildObjectKey('', 'a.png')).toBe('20260813_zzzz_a.png');
  });

  it('日期按本地时区取，月/日补零', () => {
    freeze('2026-01-05T23:30:00', 0);

    expect(buildObjectKey('', 'a.png')).toBe('20260105_0000_a.png');
  });

  it('path 结尾有无斜杠都归一化为单个斜杠', () => {
    freeze('2026-08-13T10:00:00', 0);

    expect(buildObjectKey('images/', 'a.png')).toBe('images/20260813_0000_a.png');
    expect(buildObjectKey('a/b', 'a.png')).toBe('a/b/20260813_0000_a.png');
  });

  it('path 为空时不产生前导斜杠（避免桶内多出一层空目录）', () => {
    freeze('2026-08-13T10:00:00', 0);

    const key = buildObjectKey('', 'a.png');
    expect(key.startsWith('/')).toBe(false);
    expect(key).toBe('20260813_0000_a.png');
  });
});
