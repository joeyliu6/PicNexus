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

/** 创建变量解析器，now 为固定时间戳以保证同批次一致性 */
function createVariableResolvers(now: Date): Record<string, (original: string, index: number) => string> {
  return {
    '{date}': () => now.toISOString().split('T')[0],
    '{time}': () => now.toTimeString().split(' ')[0],
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
    },
  };
}

/** 支持的变量名列表（用于模板校验） */
const SUPPORTED_VARIABLES = ['{date}', '{time}', '{index}', '{original}', '{filename}', '{ext}', '{name}'];

export function parseRenameTemplate(template: string): RenamePattern {
  return {
    pattern: template,
    replacement: template
  };
}

export function generateRenamedName(template: string, original: string, index: number, now?: Date): string {
  let result = template;
  const resolvers = createVariableResolvers(now ?? new Date());

  for (const [variable, generator] of Object.entries(resolvers)) {
    result = result.split(variable).join(generator(original, index));
  }

  return result;
}

export function previewRename(
  files: string[],
  template: string,
  startIndex: number = 0
): RenamePreview[] {
  const now = new Date();
  return files.map((file, index) => {
    const renamed = generateRenamedName(template, file, startIndex + index, now);
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
    if (!SUPPORTED_VARIABLES.includes(variable)) {
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

  const suggestions: string[] = [];

  if (commonPrefix.length > 3) {
    suggestions.push(`{name}{index}{ext}`);
  }

  suggestions.push(`{date}_{index}{ext}`);
  suggestions.push(`{time}{index}{ext}`);

  return suggestions;
}
