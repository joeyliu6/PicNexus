// src/composables/useQueueState.ts
// 全局上传队列状态管理

import { ref, computed, type Ref } from 'vue';
import type { QueueItem } from '../uploadQueue';

// 全局队列状态（单例）
const queueItems: Ref<QueueItem[]> = ref([]);

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
   * ✅ 修复: 深拷贝嵌套对象，避免引用共享导致队列项相互影响
   */
  const updateItem = (itemId: string, updates: Partial<QueueItem>) => {
    const index = queueItems.value.findIndex(item => item.id === itemId);
    if (index !== -1) {
      const currentItem = queueItems.value[index];

      // 深拷贝 serviceProgress，避免多个队列项共享同一个对象引用
      const updatedServiceProgress = updates.serviceProgress
        ? {
            ...currentItem.serviceProgress,
            ...Object.fromEntries(
              Object.entries(updates.serviceProgress).map(([key, value]) => [
                key,
                { ...currentItem.serviceProgress?.[key as keyof typeof currentItem.serviceProgress], ...value }
              ])
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
    removeItem,
    clearQueue,
    clearCompletedItems,
    hasCompletedItems
  };
}
