// src/events/cacheEvents.ts
// 跨窗口缓存事件管理

import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * 缓存事件类型
 */
export type CacheEventType =
  | 'history-updated'    // 历史记录更新（新增）
  | 'history-deleted'    // 历史记录删除
  | 'history-cleared'    // 历史记录清空
  | 'config-updated';    // 配置更新

/**
 * 缓存事件载荷
 */
export interface CacheEventPayload {
  /** 事件类型 */
  type: CacheEventType;
  /** 事件时间戳 */
  timestamp: number;
  /** 附加数据 */
  data?: unknown;
}

/**
 * 历史记录事件数据
 */
export interface HistoryEventData {
  /** 受影响的历史记录 ID 列表 */
  ids?: string[];
  /** 操作来源（用于避免重复处理） */
  source?: string;
}

// 事件名称常量
const CACHE_EVENT_NAME = 'cache-event';

/**
 * 发送缓存事件（跨窗口广播）
 *
 * @param type 事件类型
 * @param data 附加数据
 *
 * @example
 * ```typescript
 * // 通知其他窗口历史记录已删除
 * await emitCacheEvent('history-deleted', { ids: ['id1', 'id2'] });
 * ```
 */
export async function emitCacheEvent(
  type: CacheEventType,
  data?: HistoryEventData | unknown
): Promise<void> {
  try {
    await emit(CACHE_EVENT_NAME, {
      type,
      timestamp: Date.now(),
      data
    } as CacheEventPayload);
    console.log(`[缓存事件] 已发送: ${type}`);
  } catch (e) {
    console.warn(`[缓存事件] 发送失败:`, e);
  }
}

/**
 * 监听缓存事件
 *
 * @param handler 事件处理函数
 * @returns 取消监听函数
 *
 * @example
 * ```typescript
 * const unlisten = await onCacheEvent((payload) => {
 *   if (payload.type === 'history-deleted') {
 *     // 处理历史记录删除事件
 *     refreshHistoryList();
 *   }
 * });
 *
 * // 组件卸载时取消监听
 * onUnmounted(() => unlisten());
 * ```
 */
export async function onCacheEvent(
  handler: (payload: CacheEventPayload) => void
): Promise<UnlistenFn> {
  return await listen<CacheEventPayload>(CACHE_EVENT_NAME, (event) => {
    console.log(`[缓存事件] 收到: ${event.payload.type}`);
    handler(event.payload);
  });
}

/**
 * 监听特定类型的缓存事件
 *
 * @param type 要监听的事件类型
 * @param handler 事件处理函数
 * @returns 取消监听函数
 *
 * @example
 * ```typescript
 * const unlisten = await onCacheEventType('history-updated', (data) => {
 *   console.log('历史记录已更新');
 * });
 * ```
 */
export async function onCacheEventType<T = unknown>(
  type: CacheEventType,
  handler: (data: T | undefined) => void
): Promise<UnlistenFn> {
  return await listen<CacheEventPayload>(CACHE_EVENT_NAME, (event) => {
    if (event.payload.type === type) {
      console.log(`[缓存事件] 处理: ${type}`);
      handler(event.payload.data as T | undefined);
    }
  });
}

/**
 * 快捷方法：发送历史记录更新事件
 */
export async function emitHistoryUpdated(ids?: string[]): Promise<void> {
  await emitCacheEvent('history-updated', { ids });
}

/**
 * 快捷方法：发送历史记录删除事件
 */
export async function emitHistoryDeleted(ids: string[]): Promise<void> {
  await emitCacheEvent('history-deleted', { ids });
}

/**
 * 快捷方法：发送历史记录清空事件
 */
export async function emitHistoryCleared(): Promise<void> {
  await emitCacheEvent('history-cleared');
}

/**
 * 快捷方法：发送配置更新事件
 */
export async function emitConfigUpdated(): Promise<void> {
  await emitCacheEvent('config-updated');
}
