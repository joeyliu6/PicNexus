/**
 * 通用校验工具
 */

/**
 * 检查对象指定字段是否全部非空（trim 后非空）
 *
 * 用于服务卡片"已配置"判断：例如 GitHub 必须同时填 token/owner/repo。
 */
export function hasNonEmptyFields<T extends Record<string, unknown>>(
  obj: T | undefined | null,
  fields: ReadonlyArray<keyof T>,
): boolean {
  if (!obj) return false;
  return fields.every((k) => {
    const v = obj[k];
    return typeof v === 'string' && v.trim().length > 0;
  });
}
