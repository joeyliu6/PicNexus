// src/utils/renameUtils.ts
// 批量重命名工具函数

export interface RenamePattern {
  pattern: string;
  replacement: string;
}

export interface RenamePreview {
  original: string;
  renamed: string;
  isValid: boolean;
}

const VARIABLE_PATTERNS: Record<string, (original: string, index: number) => string> = {
  '{date}': () => new Date().toISOString().split('T')[0],
  '{time}': () => new Date().toTimeString().split(' ')[0],
  '{index}': (_: string, index: number) => String(index + 1).padStart(3, '0'),
  '{original}': (original: string) => original,
  '{filename}': (original: string) => original,
  '{ext}': (original: string) => {
    const lastDot = original.lastIndexOf('.');
    return lastDot !== -1 ? original.substring(lastDot) : '';
  },
  '{name}': (original: string) => {
    const lastDot = original.lastIndexOf('.');
    return lastDot !== -1 ? original.substring(0, lastDot) : original;
  }
};

export function parseRenameTemplate(template: string): RenamePattern {
  return {
    pattern: template,
    replacement: template
  };
}

export function generateRenamedName(template: string, original: string, index: number): string {
  let result = template;

  Object.entries(VARIABLE_PATTERNS).forEach(([variable, generator]) => {
    result = result.replace(new RegExp(variable, 'g'), generator(original, index));
  });

  return result;
}

export function previewRename(
  files: string[],
  template: string,
  startIndex: number = 0
): RenamePreview[] {
  return files.map((file, index) => {
    const renamed = generateRenamedName(template, file, startIndex + index);
    const isValid = renamed !== file && renamed.trim().length > 0;

    return {
      original: file,
      renamed,
      isValid
    };
  });
}

export function applyRenamePattern(
  text: string,
  pattern: string,
  replacement: string
): string {
  try {
    const regex = new RegExp(pattern, 'g');
    return text.replace(regex, replacement);
  } catch {
    return text;
  }
}

export function validateTemplate(template: string): { valid: boolean; error?: string } {
  if (!template || template.trim().length === 0) {
    return { valid: false, error: '模板不能为空' };
  }

  const variableMatches = template.match(/\{[^}]+\}/g);
  if (!variableMatches || variableMatches.length === 0) {
    return { valid: false, error: '模板必须包含至少一个变量（如 {filename}）' };
  }

  for (const variable of variableMatches) {
    if (!VARIABLE_PATTERNS[variable]) {
      return { valid: false, error: `不支持的变量: ${variable}` };
    }
  }

  return { valid: true };
}

export function generateBatchRenameSuggestion(files: string[]): string[] {
  if (files.length === 0) return [];

  const commonPrefix = files.reduce((prefix, file) => {
    let i = 0;
    while (i < Math.min(prefix.length, file.length) && prefix[i] === file[i]) {
      i++;
    }
    return prefix.substring(0, i);
  }, files[0]);

  files.reduce((_suffix, _file) => {
    let i = 0;
    while (i < Math.min(_suffix.length, _file.length) &&
           _suffix[_suffix.length - 1 - i] === _file[_file.length - 1 - i]) {
      i++;
    }
    return _suffix.substring(_suffix.length - i);
  }, files[0]);

  const suggestions: string[] = [];

  if (commonPrefix.length > 3) {
    suggestions.push(`{name}{index}{ext}`);
  }

  suggestions.push(`{date}_{index}{ext}`);
  suggestions.push(`{time}{index}{ext}`);

  return suggestions;
}
