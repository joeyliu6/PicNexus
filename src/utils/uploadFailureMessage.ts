function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimLeadingSeparators(value: string): string {
  return value.replace(/^[\s:：;；，,。.()（）-]+/u, '').trim();
}

function ensureTrailingPeriod(value: string): string {
  return /[。！？.!?]$/u.test(value) ? value : `${value}。`;
}

function buildPrefixPatterns(serviceName: string, aliases: string[]): RegExp[] {
  const namedPatterns = [serviceName, ...aliases]
    .map(name => name.trim())
    .filter(Boolean)
    .map(name => new RegExp(`^${escapeRegExp(name)}\\s*(?:图床)?\\s*上传失败\\s*`, 'iu'));

  return [
    ...namedPatterns,
    /^[a-z0-9_-]+\s*上传失败\s*/iu,
    /^上传失败\s*/iu,
    /^upload failed\s*/iu,
  ];
}

export function normalizeUploadFailureReason(
  serviceName: string,
  error?: string,
  aliases: string[] = []
): string {
  let reason = (error || '').trim();
  if (!reason) return '';

  const patterns = buildPrefixPatterns(serviceName, aliases);
  let previous = '';

  while (reason && reason !== previous) {
    previous = reason;
    for (const pattern of patterns) {
      reason = trimLeadingSeparators(reason.replace(pattern, ''));
    }
  }

  return reason;
}

export function buildUploadFailureTooltip(
  serviceName: string,
  error?: string,
  aliases: string[] = []
): string {
  const reason = normalizeUploadFailureReason(serviceName, error, aliases);
  if (!reason) {
    return `${serviceName}上传失败。点击右侧重试。`;
  }

  return `${serviceName}上传失败：${ensureTrailingPeriod(reason)}点击右侧重试。`;
}

