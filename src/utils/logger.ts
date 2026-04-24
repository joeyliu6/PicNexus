import { debug, info, warn, error } from '@tauri-apps/plugin-log';

class Logger {
  constructor(private readonly module: string) {}

  debug(msg: string, ...args: unknown[]): void {
    void debug(this.format(msg, args));
  }

  info(msg: string, ...args: unknown[]): void {
    void info(this.format(msg, args));
  }

  warn(msg: string, ...args: unknown[]): void {
    void warn(this.format(msg, args));
  }

  error(msg: string, ...args: unknown[]): void {
    void error(this.format(msg, args));
  }

  private format(msg: string, args: unknown[]): string {
    if (args.length === 0) return `[${this.module}] ${msg}`;
    const extra = args.map(a => safeStringify(a)).join(' ');
    return `[${this.module}] ${msg} ${extra}`;
  }
}

/**
 * 序列化任意值到字符串，logger 必须 infallible。
 * Why: 原实现直接 JSON.stringify 遇到循环引用/BigInt/不可序列化值会抛异常，
 *      导致 log.error 本身成为异常源，遮蔽真正的业务异常。
 */
function safeStringify(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value === null || value === undefined) return String(value);
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return String(value);
  if (t === 'bigint') return `${value}n`;
  if (t === 'function' || t === 'symbol') return String(value);
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

export function createLogger(module: string): Logger {
  return new Logger(module);
}
