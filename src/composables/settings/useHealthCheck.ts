// 健康检测进度环、批量测试动画、完成状态追踪
// 从 HostingSettingsPanel.vue 提取的 composable

import { ref, computed, watch, watchEffect, onUnmounted, type Ref, type ComputedRef } from 'vue';
import type { BatchTestProgress } from '../../types/batchTest';

/** 进度环周长常量 */
const RING_CIRCUMFERENCE = 56.55;

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
  /** 进度百分比（0-100） */
  progressPercent: ComputedRef<number>;
  /** 进度环 SVG stroke-dashoffset */
  ringOffset: ComputedRef<number>;
  /** 进度环周长常量 */
  ringCircumference: number;
  /** 是否正在显示"检测完成" */
  isShowingCompleted: Ref<boolean>;
  /** 进度环旁的文本标签 */
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

  // ==================== 进度百分比 ====================

  const progressPercent = computed(() => {
    const p = batchTestProgress.value;
    if (!p || p.total === 0) return 0;
    return Math.round((p.current / p.total) * 100);
  });

  const ringOffset = computed(() =>
    RING_CIRCUMFERENCE * (1 - progressPercent.value / 100)
  );

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

  const batchTestedServices = ref<Set<string>>(new Set());
  const batchDoneServices = ref<Set<string>>(new Set());
  let wasTestingMap: Record<string, boolean> = {};
  let doneTimers: Record<string, ReturnType<typeof setTimeout>> = {};

  watch(isBatchTesting, (testing) => {
    if (testing) {
      batchTestedServices.value = new Set();
      batchDoneServices.value = new Set();
      Object.values(doneTimers).forEach(clearTimeout);
      doneTimers = {};
      wasTestingMap = {};
    }
  });

  watchEffect(() => {
    if (!isBatchTesting.value) return;
    for (const [svc, isTesting] of Object.entries(testingConnections.value)) {
      if (wasTestingMap[svc] === true && !isTesting) {
        batchTestedServices.value = new Set([...batchTestedServices.value, svc]);
        batchDoneServices.value = new Set([...batchDoneServices.value, svc]);
        doneTimers[svc] = setTimeout(() => {
          const next = new Set(batchDoneServices.value);
          next.delete(svc);
          batchDoneServices.value = next;
        }, DONE_HIGHLIGHT_MS);
      }
      wasTestingMap[svc] = isTesting;
    }
  });

  // ==================== 清理 ====================

  onUnmounted(() => {
    if (stallTimer) clearTimeout(stallTimer);
    if (completedTimer) clearTimeout(completedTimer);
    Object.values(doneTimers).forEach(clearTimeout);
  });

  return {
    progressPercent,
    ringOffset,
    ringCircumference: RING_CIRCUMFERENCE,
    isShowingCompleted,
    ringLabel,
    isStalled,
    batchTestedServices,
    batchDoneServices,
  };
}
