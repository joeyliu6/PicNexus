import { describe, expect, it } from 'vitest';
import { effectScope, ref } from 'vue';
import { useScrollAnchor } from '@/composables/timeline/useScrollAnchor';
import type { VisibleItem } from '@/composables/timeline/types';
import type { TimelineLayoutResult } from '@/utils/justifiedLayout';

const layoutWith = (y: number) => ({
  itemPositionMap: new Map([['picked', { y, height: 150, groupId: 'yesterday' }]]),
}) as unknown as TimelineLayoutResult;

/** 打开详情、窗口变窄：行重新排过，那张图往下移了 shift */
function relayout(scrollTop: number, before: number, shift: number) {
  const container = { scrollTop, clientHeight: 800 } as HTMLElement;
  const layout = ref<TimelineLayoutResult | null>(layoutWith(before));
  const calculating = ref(false);
  const visible = ref([{ meta: { id: 'picked' } }] as unknown as VisibleItem[]);
  const scope = effectScope();
  scope.run(() => useScrollAnchor(ref(container), layout, calculating, visible));

  calculating.value = true;
  layout.value = layoutWith(before + shift);
  calculating.value = false;
  scope.stop();
  return container.scrollTop;
}

describe('useScrollAnchor', () => {
  it('keeps the picture in the middle of the view where it was when the rows rewrap', () => {
    expect(relayout(500, 900, 165)).toBe(665);
  });

  // 同浏览器自己的滚动锚定：停在最顶上时不补偿，顶部那几行不会被推出视口（G05 打开详情时网格停在顶部）
  it('stays at the top when the view is at the top', () => {
    expect(relayout(0, 400, 165)).toBe(0);
  });
});
