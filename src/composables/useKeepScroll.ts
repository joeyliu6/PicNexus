// 页面在 KeepAlive 里留着，切回来应该停在原处。可切走时整页 DOM 被摘下来，浏览器把摘下来的元素滚动位置清零
// （Chromium 与 WebKit 都是），切回来就从顶上开始。滚动时记下位置，这一页重新显示时放回去。
// 在页面自己的 onActivated 之前调用：切回来要去别处（命令面板指定的设置项、带着筛选条件进来）时，页面自己再滚。
// 图库不用：它按「看到的是哪一张」恢复（timeline/useScrollRestore），离开期间列表可能变了。

import { onActivated, watch, type Ref } from 'vue';
import { useEventListener } from '@vueuse/core';

export function useKeepScroll(el: Readonly<Ref<HTMLElement | null | undefined>>): void {
  let top = 0;
  // 换了一个元素（窄窗口在清单与详情之间切换会重建）：旧位置不作数
  watch(el, () => { top = 0; });
  useEventListener(el, 'scroll', () => {
    // 摘下来以后浏览器清零的那一下不记
    if (el.value?.isConnected) top = el.value.scrollTop;
  }, { passive: true });
  onActivated(() => {
    if (el.value && top > 0) el.value.scrollTop = top;
  });
}
