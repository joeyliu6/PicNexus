// 健康检测进度环、批量测试动画、完成状态追踪
// 从 HostingSettingsPanel.vue 提取的 composable

import { ref, computed, watch, onUnmounted, shallowRef, triggerRef, type Ref, type ComputedRef } from 'vue';
import type { BatchTestProgress } from '../../types/batchTest';

/** 停滞判定阈值（毫秒） */
const STALL_MS = 1500;

/** 单服务完成高亮持续时间（毫秒） */
const DONE_HIGHLIGHT_MS = 600;

/** 检测完成提示持续时间（毫秒） */
const COMPLETED_DISPLAY_MS = 3000;

interface UseHealthCheckOptions {
  /** 是否正在批量检测 */
  isBatchTesting: ComputedRef<boolean> | Ref<boolean>;
  /** 批量检测进度 */
  batchTestProgress: ComputedRef<BatchTestProgress | null | undefined> | Ref<BatchTestProgress | null | undefined>;
  /** 各服务的测试中状态映射 */
  testingConnections: ComputedRef<Record<string, boolean>> | Ref<Record<string, boolean>>;
}

export interface UseHealthCheckReturn {
  /** 是否正在显示"检测完成" */
  isShowingCompleted: Ref<boolean>;
  /** 刷新按钮旁的文本标签 */
  ringLabel: ComputedRef<string>;
  /** 进度是否停滞（用于旋转动画） */
  isStalled: Ref<boolean>;
  /** 已完成检测的服务 ID 集合 */
  batchTestedServices: Ref<Set<string>>;
  /** 刚完成检测的服务 ID 集合（短暂高亮） */
  batchDoneServices: Ref<Set<string>>;
}

export function useHealthCheck(options: UseHealthCheckOptions): UseHealthCheckReturn {
  const { isBatchTesting, batchTestProgress, testingConnections } = options;

  // ==================== 进度百分比（内部使用，驱动完成态/停滞态/ringLabel） ====================

  const progressPercent = computed(() => {
    const p = batchTestProgress.value;
    if (!p || p.total === 0) return 0;
    return Math.round((p.current / p.total) * 100);
  });

  // ==================== 完成状态 ====================

  const isShowingCompleted = ref(false);
  let completedTimer: ReturnType<typeof setTimeout> | null = null;

  watch(progressPercent, (val) => {
    if (val >= 100 && isBatchTesting.value) {
      isShowingCompleted.value = true;
      if (completedTimer) clearTimeout(completedTimer);
      completedTimer = setTimeout(() => {
        isShowingCompleted.value = false;
      }, COMPLETED_DISPLAY_MS);
    }
  });

  watch(isBatchTesting, (testing) => {
    if (testing) {
      isShowingCompleted.value = false;
      if (completedTimer) clearTimeout(completedTimer);
      completedTimer = null;
    }
  });

  // ==================== 标签文本 ====================

  const ringLabel = computed(() => {
    if (isShowingCompleted.value) return '检测完成';
    if (!isBatchTesting.value) return '重新检测';
    if (progressPercent.value >= 100) return '检测完成';
    return '正在检测';
  });

  // ==================== 停滞检测 ====================

  const isStalled = ref(false);
  let stallTimer: ReturnType<typeof setTimeout> | null = null;

  watch(progressPercent, () => {
    if (stallTimer) clearTimeout(stallTimer);
    isStalled.value = false;
    if (isBatchTesting.value && progressPercent.value < 100) {
      stallTimer = setTimeout(() => { isStalled.value = true; }, STALL_MS);
    }
  });

  watch(isBatchTesting, (testing) => {
    if (!testing) {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
      isStalled.value = false;
    }
  });

  // ==================== 单服务完成追踪 ====================

  const batchTestedServices = shallowRef<Set<string>>(new Set());
  const batchDoneServices = shallowRef<Set<string>>(new Set());
  let doneTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  let previousTestingState: Record<string, boolean> = {};

  watch(isBatchTesting, (testing) => {
    if (testing) {
      batchTestedServices.value.clear();
      batchDoneServices.value.clear();
      triggerRef(batchTestedServices);
      triggerRef(batchDoneServices);
      Object.values(doneTimers).forEach(clearTimeout);
      doneTimers = {};
      previousTestingState = {};
    }
  });

  // 性能优化：watch 替代 watchEffect 避免全量遍历
  // 注意：deep watch 的 oldVal/newVal 可能共享引用，需手动维护状态快照
  watch(
    testingConnections,
    (newVal) => {
      if (!isBatchTesting.value) return;

      let hasChanges = false;

      for (const [svc, isTesting] of Object.entries(newVal)) {
        const wasTesting = previousTestingState[svc] ?? false;

        if (wasTesting && !isTesting) {
          batchTestedServices.value.add(svc);
          batchDoneServices.value.add(svc);
          hasChanges = true;

          // 清理旧 timer 防止内存泄漏
          if (doneTimers[svc]) {
            clearTimeout(doneTimers[svc]);
          }

          doneTimers[svc] = setTimeout(() => {
            batchDoneServices.value.delete(svc);
            triggerRef(batchDoneServices);
          }, DONE_HIGHLIGHT_MS);
        }

        previousTestingState[svc] = isTesting;
      }

      if (hasChanges) {
        triggerRef(batchTestedServices);
        triggerRef(batchDoneServices);
      }
    },
    { deep: true }
  );

  // ==================== 清理 ====================

  onUnmounted(() => {
    if (stallTimer) clearTimeout(stallTimer);
    if (completedTimer) clearTimeout(completedTimer);
    Object.values(doneTimers).forEach(clearTimeout);
  });

  return {
    isShowingCompleted,
    ringLabel,
    isStalled,
    batchTestedServices,
    batchDoneServices,
  };
}
