// src/utils/deepClone.ts
/**
 * 深拷贝工具 - 避免引用共享
 */

/**
 * 深拷贝对象（支持嵌套对象和数组）
 * @param obj 要拷贝的对象
 * @returns 深拷贝后的新对象
 */
export function deepClone<T>(obj: T): T {
  // 处理 null、undefined 和基本类型
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // 处理 Date
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  // 处理 Array
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item)) as T;
  }

  // 处理 Object
  const clonedObj = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      clonedObj[key] = deepClone(obj[key]);
    }
  }

  return clonedObj;
}

/**
 * 合并对象（深拷贝）
 * @param target 目标对象
 * @param source 源对象
 * @returns 合并后的新对象
 */
export function deepMerge<T extends Record<string, any>>(
  target: T,
  source: Partial<T>
): T {
  const result = deepClone(target);

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (
        sourceValue &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        // 递归合并嵌套对象
        result[key] = deepMerge(targetValue, sourceValue);
      } else {
        // 直接赋值（会被深拷贝）
        result[key] = deepClone(sourceValue) as T[Extract<keyof T, string>];
      }
    }
  }

  return result;
}
