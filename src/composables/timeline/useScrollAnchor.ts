/**
 * useScrollAnchor —— 虚拟滚动视口锚点保持
 *
 * 浏览器原生 scroll-anchoring（overflow-anchor）不识别 absolute 定位的虚拟滚动，
 * 这里手动模拟：layout 重算前捕获视口中心的真实 item id 作为锚点，重算后
 * 按该 item 的位移量修正 scrollTop，保持视口看到的图片位置不动。
 *
 * 与 useScrollRestore 的区别：
 * - useScrollRestore 负责组件激活/首次挂载时恢复 scrollTop
 * - useScrollAnchor 负责运行期 layout 重算导致的高度突变补偿
 */
import { ref, watch, type Ref } from 'vue';
import type { TimelineLayoutResult } from '../../utils/justifiedLayout';
import type { VisibleItem } from './types';

interface Anchor {
  id: string;
  yBefore: number;
  scrollTopBefore: number;
}

export interface ScrollAnchorControl {
  /** 暂停锚点（跳转等主动滚动场景），避免与手动 scrollTop 抢写 */
  suspend: () => void;
  /** 恢复锚点 */
  resume: () => void;
}

export function useScrollAnchor(
  scrollContainer: Ref<HTMLElement | null>,
  layoutResult: Ref<TimelineLayoutResult | null>,
  isCalculating: Ref<boolean>,
  visibleItems: Ref<VisibleItem[]>,
): ScrollAnchorControl {
  let anchor: Anchor | null = null;
  const suspended = ref(0);

  // flush: 'sync' 保证 false→true 那一刻 layoutResult 仍是旧值（重算尚未发生），
  // true→false 那一刻 layoutResult 已是新值（calculateFullLayout 已赋值）。
  watch(
    isCalculating,
    (calculating, prev) => {
      if (suspended.value > 0) { anchor = null; return; }
      const container = scrollContainer.value;
      const layout = layoutResult.value;
      if (!container || !layout) return;

      if (calculating && !prev) {
        // 即将重算：选视口中心最近的 real item 作锚点
        const viewportCenter = container.scrollTop + container.clientHeight / 2;
        let bestId: string | null = null;
        let bestDist = Infinity;
        for (const item of visibleItems.value) {
          const pos = layout.itemPositionMap.get(item.meta.id);
          if (!pos) continue;
          const itemCenter = pos.y + pos.height / 2;
          const dist = Math.abs(itemCenter - viewportCenter);
          if (dist < bestDist) {
            bestDist = dist;
            bestId = item.meta.id;
          }
        }
        anchor = bestId
          ? {
              id: bestId,
              yBefore: layout.itemPositionMap.get(bestId)!.y,
              scrollTopBefore: container.scrollTop,
            }
          : null;
        return;
      }

      if (!calculating && prev && anchor) {
        // 重算完成：按锚点位移修正 scrollTop
        const newPos = layout.itemPositionMap.get(anchor.id);
        if (newPos) {
          const delta = newPos.y - anchor.yBefore;
          if (delta !== 0) {
            container.scrollTop = anchor.scrollTopBefore + delta;
          }
        }
        anchor = null;
      }
    },
    { flush: 'sync' },
  );

  return {
    suspend: () => { suspended.value++; },
    resume: () => { if (suspended.value > 0) suspended.value--; },
  };
}
