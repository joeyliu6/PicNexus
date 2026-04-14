/**
 * useHistoryBadgeLayout — 服务徽章列宽度自适应
 * 从 HistoryTableView.vue 提取
 *
 * 通过 ResizeObserver 监控表格列宽度，动态计算可显示的 badge 数量
 */
import { ref, onUnmounted, type Ref } from 'vue';
import type { HistoryItem } from '../../config/types';
import { getServiceDisplayName } from '../../constants/serviceNames';
import { getSuccessfulServices } from '../../utils/formatters';

const MORE_BTN_WIDTH = 26;
const BADGE_GAP = 4;
const BADGE_PADDING = 16;
const BADGE_ICON_WITH_GAP = 18; // icon(14) + gap(4)
const CHAR_WIDTH_ASCII = 6;
const CHAR_WIDTH_CJK = 11;

function estimateBadgeWidth(name: string): number {
  let textWidth = 0;
  for (const char of name) {
    textWidth += char.charCodeAt(0) > 0x7F ? CHAR_WIDTH_CJK : CHAR_WIDTH_ASCII;
  }
  return BADGE_PADDING + BADGE_ICON_WITH_GAP + textWidth;
}

export function useHistoryBadgeLayout(tableViewRef: Ref<HTMLElement | null>) {
  const badgeColumnWidth = ref(200);
  let badgeResizeObserver: ResizeObserver | null = null;
  let badgeObservedElement: HTMLElement | null = null;
  let resizeTimerId = 0;

  // 行级缓存：每个 HistoryItem 的成功服务列表只算一次
  // WeakMap key 为对象引用，翻页时旧 item 被 GC 自动释放
  const servicesByItem = new WeakMap<HistoryItem, string[]>();
  function getCachedServices(item: HistoryItem): string[] {
    let cached = servicesByItem.get(item);
    if (!cached) {
      cached = getSuccessfulServices(item);
      servicesByItem.set(item, cached);
    }
    return cached;
  }

  // visibleCount 缓存：key 为上面 WeakMap 返回的稳定 services 数组引用
  // badgeColumnWidth 变化时整表换一张新 WeakMap，旧的随 GC 自动回收
  let visibleCountMap = new WeakMap<string[], number>();
  let visibleCountMapWidth = -1;

  function setupBadgeWidthObserver(): void {
    const root = tableViewRef.value;
    if (!root) return;

    const table = root.querySelector('.history-table') as HTMLElement | null;
    if (!table) return;

    const badge = table.querySelector('.service-badges') as HTMLElement | null;
    const td = badge?.closest('td') as HTMLElement | null;
    // 用 headerClass="history-badge-col" 精准定位，不依赖 nth-child（列顺序可能变化）
    const header = table.querySelector('th.history-badge-col') as HTMLElement | null;
    const target = td || header;
    if (!target) return;

    if (badgeResizeObserver && badgeObservedElement === target) return;

    badgeResizeObserver?.disconnect();
    badgeResizeObserver = null;
    badgeObservedElement = target;

    const computedStyle = window.getComputedStyle(target);
    const horizontalPadding = (
      parseFloat(computedStyle.paddingLeft || '0') +
      parseFloat(computedStyle.paddingRight || '0')
    );
    badgeColumnWidth.value = Math.max(target.clientWidth - horizontalPadding, 80);

    badgeResizeObserver = new ResizeObserver((entries) => {
      const lastEntry = entries[entries.length - 1];
      clearTimeout(resizeTimerId);
      resizeTimerId = window.setTimeout(() => {
        badgeColumnWidth.value = Math.max(lastEntry.contentRect.width, 80);
      }, 150);
    });
    badgeResizeObserver.observe(target);
  }

  function getVisibleCount(services: string[]): number {
    const available = badgeColumnWidth.value;

    // 列宽变化时整表失效一次（换一张新 WeakMap，旧的交给 GC）
    if (visibleCountMapWidth !== available) {
      visibleCountMap = new WeakMap();
      visibleCountMapWidth = available;
    }

    const hit = visibleCountMap.get(services);
    if (hit !== undefined) return hit;

    let used = 0;
    let count = 0;

    for (let i = 0; i < services.length; i++) {
      const width = estimateBadgeWidth(getServiceDisplayName(services[i]));
      const gap = count > 0 ? BADGE_GAP : 0;
      const remaining = services.length - i - 1;
      const reserveMore = remaining > 0 ? MORE_BTN_WIDTH + BADGE_GAP : 0;

      if (used + gap + width + reserveMore > available && count > 0) break;
      used += gap + width;
      count++;
    }

    const result = Math.max(count, 1);
    visibleCountMap.set(services, result);
    return result;
  }

  onUnmounted(() => {
    badgeResizeObserver?.disconnect();
    badgeResizeObserver = null;
    badgeObservedElement = null;
    clearTimeout(resizeTimerId);
  });

  return {
    setupBadgeWidthObserver,
    getVisibleCount,
    getCachedServices,  // 行级缓存的成功服务列表，模板用它替代 getSuccessfulServices 避免每行多次重算
    badgeColumnWidth,   // 暴露给模板，用于 v-memo 依赖，否则宽度变化后 badge 数量不会更新
  };
}
