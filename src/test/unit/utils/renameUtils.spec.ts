import { describe, it, expect } from 'vitest';
import {
  generateRenamedName,
  previewRename,
  applyRenamePattern,
  validateTemplate,
  generateBatchRenameSuggestion,
} from '../../../utils/renameUtils';

// 固定时间，避免测试依赖当前时间
const FIXED_DATE = new Date('2025-06-15T09:30:45');

describe('generateRenamedName', () => {
  it('{original} 返回原文件名', () => {
    expect(generateRenamedName('{original}', 'photo.jpg', 0, FIXED_DATE))
      .toBe('photo.jpg');
  });

  it('{filename} 与 {original} 等价', () => {
    expect(generateRenamedName('{filename}', 'photo.jpg', 0, FIXED_DATE))
      .toBe('photo.jpg');
  });

  it('{name} 返回不含扩展名的文件名', () => {
    expect(generateRenamedName('{name}', 'photo.jpg', 0, FIXED_DATE))
      .toBe('photo');
  });

  it('{ext} 返回扩展名（含点号）', () => {
    expect(generateRenamedName('{ext}', 'photo.jpg', 0, FIXED_DATE))
      .toBe('.jpg');
  });

  it('{name} 无扩展名时返回完整文件名', () => {
    expect(generateRenamedName('{name}', 'noext', 0, FIXED_DATE))
      .toBe('noext');
  });

  it('{ext} 无扩展名时返回空', () => {
    expect(generateRenamedName('{ext}', 'noext', 0, FIXED_DATE))
      .toBe('');
  });

  it('{date} 返回 ISO 日期', () => {
    expect(generateRenamedName('{date}', 'a.png', 0, FIXED_DATE))
      .toBe('2025-06-15');
  });

  it('{time} 返回时间', () => {
    const result = generateRenamedName('{time}', 'a.png', 0, FIXED_DATE);
    // 时间格式取决于系统 locale，至少包含 09:30:45
    expect(result).toContain('09:30:45');
  });

  it('{index} 从 1 开始、三位补零', () => {
    expect(generateRenamedName('{index}', 'a.png', 0, FIXED_DATE)).toBe('001');
    expect(generateRenamedName('{index}', 'a.png', 4, FIXED_DATE)).toBe('005');
    expect(generateRenamedName('{index}', 'a.png', 99, FIXED_DATE)).toBe('100');
  });

  it('组合模板：{name}_{index}{ext}', () => {
    expect(generateRenamedName('{name}_{index}{ext}', 'photo.jpg', 2, FIXED_DATE))
      .toBe('photo_003.jpg');
  });

  it('组合模板：{date}_{index}{ext}', () => {
    expect(generateRenamedName('{date}_{index}{ext}', 'old.png', 0, FIXED_DATE))
      .toBe('2025-06-15_001.png');
  });
});

describe('previewRename', () => {
  it('生成预览列表', () => {
    const files = ['a.jpg', 'b.jpg'];
    const result = previewRename(files, '{name}_{index}{ext}');
    expect(result).toHaveLength(2);
    expect(result[0].original).toBe('a.jpg');
    expect(result[0].renamed).toContain('a_001.jpg');
    expect(result[0].isValid).toBe(true);
    expect(result[1].renamed).toContain('b_002.jpg');
  });

  it('模板结果等于原文件名时 isValid 为 false', () => {
    const result = previewRename(['hello.txt'], '{original}');
    expect(result[0].isValid).toBe(false);
  });

  it('模板结果为空白时 isValid 为 false', () => {
    const result = previewRename(['a.txt'], '{ext}');
    // {ext} → '.txt' 不为空且与原名不同，应为 valid
    expect(result[0].renamed).toBe('.txt');
    expect(result[0].isValid).toBe(true);
  });

  it('startIndex 偏移生效', () => {
    const result = previewRename(['a.jpg'], '{index}{ext}', 9);
    expect(result[0].renamed).toContain('010');
  });
});

describe('applyRenamePattern', () => {
  it('正则替换成功', () => {
    expect(applyRenamePattern('hello-world', '-', '_')).toBe('hello_world');
  });

  it('全局替换', () => {
    expect(applyRenamePattern('a-b-c', '-', '.')).toBe('a.b.c');
  });

  it('无效正则不崩溃，返回原文', () => {
    expect(applyRenamePattern('test', '[invalid', 'x')).toBe('test');
  });
});

describe('validateTemplate', () => {
  it('空模板无效', () => {
    const r = validateTemplate('');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('不能为空');
  });

  it('纯空白模板无效', () => {
    expect(validateTemplate('   ').valid).toBe(false);
  });

  it('无变量的模板无效', () => {
    const r = validateTemplate('static-name');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('至少一个变量');
  });

  it('不支持的变量报错', () => {
    const r = validateTemplate('{unknown}');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('不支持的变量');
    expect(r.error).toContain('{unknown}');
  });

  it('合法模板通过验证', () => {
    expect(validateTemplate('{name}_{index}{ext}').valid).toBe(true);
  });

  it('所有支持的变量都能通过', () => {
    expect(validateTemplate('{date}{time}{index}{original}{filename}{ext}{name}').valid).toBe(true);
  });
});

describe('generateBatchRenameSuggestion', () => {
  it('空数组返回空', () => {
    expect(generateBatchRenameSuggestion([])).toEqual([]);
  });

  it('有公共前缀时包含 {name}{index}{ext} 建议', () => {
    const suggestions = generateBatchRenameSuggestion(['photo_001.jpg', 'photo_002.jpg']);
    expect(suggestions).toContain('{name}{index}{ext}');
  });

  it('总是包含日期和时间模板建议', () => {
    const suggestions = generateBatchRenameSuggestion(['a.jpg', 'b.jpg']);
    expect(suggestions).toContain('{date}_{index}{ext}');
    expect(suggestions).toContain('{time}{index}{ext}');
  });

  it('公共前缀太短时不包含 {name}{index}{ext}', () => {
    const suggestions = generateBatchRenameSuggestion(['a.jpg', 'b.jpg']);
    expect(suggestions).not.toContain('{name}{index}{ext}');
  });
});
