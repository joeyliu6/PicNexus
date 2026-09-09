/**
 * 自定义错误类，用于存储操作
 * 提供更详细的错误信息，包括操作类型、键名和原始错误
 */
export class StoreError extends Error {
  /**
   * @param message 错误消息
   * @param operation 操作类型 ('read' | 'write' | 'clear' | 'init')
   * @param key 相关的键名（可选）
   * @param originalError 原始错误对象（可选）
   */
  constructor(
    message: string,
    public readonly operation: 'read' | 'write' | 'clear' | 'init',
    public readonly key?: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'StoreError';
  }
}
