/**
 * Store 层共享类型定义
 * 抽出到独立文件是为了让 store.ts 及未来的子模块（CacheStore/EncryptedStore/MutexStore）
 * 共用同一组类型，避免在每个文件各自维护一份。
 */

/**
 * Store 内部统一使用的"键值对象"类型。
 * 值是 unknown 而不是 any，是因为：
 *  - 写入侧：TS 允许把任何值赋给 unknown，等价于 any 的灵活性；
 *  - 读取侧：unknown 会强制调用方显式断言类型（`return value as T`），
 *    这样就把类型责任推回到调用方，避免 store 内部的类型信息污染业务层。
 */
export type StoreData = Record<string, unknown>;

/**
 * Store 构造函数的可选参数。
 * - selfHeal: 解密失败时备份损坏文件、以空对象继续写入（用于瞬态存储，如同步状态）
 * - encrypted: 是否启用加密（默认 true，即配置类存储；同步状态这类瞬态数据可以设为 false）
 */
export interface StoreOptions {
  selfHeal?: boolean;
  encrypted?: boolean;
}

/**
 * 把 catch 里的 unknown 错误安全地转成字符串消息。
 * 替换原代码里散落的 `e?.message || String(e)` 写法。
 * 只在 store 层内部使用，不上升到 utils/。
 */
export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}
