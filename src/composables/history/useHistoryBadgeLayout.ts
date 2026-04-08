/**
 * useHistoryBadgeLayout — 服务徽章列宽度自适应
 * 从 HistoryTableView.vue 提取
 *
 * 通过 ResizeObserver 监控表格列宽度，动态计算可显示的 badge 数量
 */
import { ref, onUnmounted, type Ref } from 'vue';
import { getServiceDisplayName } from '../../constants/serviceNames';

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
  let resizeRafId = 0;

  function setupBadgeWidthObserver(): void {
    const root = tableViewRef.value;
    if (!root) return;

    const table = root.querySelector('.history-table') as HTMLElement | null;
    if (!table) return;

    const badge = table.querySelector('.service-badges') as HTMLElement | null;
    const td = badge?.closest('td') as HTMLElement | null;
    const header = table.querySelector('.p-datatable-thead > tr > th:nth-child(4)') as HTMLElement | null;
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
      cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        for (const entry of entries) {
          badgeColumnWidth.value = Math.max(entry.contentRect.width, 80);
        }
      });
    });
    badgeResizeObserver.observe(target);
  }

  function getVisibleCount(services: string[]): number {
    const available = badgeColumnWidth.value;
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

    return Math.max(count, 1);
  }

  onUnmounted(() => {
    badgeResizeObserver?.disconnect();
    badgeResizeObserver = null;
    badgeObservedElement = null;
    cancelAnimationFrame(resizeRafId);
  });

  return {
    setupBadgeWidthObserver,
    getVisibleCount,
  };
}
