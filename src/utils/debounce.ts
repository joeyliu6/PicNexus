// src/utils/debounce.ts

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): ((...args: Parameters<T>) => void) & {
  cancel: () => void;
  immediate: () => void;
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

export function debounceWithError<T extends (...args: any[]) => Promise<any>>(
  func: T,
  delay: number,
  onError?: (error: any) => void
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
          console.error('[防抖函数] 执行失败:', error);
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
      console.error('[防抖函数] 立即执行失败:', error);
      onError?.(error);
    }
  };

  return debouncedFn;
}