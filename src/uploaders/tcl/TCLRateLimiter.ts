// src/uploaders/tcl/TCLRateLimiter.ts
/**
 * TCL 图床限速器
 *
 * 规则：连续上传 10 张图片后，服务端会限流约 36 秒
 * 策略：
 * 1. 令牌桶机制，容量 10
 * 2. 每次申请立即计数（不论成功失败）
 * 3. 计数达到 10 时，强制等待 36 秒（冷却）
 * 4. 冷却结束后重置计数
 */
export class TCLRateLimiter {
  private static instance: TCLRateLimiter;

  private sentCount: number = 0;
  private readonly BATCH_SIZE = 10;

  // 批次冷却时间 (36秒)
  private readonly BATCH_COOLDOWN_MS = 36000;
  // 批次内单张间隔 (2秒)，防止瞬间并发 10 张被拒
  private readonly INTERVAL_MS = 2000;

  // 排队控制
  private nextAvailableTime: number = 0;

  private constructor() {
    this.nextAvailableTime = Date.now();
  }

  static getInstance(): TCLRateLimiter {
    if (!TCLRateLimiter.instance) {
      TCLRateLimiter.instance = new TCLRateLimiter();
    }
    return TCLRateLimiter.instance;
  }

  /**
   * 获取当前状态
   */
  getStatus(): { isCooling: boolean; remainingMs: number; count: number } {
    const now = Date.now();
    const remaining = Math.max(0, this.nextAvailableTime - now);
    return {
      isCooling: remaining > 2000, // 简单的判定：如果等待时间远大于间隔，说明在长冷却
      remainingMs: remaining,
      // 这里的 count 只是个示意，因为严格的 batch 逻辑已经融入到时间轴里了
      count: this.sentCount % this.BATCH_SIZE
    };
  }

  /**
   * 申请上传许可
   */
  async acquire(): Promise<void> {
    const now = Date.now();
    this.sentCount++;
    const currentCount = this.sentCount;

    // 1. 确定本次请求需要增加的时间代价
    // 默认代价是单纯的间隔
    let cost = this.INTERVAL_MS;

    // 2. 检查是否触发了批次限制 (每 10 张的最后一张后面要加长冷却)
    // 注意：如果是第 10, 20, 30 张... 上传完后，后面那段空窗期就是冷却期
    if (currentCount % this.BATCH_SIZE === 0) {
      console.log(`[TCLRateLimiter] 也是第 ${currentCount} 张 (批次尾)，将触发长冷却`);
      cost = this.BATCH_COOLDOWN_MS;
    }

    // 3. 计算安排执行的时间
    const scheduledTime = Math.max(now, this.nextAvailableTime);

    // 更新下一次可用时间
    this.nextAvailableTime = scheduledTime + cost;

    // 4. 等待
    const waitTime = scheduledTime - now;
    if (waitTime > 0) {
      const isLongWait = waitTime > 5000;
      if (isLongWait) {
        console.log(`[TCLRateLimiter] 触发冷却或排队，需等待 ${Math.ceil(waitTime / 1000)}s`);
      }
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}
