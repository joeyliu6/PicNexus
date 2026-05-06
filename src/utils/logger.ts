import { debug, info, warn, error, type LogOptions } from '@tauri-apps/plugin-log';

type LogFn = (message: string, options?: LogOptions) => Promise<void>;

const MAX_LOG_DEPTH = 5;
const MAX_STRING_LENGTH = 600;
const MAX_KEY_VALUES = 20;
const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';

const SENSITIVE_KEY_PATTERN =
  /(cookie|token|auth|password|secret|credential|session|authorization|apiKey|accessKey|secretKey|privateKey)|(^|[_-])key([_-]|$)/i;

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>|]+/g;
const UNIX_PATH_PATTERN = /(^|[\s"'`=([{,])\/(?:Users|home|tmp|var|private|Volumes)[^\s"'<>)]*/g;
const SECRET_ASSIGNMENT_PATTERN =
  /["']?\b(cookie|token|auth|password|secret|credential|session|authorization|apiKey|accessKey|secretKey|privateKey)\b["']?\s*[:=]\s*("[^"]*"|'[^']*'|[^;,\s}\]]+)/gi;
const AUTHORIZATION_HEADER_PATTERN =
  /\b(authorization)\b\s*[:=]\s*("[^"]*"|'[^']*'|(?:Bearer|Basic|token|Client-ID)\s+[A-Za-z0-9._~+/=-]+|[^;,\s}\]]+)/gi;
const COOKIE_HEADER_PATTERN =
  /\b(cookie)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^,\r\n}\]]+)/gi;

class Logger {
  constructor(private readonly module: string) {}

  debug(msg: string, ...args: unknown[]): void {
    this.write(debug, msg, args);
  }

  info(msg: string, ...args: unknown[]): void {
    this.write(info, msg, args);
  }

  warn(msg: string, ...args: unknown[]): void {
    this.write(warn, msg, args);
  }

  error(msg: string, ...args: unknown[]): void {
    this.write(error, msg, args);
  }

  private write(fn: LogFn, msg: string, args: unknown[]): void {
    const formatted = this.format(msg, args);
    void fn(formatted.message, formatted.options);
  }

  private format(msg: string, args: unknown[]): { message: string; options?: LogOptions } {
    const safeMessage = redactText(msg);
    if (args.length === 0) return { message: `[${this.module}] ${safeMessage}` };

    const redactedArgs = args.map(arg => redactForLog(arg));
    const extra = redactedArgs.map(arg => safeStringify(arg)).join(' ');
    const keyValues = args.length === 1 ? toKeyValues(redactedArgs[0]) : undefined;

    return {
      message: `[${this.module}] ${safeMessage} ${extra}`,
      options: keyValues ? { keyValues } : undefined,
    };
  }
}

/**
 * 递归脱敏任意日志参数。logger 必须 infallible，不能让日志遮蔽真实业务错误。
 */
export function redactForLog(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>(), 0);
}

export function safeStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    try {
      return Object.prototype.toString.call(value);
    } catch {
      return '[Unserializable]';
    }
  }
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number, key?: string): unknown {
  if (key && isSensitiveKey(key)) return REDACTED;
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
    };
  }

  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return CIRCULAR;
  if (depth >= MAX_LOG_DEPTH) return `[${getObjectName(value)}]`;

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map(item => redactValue(item, seen, depth + 1));
    }

    const record = value as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(record)) {
      redacted[entryKey] = redactValue(entryValue, seen, depth + 1, entryKey);
    }
    return redacted;
  } finally {
    seen.delete(value);
  }
}

function redactText(text: string): string {
  if (!text) return text;

  const urls: string[] = [];
  let output = text.replace(URL_PATTERN, (url) => {
    const token = `__LOG_URL_${urls.length}__`;
    urls.push(redactUrl(url));
    return token;
  });

  output = output.replace(AUTHORIZATION_HEADER_PATTERN, (_match, key: string) => `${key}=${REDACTED}`);
  output = output.replace(COOKIE_HEADER_PATTERN, (_match, key: string) => `${key}=${REDACTED}`);
  output = output.replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=${REDACTED}`);
  output = output.replace(WINDOWS_PATH_PATTERN, path => redactPath(path));
  output = output.replace(UNIX_PATH_PATTERN, (match, prefix: string) => {
    const path = match.slice(prefix.length);
    return `${prefix}${redactPath(path)}`;
  });

  output = urls.reduce(
    (acc, url, index) => acc.replace(`__LOG_URL_${index}__`, url),
    output,
  );

  return truncate(output, MAX_STRING_LENGTH);
}

function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}#url:${shortHash(rawUrl)}`;
  } catch {
    return `[url#${shortHash(rawUrl)}]`;
  }
}

function redactPath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const basename = normalized.split('/').filter(Boolean).pop() || 'path';
  return `[path:${basename}#${shortHash(rawPath)}]`;
}

function toKeyValues(value: unknown): Record<string, string | undefined> | undefined {
  if (!isPlainRecord(value)) return undefined;

  const entries = Object.entries(value).slice(0, MAX_KEY_VALUES);
  if (entries.length === 0) return undefined;

  return entries.reduce<Record<string, string | undefined>>((acc, [key, entryValue]) => {
    acc[key] = safeStringify(entryValue);
    return acc;
  }, {});
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...<truncated:${value.length}>`;
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

function getObjectName(value: object): string {
  return value.constructor?.name || 'Object';
}

export function createLogger(module: string): Logger {
  return new Logger(module);
}
