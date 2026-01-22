// 全局上传队列状态管理

import { ref, computed, type Ref } from 'vue';
import type { QueueItem } from '../uploadQueue';

// 全局队列状态（单例）
const queueItems: Ref<QueueItem[]> = ref([]);

// ========== 进度更新节流机制 ==========

/** 待处理的更新队列（按 itemId 分组） */
const pendingUpdates: Map<string, Partial<QueueItem>[]> = new Map();

/** 是否已经调度了 RAF 更新 */
let rafScheduled = false;

/**
 * 合并多个更新到一个对象
 */
function mergeUpdates(updates: Partial<QueueItem>[]): Partial<QueueItem> {
  return updates.reduce((merged, update) => {
    // 合并 serviceProgress（深度合并）
    if (update.serviceProgress && merged.serviceProgress) {
      merged.serviceProgress = {
        ...merged.serviceProgress,
        ...Object.fromEntries(
          Object.entries(update.serviceProgress).map(([key, value]) => {
            const currentProgress = merged.serviceProgress?.[key as keyof typeof merged.serviceProgress];
            const mergedMetadata = value?.metadata || currentProgress?.metadata
              ? { ...currentProgress?.metadata, ...value?.metadata }
              : undefined;
            return [
              key,
              {
                ...currentProgress,
                ...value,
                ...(mergedMetadata !== undefined ? { metadata: mergedMetadata } : {})
              }
            ];
          })
        )
      };
      // 删除 update 中的 serviceProgress，因为已经合并
      const { serviceProgress: _, ...rest } = update;
      return { ...merged, ...rest };
    }
    return { ...merged, ...update };
  }, {} as Partial<QueueItem>);
}

/**
 * 执行批量更新（在 RAF 回调中调用）
 */
function flushPendingUpdates() {
  rafScheduled = false;

  // 批量处理所有待更新的项
  pendingUpdates.forEach((updates, itemId) => {
    const index = queueItems.value.findIndex(item => item.id === itemId);
    if (index !== -1) {
      const currentItem = queueItems.value[index];

      // 防止竞态条件：如果当前状态已经是 error 或 success，
      // 完全跳过节流队列中的更新（包括 serviceProgress）
      // 因为这些更新是过时的进度更新，会覆盖最终状态
      if (currentItem.status === 'error' || currentItem.status === 'success') {
        return; // 跳过此 item 的所有待处理更新
      }

      const mergedUpdate = mergeUpdates(updates);

      // 合并 serviceProgress
      const updatedServiceProgress = mergedUpdate.serviceProgress
        ? {
            ...currentItem.serviceProgress,
            ...mergedUpdate.serviceProgress
          }
        : currentItem.serviceProgress;

      queueItems.value[index] = {
        ...currentItem,
        ...mergedUpdate,
        serviceProgress: updatedServiceProgress
      };
    }
  });

  // 清空待处理队列
  pendingUpdates.clear();
}

/**
 * 调度 RAF 更新
 */
function scheduleFlush() {
  if (!rafScheduled) {
    rafScheduled = true;
    requestAnimationFrame(flushPendingUpdates);
  }
}

/**
 * 清除指定 item 的所有待处理节流更新
 * 在设置最终状态（error/success）时调用，防止过时更新覆盖最终状态
 */
function clearPendingUpdatesForItem(itemId: string): void {
  pendingUpdates.delete(itemId);
}

/**
 * 队列状态管理 Composable
 * 提供全局的队列项管理功能
 */
export function useQueueState() {
  /**
   * 添加队列项
   */
  const addItem = (item: QueueItem) => {
    queueItems.value.unshift(item);
  };

  /**
   * 获取队列项
   */
  const getItem = (itemId: string): QueueItem | undefined => {
    return queueItems.value.find(item => item.id === itemId);
  };

  /**
   * 更新队列项
   * ✅ 修复: 完整深拷贝嵌套对象（包括 serviceProgress.metadata），
   *         避免引用共享导致队列项相互影响
   */
  const updateItem = (itemId: string, updates: Partial<QueueItem>) => {
    const index = queueItems.value.findIndex(item => item.id === itemId);
    if (index !== -1) {
      const currentItem = queueItems.value[index];

      // 深拷贝 serviceProgress，包括内部的 metadata 对象
      const updatedServiceProgress = updates.serviceProgress
        ? {
            ...currentItem.serviceProgress,
            ...Object.fromEntries(
              Object.entries(updates.serviceProgress).map(([key, value]) => {
                const currentProgress = currentItem.serviceProgress?.[key as keyof typeof currentItem.serviceProgress];
                // 对 metadata 也进行深拷贝
                const mergedMetadata = value?.metadata || currentProgress?.metadata
                  ? { ...currentProgress?.metadata, ...value?.metadata }
                  : undefined;

                return [
                  key,
                  {
                    ...currentProgress,
                    ...value,
                    // 如果有 metadata，使用深拷贝的版本
                    ...(mergedMetadata !== undefined ? { metadata: mergedMetadata } : {})
                  }
                ];
              })
            )
          }
        : currentItem.serviceProgress;

      queueItems.value[index] = {
        ...currentItem,
        ...updates,
        serviceProgress: updatedServiceProgress
      };
    }
  };

  /**
   * 节流更新队列项（用于高频进度更新）
   * 使用 requestAnimationFrame 合并同一帧内的多次更新
   *
   * @param itemId 队列项 ID
   * @param updates 更新内容
   */
  const updateItemThrottled = (itemId: string, updates: Partial<QueueItem>) => {
    // 将更新添加到待处理队列
    if (!pendingUpdates.has(itemId)) {
      pendingUpdates.set(itemId, []);
    }
    pendingUpdates.get(itemId)!.push(updates);

    // 调度 RAF 更新
    scheduleFlush();
  };

  /**
   * 删除队列项
   */
  const removeItem = (itemId: string) => {
    const index = queueItems.value.findIndex(item => item.id === itemId);
    if (index !== -1) {
      queueItems.value.splice(index, 1);
    }
  };

  /**
   * 清空队列
   */
  const clearQueue = () => {
    queueItems.value = [];
  };

  /**
   * 清空已完成的队列项（保留 pending 和 uploading 状态的项）
   */
  const clearCompletedItems = () => {
    queueItems.value = queueItems.value.filter(
      item => item.status === 'pending' || item.status === 'uploading'
    );
  };

  /**
   * 检查是否有已完成的项（success 或 error）
   */
  const hasCompletedItems = computed(() => {
    return queueItems.value.some(
      item => item.status === 'success' || item.status === 'error'
    );
  });

  return {
    queueItems,
    addItem,
    getItem,
    updateItem,
    updateItemThrottled,
    removeItem,
    clearQueue,
    clearCompletedItems,
    hasCompletedItems,
    clearPendingUpdatesForItem
  };
}
