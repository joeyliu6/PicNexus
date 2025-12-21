/**
 * JD 图床限速器
 * 
 * 策略：
 * 1. 动态熔断：遇到 500 错误时，触发短时冷却
 * 2. 严格串行排队：确保请求之间有最小间隔，防止并发苏醒导致的瞬间 Burst
 */
export class JDRateLimiter {
    private static instance: JDRateLimiter;

    // 冷却状态（熔断）
    private circuitBreakerEndTime: number = 0;

    // 最小请求间隔 (ms)
    // 增加到 1000ms，进一步降低并发压力
    private readonly MIN_INTERVAL = 1000;

    // 上一次请求执行的时间
    private lastRequestTime: number = 0;

    // 等待队列
    private queue: Array<() => void> = [];
    private isProcessing: boolean = false;

    private constructor() {
        this.lastRequestTime = 0;
    }

    static getInstance(): JDRateLimiter {
        if (!JDRateLimiter.instance) {
            JDRateLimiter.instance = new JDRateLimiter();
        }
        return JDRateLimiter.instance;
    }

    /**
     * 申请上传许可
     * 将请求加入队列，由调度器统一安排执行时间
     */
    acquire(): Promise<void> {
        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
            this.processQueue();
        });
    }

    /**
     * 调度器：逐个处理队列中的请求
     * 严格保证：
     * 1. 每次只放行一个请求
     * 2. 两个请求之间至少间隔 MIN_INTERVAL
     * 3. 如果触发熔断，必须等待熔断结束
     */
    private async processQueue() {
        // 如果正在处理中，无需重复启动
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const now = Date.now();

            // 计算目标执行时间
            // 必须满足两个条件：
            // 1. 比上一次请求晚 MIN_INTERVAL
            // 2. 比熔断结束时间晚 (如果正在熔断)
            let targetTime = Math.max(
                now,
                this.lastRequestTime + this.MIN_INTERVAL,
                this.circuitBreakerEndTime
            );

            const waitTime = targetTime - now;

            if (waitTime > 0) {
                // console.log(`[JDRateLimiter] 调度等待 ${waitTime}ms (Queue: ${this.queue.length})`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            // 再次检查时间 (防止等待期间熔断时间又更新了，或者 targets 变了? 
            // 其实这里主要是防止等待期间 triggerCircuitBreaker 被触发，导致 circuitBreakerEndTime 变大)
            // 如果等待后发现现在还在熔断时间内，loop continue，重新计算等待
            if (Date.now() < this.circuitBreakerEndTime) {
                console.log(`[JDRateLimiter] 等待期间触发了新熔断，继续等待...`);
                continue;
            }

            // 取出队首请求并执行
            const resolve = this.queue.shift();
            if (resolve) {
                this.lastRequestTime = Date.now();
                resolve();
            }
        }

        this.isProcessing = false;
    }

    /**
     * 报告遇到了 500 错误，触发熔断
     * @param durationMs 冷却时间
     */
    triggerCircuitBreaker(durationMs: number = 8000) {
        const now = Date.now();
        const endTime = now + durationMs;

        // 只有当新的熔断结束时间比当前的更晚时才更新
        if (endTime > this.circuitBreakerEndTime) {
            console.log(`[JDRateLimiter] 触发熔断冷却，暂停 ${durationMs}ms`);
            this.circuitBreakerEndTime = endTime;
            // 不需要做其他操作，processQueue 下一轮循环会自动感知 circuitBreakerEndTime 变化并计算新的 waitTime
        }
    }
}
