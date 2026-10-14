// 批量检查的节奏：还要多久、是不是卡在慢图床
//
// 回答用户检查途中最关心的两件事。逐行变化在几万条里看不出整体在动，
// 一个「预计还要 3 分钟」或「正在等慢的图床」比任何动效都可靠。

import { onScopeDispose, ref, watch, type Ref } from 'vue';
import type { BatchCheckProgress } from '@/types/linkCheck';

/** 超过这么久没有新结果，就判为卡在慢图床（per-host 限速下很常见） */
const STALL_MS = 10_000;
/** 速度的指数平滑系数：越大越灵敏，越小越平稳 */
const RATE_ALPHA = 0.3;

export function useProgressPace(progress: Ref<BatchCheckProgress | null>) {
  /** 预计还要多少秒；刚开始或卡住时为 null */
  const etaSeconds = ref<number | null>(null);
  const stalled = ref(false);

  let rate = 0;
  let lastChecked = 0;
  let lastTime = 0;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;

  function clearStallTimer(): void {
    if (stallTimer !== null) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  }

  function armStallTimer(): void {
    clearStallTimer();
    stallTimer = setTimeout(() => {
      stalled.value = true;
      etaSeconds.value = null;
    }, STALL_MS);
  }

  watch(progress, (current) => {
    if (!current) {
      rate = 0;
      lastChecked = 0;
      lastTime = 0;
      etaSeconds.value = null;
      stalled.value = false;
      clearStallTimer();
      return;
    }

    const now = Date.now();
    if (lastTime === 0) {
      lastChecked = current.checked;
      lastTime = now;
      armStallTimer();
      return;
    }

    const seconds = (now - lastTime) / 1000;
    const done = current.checked - lastChecked;
    if (seconds <= 0 || done <= 0) return;

    const instant = done / seconds;
    rate = rate === 0 ? instant : RATE_ALPHA * instant + (1 - RATE_ALPHA) * rate;
    etaSeconds.value = Math.round(Math.max(0, current.total - current.checked) / rate);
    lastChecked = current.checked;
    lastTime = now;
    stalled.value = false;
    armStallTimer();
  });

  onScopeDispose(clearStallTimer);

  return { etaSeconds, stalled };
}
