/**
 * 通用 RAF 节流调度器
 *
 * 把高频回调合并到下一帧执行——典型场景：批量任务完成事件每秒数十次到来，
 * 直接触发响应式数组重写会卡爆 UI；走 rAF 后每帧最多刷一次。
 *
 * 公共 API：
 * - `schedule(cb)`：登记一个待执行回调；同帧内多次调用只保留最后一个，下一帧统一触发
 * - `flush()`：立即执行待执行回调（如果有）；用于结束阶段确保最后一批不丢失
 *
 * 边角处理：
 * - 页面不可见（document.hidden）时浏览器会跳过 rAF，此时降级为同步执行，避免 tab 切回时积压
 * - flush 后若先前 RAF 还在队列，第二轮 fire 时 cb 已为 null，安全跳过
 */
export interface RafScheduler {
  schedule(cb: () => void): void;
  flush(): void;
}

export function createRafScheduler(): RafScheduler {
  let pending = false;
  let pendingCb: (() => void) | null = null;

  function fire(): void {
    const cb = pendingCb;
    pendingCb = null;
    pending = false;
    if (cb) cb();
  }

  function schedule(cb: () => void): void {
    pendingCb = cb;
    if (typeof document !== 'undefined' && document.hidden) {
      fire();
      return;
    }
    if (pending) return;
    pending = true;
    requestAnimationFrame(fire);
  }

  function flush(): void {
    if (pendingCb) fire();
  }

  return { schedule, flush };
}
