export async function attachConsole(): Promise<() => void> {
  return () => undefined;
}

export function debug(): void {}
export function info(): void {}
export function warn(): void {}
export function error(): void {}
export function trace(): void {}
