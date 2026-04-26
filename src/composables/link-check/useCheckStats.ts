import { computed, getCurrentScope, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue';
import type { BatchCheckProgress, LinkCheckRow, StatusFilter } from '../../types/linkCheck';

/** 失速判定阈值：>N 毫秒无新结果即判定为"卡在慢域名"，向用户显式提示 */
const STALL_THRESHOLD_MS = 10_000;
/** 速率 EWMA 平滑系数：越高越敏感、越低越平滑（防止瞬时抖动）*/
const RATE_EWMA_ALPHA = 0.3;
const HIGH_THROUGHPUT_ENTER_RATE = 12;
const HIGH_THROUGHPUT_EXIT_RATE = 6;

export interface CheckStatsResult {
  total: number;
  valid: number;
  invalid: number;
  timeout: number;
  suspicious: number;
  unchecked: number;
  checked: number;
  problems: number;
}

interface UseCheckStatsOptions {
  scopedRows: ComputedRef<LinkCheckRow[]>;
  checkRows: Ref<LinkCheckRow[]>;
  progress: Ref<BatchCheckProgress | null>;
  statusFilter?: Ref<StatusFilter>;
}

export function useCheckStats({ scopedRows, checkRows, progress }: UseCheckStatsOptions) {
  const stats = computed<CheckStatsResult>(() => {
    const activeRows = scopedRows.value;
    let valid = 0;
    let invalid = 0;
    let timeout = 0;
    let suspicious = 0;
    let unchecked = 0;

    for (const row of activeRows) {
      const result = row.checkResult;
      if (!result) {
        unchecked++;
        continue;
      }
      if (result.is_valid) {
        valid++;
        continue;
      }
      if (result.error_type === 'timeout') {
        timeout++;
      } else if (result.error_type === 'suspicious' || result.browser_might_work) {
        suspicious++;
      } else {
        invalid++;
      }
    }

    const checked = activeRows.length - unchecked;
    return {
      total: activeRows.length,
      valid,
      invalid,
      timeout,
      suspicious,
      unchecked,
      checked,
      problems: invalid + timeout + suspicious,
    };
  });

  const serviceList = computed(() => {
    const map = new Map<string, number>();

    for (const row of checkRows.value) {
      map.set(row.serviceId, (map.get(row.serviceId) || 0) + 1);
    }

    return Array.from(map.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((left, right) => right.count - left.count);
  });

  const progressPercent = computed(() => {
    const current = progress.value;
    if (!current || current.total === 0) return 0;
    return Math.min(100, Math.round((current.checked / current.total) * 100));
  });

  // ============================================
  // 速率 / ETA / 失速预警
  // ============================================
  // 设计目标：把"系统在干活吗 + 还要多久"这两个核心问题用数字直接回答，
  // 比堆动效更可靠——速率掉到 0 就说明卡了，逐行 spinner 反而看不出整体状态。

  /** 平滑后的检测速率（条/秒），0 = 还没建立基线或已失速 */
  const progressRate = ref(0);
  /** 预估剩余秒数；null = 速率不足以估算（刚开始或失速）*/
  const etaSeconds = ref<number | null>(null);
  /** 失速：>STALL_THRESHOLD_MS 没有新结果到达，提示用户"在等慢域名" */
  const stalled = ref(false);
  const isHighThroughput = ref(false);

  let lastChecked = 0;
  let lastUpdateTime = 0;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;

  function clearStallTimer(): void {
    if (stallTimer !== null) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  }

  function resetRateState(): void {
    progressRate.value = 0;
    etaSeconds.value = null;
    stalled.value = false;
    isHighThroughput.value = false;
    lastChecked = 0;
    lastUpdateTime = 0;
    clearStallTimer();
  }

  function updateHighThroughputState(rate: number): void {
    if (!isHighThroughput.value && rate >= HIGH_THROUGHPUT_ENTER_RATE) {
      isHighThroughput.value = true;
    } else if (isHighThroughput.value && rate <= HIGH_THROUGHPUT_EXIT_RATE) {
      isHighThroughput.value = false;
    }
  }

  function armStallTimer(): void {
    clearStallTimer();
    stallTimer = setTimeout(() => {
      stalled.value = true;
      isHighThroughput.value = false;
    }, STALL_THRESHOLD_MS);
  }

  watch(progress, (cur) => {
    if (!cur) {
      // 检测结束/取消/重置：清零所有派生状态，下次开检从头算
      resetRateState();
      return;
    }

    const now = Date.now();

    // 首次进度事件：仅建立基线，不算速率（dt=0 没意义）
    if (lastUpdateTime === 0) {
      lastChecked = cur.checked;
      lastUpdateTime = now;
      stalled.value = false;
      armStallTimer();
      return;
    }

    const dtSec = (now - lastUpdateTime) / 1000;
    const dn = cur.checked - lastChecked;
    if (dtSec > 0 && dn > 0) {
      const instantRate = dn / dtSec;
      progressRate.value = progressRate.value === 0
        ? instantRate
        : RATE_EWMA_ALPHA * instantRate + (1 - RATE_EWMA_ALPHA) * progressRate.value;

      const remaining = Math.max(0, cur.total - cur.checked);
      etaSeconds.value = progressRate.value > 0 ? Math.round(remaining / progressRate.value) : null;
      updateHighThroughputState(progressRate.value);

      lastChecked = cur.checked;
      lastUpdateTime = now;

      // 有新结果到达：重置失速判定
      stalled.value = false;
      armStallTimer();
    }
  });

  if (getCurrentScope()) {
    onScopeDispose(() => clearStallTimer());
  }

  /** "26m" / "1h26m" / "45s" 紧凑格式；null 时返回空串 */
  const etaLabel = computed<string>(() => {
    const sec = etaSeconds.value;
    if (sec === null || !Number.isFinite(sec) || sec <= 0) return '';
    if (sec < 60) return `${sec}s`;
    const m = Math.round(sec / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h${m % 60}m`;
  });

  /** "18/s" 紧凑格式；速率为 0 时返回空串 */
  const rateLabel = computed<string>(() => {
    const r = progressRate.value;
    if (r <= 0) return '';
    return r >= 10 ? `${Math.round(r)}/s` : `${r.toFixed(1)}/s`;
  });

  const progressTooltip = computed(() => {
    const current = progress.value;
    if (!current || current.total <= 0) return '准备检测...';

    const checked = Math.min(current.checked, current.total);
    const percent = Math.min(100, Math.round((checked / current.total) * 100));
    const currentStats = stats.value;
    const failed = currentStats.invalid + currentStats.timeout;
    const lines = [
      '链接检测中',
      `已完成：${checked.toLocaleString()} / ${current.total.toLocaleString()}`,
      `完成度：${percent}%`,
      `正常：${currentStats.valid.toLocaleString()}`,
      `失败：${failed.toLocaleString()}`,
      `可疑：${currentStats.suspicious.toLocaleString()}`,
    ];

    if (rateLabel.value) lines.push(`速度：${rateLabel.value}`);
    if (etaLabel.value) lines.push(`预计剩余：${etaLabel.value}`);
    if (stalled.value) lines.push('正在等待较慢的域名响应');

    return lines.join('\n');
  });

  return {
    stats,
    serviceList,
    progressPercent,
    progressTooltip,
    progressRate,
    etaSeconds,
    isHighThroughput,
    rateLabel,
    etaLabel,
    stalled,
  };
}
