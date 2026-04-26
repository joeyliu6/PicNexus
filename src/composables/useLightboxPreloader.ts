/**
 * 灯箱相邻图预加载（双向 ±1）
 *
 * 监听灯箱当前项变化，自动并发预热上一张和下一张的大图。
 * 浏览器把 URL 缓存好后，PhotoSwipe refreshSlideContent 时大图秒到，
 * 切换瞬间不再出现"模糊占位 → 清晰大图"的肉眼可见跳变，
 * 是 Google Photos 那种"切起来无延迟"流畅感的根本来源。
 *
 * 三个灯箱上下文（history 表格 / timeline / favorites）的 prev/next 解析逻辑差异很大
 * （同步页内、跨日异步、收藏列表 + 详情缓存），统一抽到调用方实现 resolveAdjacentUrl，
 * 这里只负责"防抖 + 并发触发 new Image()"两件事。
 */
import { watch, onUnmounted, getCurrentInstance, type Ref } from 'vue';
import { createLogger } from '../utils/logger';
import { warmImage } from '../utils/imagePreload';

const log = createLogger('LightboxPreload');

/**
 * 防抖时长（ms）
 * 用户连按方向键时，只对"最后停下来的那张"触发预热，避免 N 次中间帧浪费带宽。
 * 100ms 是按键间隔的常见上限（120ms 起手感"慢按"），足够吸收快连击。
 */
const PRELOAD_DEBOUNCE_MS = 100;

export interface UseLightboxPreloaderOptions {
  /** 当前激活项 ID。null/undefined 表示灯箱未打开或无项 */
  currentItemId: Ref<string | null | undefined>;
  /**
   * 解析指定方向相邻项的大图 URL。
   * - 同步上下文（HistoryItem 已在内存）直接返回 string
   * - 异步上下文（需 await detailCache）返回 Promise<string>
   * - 边界（无相邻项）/失败 返回 null
   */
  resolveAdjacentUrl: (direction: 'prev' | 'next') => Promise<string | null> | string | null;
}

export function useLightboxPreloader(options: UseLightboxPreloaderOptions): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clear(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function preloadOne(direction: 'prev' | 'next'): Promise<void> {
    try {
      const url = await Promise.resolve(options.resolveAdjacentUrl(direction));
      // new Image() 触发浏览器 HTTP 缓存即可，不用挂 onload —
      // 我们不关心成功与否，只在意"下次访问 URL 时能从缓存取"
      warmImage(url);
    } catch (e) {
      log.debug(`预加载 ${direction} 失败`, e);
    }
  }

  watch(options.currentItemId, (id) => {
    clear();
    if (!id) return;
    timer = setTimeout(() => {
      void preloadOne('prev');
      void preloadOne('next');
      timer = null;
    }, PRELOAD_DEBOUNCE_MS);
  });

  // 仅在 Vue 组件 setup 上下文内注册 onUnmounted；
  // 单元测试直接调用 composable 时无组件实例，跳过避免 Vue 控制台警告
  if (getCurrentInstance()) {
    onUnmounted(clear);
  }
}
