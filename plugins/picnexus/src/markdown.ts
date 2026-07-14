export interface TextRange {
  start: number;
  end: number;
}

export function escapeMarkdownText(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1');
}

export function escapeMarkdownUrl(value: string): string {
  return value.replace(/([\\()])/g, '\\$1');
}

export function formatMarkdownImage(name: string, url: string): string {
  return `![${escapeMarkdownText(name)}](${escapeMarkdownUrl(url)})`;
}

export function createUploadPlaceholder(fileName: string, uploadId: string): string {
  return `![Uploading ${escapeMarkdownText(fileName)}...](#picnexus-upload-${uploadId})`;
}

export function findPlaceholderRange(content: string, placeholder: string): TextRange | null {
  const start = content.indexOf(placeholder);
  return start === -1 ? null : { start, end: start + placeholder.length };
}
