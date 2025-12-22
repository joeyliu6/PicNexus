// src/utils/debounce.ts
// 防抖工具函数

/**
 * 防抖函数
 * @param func 要防抖的函数
 * @param delay 延迟时间（毫秒）
 * @returns 防抖后的函数
 */
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
    // 如果已取消，重置状态
    if (cancelled) {
      cancelled = false;
    }

    // 清除之前的定时器
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    // 设置新的定时器
    timeoutId = setTimeout(() => {
      if (!cancelled) {
        func(...args);
      }
      timeoutId = null;
      cancelled = false;
    }, delay);
  };

  // 取消函数
  debouncedFn.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    cancelled = true;
  };

  // 立即执行函数
  debouncedFn.immediate = (...args: Parameters<T>) => {
    debouncedFn.cancel();
    func(...args);
  };

  return debouncedFn;
}

/**
 * 创建带错误处理的防抖函数
 * @param func 要防抖的函数
 * @param delay 延迟时间（毫秒）
 * @param onError 错误处理回调
 * @returns 防抖后的函数
 */
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