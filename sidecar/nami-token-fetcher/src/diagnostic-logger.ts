const REDACTED = '[REDACTED]';
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>|]+/g;
const UNIX_PATH_PATTERN = /(^|[\s"'`=({,])\/(?:Users|home|tmp|var|private|Volumes)[^\s"'<>)]*/g;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /["']?\b(cookie|token|auth|password|secret|credential|session|authorization|apiKey|accessKey|secretKey|privateKey)\b["']?\s*[:=]\s*("[^"]*"|'[^']*'|[^;,\s}\]]+)/gi;
const SENSITIVE_KEY_PATTERN =
  /(cookie|token|auth|password|secret|credential|session|authorization|apiKey|accessKey|secretKey|privateKey)|(^|[_-])key([_-]|$)/i;

export function logDiagnostic(message: string, details?: unknown): void {
  const suffix = details === undefined ? '' : ` ${safeStringify(redactValue(details, new WeakSet<object>()))}`;
  process.stderr.write(`${sanitizeText(message)}${suffix}\n`);
}

export function writeJsonResult(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function redactValue(value: unknown, seen: WeakSet<object>, key?: string): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';

  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => redactValue(item, seen));
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
      (acc, [entryKey, entryValue]) => {
        acc[entryKey] = redactValue(entryValue, seen, entryKey);
        return acc;
      },
      {},
    );
  } finally {
    seen.delete(value);
  }
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return '[Unserializable]';
  }
}

function sanitizeText(text: string): string {
  const urls: string[] = [];
  let output = text.replace(URL_PATTERN, (url) => {
    const token = `__SIDECAR_URL_${urls.length}__`;
    urls.push(sanitizeUrl(url));
    return token;
  });

  output = output.replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=${REDACTED}`);
  output = output.replace(WINDOWS_PATH_PATTERN, path => sanitizePath(path));
  output = output.replace(UNIX_PATH_PATTERN, (match, prefix: string) => {
    const path = match.slice(prefix.length);
    return `${prefix}${sanitizePath(path)}`;
  });

  return urls.reduce((acc, url, index) => acc.replace(`__SIDECAR_URL_${index}__`, url), output);
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}#url:${shortHash(rawUrl)}`;
  } catch {
    return `[url#${shortHash(rawUrl)}]`;
  }
}

function sanitizePath(rawPath: string): string {
  const basename = rawPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean).pop() || 'path';
  return `[path:${basename}#${shortHash(rawPath)}]`;
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}
