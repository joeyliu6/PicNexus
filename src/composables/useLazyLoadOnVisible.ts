// 视图首次激活时才执行加载，避免首屏被迫触发重型数据加载（如 3 万条 metas 的 JSON.parse）

import { onMounted, watch, type Ref, type ComputedRef } from 'vue';

type VisibleSource = Ref<boolean | undefined> | ComputedRef<boolean | undefined> | (() => boolean | undefined);

export function useLazyLoadOnVisible(
  visible: VisibleSource,
  loader: () => void | Promise<void>,
): void {
  let loaded = false;

  const ensure = (): void => {
    if (loaded) return;
    loaded = true;
    void loader();
  };

  const getter = typeof visible === 'function' ? visible : () => visible.value;

  onMounted(() => {
    if (getter()) ensure();
  });

  watch(getter, (isVisible) => {
    if (isVisible) ensure();
  });
}
