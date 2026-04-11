import { createLogger } from './logger';

const log = createLogger('Debounce');

// 说明：`(...args: any[]) => any` 是 TypeScript 通用防抖签名的固定写法。
// 改成 `unknown[]` 会让所有具体类型的函数（如 `(q: number) => void`）
// 因为逆变而无法赋值。这里的 any 是设计边界，不是代码味道。
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 通用 debounce 的泛型约束必须用 any[]
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): ((...args: Parameters<T>) => void) & {
  cancel: () => void;
  immediate: (...args: Parameters<T>) => void;
} {
  let timeoutId: NodeJS.Timeout | null = null;
  let cancelled = false;

  const debouncedFn = (...args: Parameters<T>) => {
    if (cancelled) cancelled = false;
    if (timeoutId !== null) clearTimeout(timeoutId);

    timeoutId = setTimeout(() => {
      if (!cancelled) func(...args);
      timeoutId = null;
      cancelled = false;
    }, delay);
  };

  debouncedFn.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    cancelled = true;
  };

  debouncedFn.immediate = (...args: Parameters<T>) => {
    debouncedFn.cancel();
    func(...args);
  };

  return debouncedFn;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 同 debounce，通用 debounce 的泛型约束必须用 any[]
export function debounceWithError<T extends (...args: any[]) => Promise<any>>(
  func: T,
  delay: number,
  onError?: (error: unknown) => void
): ((...args: Parameters<T>) => void) & {
  cancel: () => void;
  immediate: (...args: Parameters<T>) => Promise<void>;
} {
  let timeoutId: NodeJS.Timeout | null = null;
  let cancelled = false;

  const debouncedFn = ((...args: Parameters<T>) => {
    if (cancelled) cancelled = false;
    if (timeoutId !== null) clearTimeout(timeoutId);

    timeoutId = setTimeout(async () => {
      if (!cancelled) {
        try {
          await func(...args);
        } catch (error) {
          log.error('执行失败:', error);
          onError?.(error);
        }
      }
      timeoutId = null;
      cancelled = false;
    }, delay);
  }) as ((...args: Parameters<T>) => void) & {
    cancel: () => void;
    immediate: (...args: Parameters<T>) => Promise<void>;
  };

  debouncedFn.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    cancelled = true;
  };

  debouncedFn.immediate = async (...args: Parameters<T>) => {
    debouncedFn.cancel();
    try {
      await func(...args);
    } catch (error) {
      log.error('立即执行失败:', error);
      onError?.(error);
    }
  };

  return debouncedFn;
}