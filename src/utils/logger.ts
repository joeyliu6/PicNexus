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
    // 错误对象特殊处理，提取 message
    const extra = args.map(a =>
      a instanceof Error ? a.message : JSON.stringify(a)
    ).join(' ');
    return `[${this.module}] ${msg} ${extra}`;
  }
}

export function createLogger(module: string): Logger {
  return new Logger(module);
}
