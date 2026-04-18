/**
 * 视口可见天 → 扩展 ±N 天缓冲区后 debounce 触发 ensureDaysLoaded
 * 目的：边滚边按需加载，避免用户快速滚动时频繁抖动请求
 */
import { watch, onUnmounted, type Ref, type ComputedRef } from 'vue';
import type { DayStats } from '../../services/HistoryDatabase';

interface Options {
  /** 当前视口内可见的 dayKey 列表（格式 'year-month-day'） */
  visibleDayKeys: ComputedRef<string[]>;
  /** 时间降序 dayStats，用于定位 key 索引并扩展前后缓冲 */
  dayStats: Ref<DayStats[]>;
  /** 按 dayKey 列表触发数据加载 */
  ensureDaysLoaded: (keys: string[]) => Promise<void>;
  /** 前后缓冲天数，默认 5 */
  bufferDays?: number;
  /** debounce 毫秒，默认 100 */
  debounceMs?: number;
}

export function useVisibleDayBuffer(options: Options): { cleanup: () => void } {
  const { visibleDayKeys, dayStats, ensureDaysLoaded, bufferDays = 5, debounceMs = 100 } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;

  watch(visibleDayKeys, (keys) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (keys.length === 0) return;
      const stats = dayStats.value;
      const keySet = new Set(keys);
      const indices: number[] = [];
      for (let i = 0; i < stats.length; i++) {
        const s = stats[i];
        if (keySet.has(`${s.year}-${s.month}-${s.day}`)) indices.push(i);
      }
      if (indices.length === 0) return;
      const minIdx = Math.max(0, Math.min(...indices) - bufferDays);
      const maxIdx = Math.min(stats.length - 1, Math.max(...indices) + bufferDays);
      const buffered = stats.slice(minIdx, maxIdx + 1).map(s => `${s.year}-${s.month}-${s.day}`);
      void ensureDaysLoaded(buffered);
    }, debounceMs);
  });

  function cleanup(): void {
    if (timer) { clearTimeout(timer); timer = null; }
  }
  onUnmounted(cleanup);

  return { cleanup };
}
